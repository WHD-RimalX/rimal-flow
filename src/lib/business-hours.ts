/**
 * ساعات دوام المقر — مصدر الحقيقة الوحيد لكل من الخادم والواجهة.
 *
 * الرياض بتوقيت UTC+3 ثابت (بلا توقيت صيفي)، فكل التحويلات هنا تُجرى بإزاحة
 * يدوية ثابتة بدل الاعتماد على منطقة زمنية السيرفر (Vercel يشغّل UTC عادةً).
 * هذا الملف آمن للاستيراد من مكوّنات العميل (لا يستورد prisma ولا أي وحدة خادم).
 */

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface BusinessDayWindow {
  openHour: number;
  closeHour: number;
}

/**
 * نافذة دوام كل يوم بترتيب `Date.getUTCDay` (0 = الأحد ... 6 = السبت).
 * الأحد–الخميس: 8 صباحاً – 10 مساءً (14 ساعة دوام).
 * الجمعة: إجازة أسبوعية — لا حجوزات إطلاقاً.
 * السبت: 9 صباحاً – 10 مساءً (13 ساعة دوام).
 */
export const BUSINESS_WEEK: readonly (BusinessDayWindow | null)[] = [
  { openHour: 8, closeHour: 22 }, // الأحد
  { openHour: 8, closeHour: 22 }, // الاثنين
  { openHour: 8, closeHour: 22 }, // الثلاثاء
  { openHour: 8, closeHour: 22 }, // الأربعاء
  { openHour: 8, closeHour: 22 }, // الخميس
  null, //                            الجمعة — إجازة
  { openHour: 9, closeHour: 22 }, // السبت
];

/** فتحات الحجز تعمل بشبكة ربع ساعة. */
export const SLOT_GRANULARITY_MINUTES = 15;

/**
 * نوافذ الباقات الشهرية اليومية — الاشتراك الشهري ليس رصيداً متصلاً لـ30 يوماً،
 * بل حقّ حضور *يومي* ضمن فترة محددة تتجدد كل يوم طوال مدة الاشتراك:
 * الصباحي 8ص–3م والمسائي 3م–10م (7 ساعات لكل يوم).
 */
export const PACKAGE_DAY_WINDOWS: Record<string, BusinessDayWindow> = {
  MONTHLY_MORNING: { openHour: 8, closeHour: 15 },
  MONTHLY_EVENING: { openHour: 15, closeHour: 22 },
};

/** نافذة الباقة اليومية لنوع حجز شهري — null لغير الشهري. */
export function packageDayWindow(bookingType: string): BusinessDayWindow | null {
  return PACKAGE_DAY_WINDOWS[bookingType] ?? null;
}

/** طول نافذة الباقة اليومية بالميلي ثانية (الرصيد اليومي المتاح للمشترك). */
export function packageDailyBudgetMs(bookingType: string): number {
  const w = packageDayWindow(bookingType);
  return w ? (w.closeHour - w.openHour) * 60 * 60 * 1000 : 0;
}

/** رقم يوم الأسبوع بتوقيت الرياض للحظة معطاة (0 = الأحد). */
export function riyadhDayOfWeek(at: Date): number {
  return new Date(at.getTime() + RIYADH_OFFSET_MS).getUTCDay();
}

/** ساعة اليوم بتوقيت الرياض ككسر عشري (21.5 = 9:30 مساءً). */
export function riyadhHourOfDay(at: Date): number {
  const d = new Date(at.getTime() + RIYADH_OFFSET_MS);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** نافذة دوام اليوم الذي تقع فيه هذه اللحظة بتوقيت الرياض — null يعني إجازة. */
export function businessWindowFor(at: Date): BusinessDayWindow | null {
  return BUSINESS_WEEK[riyadhDayOfWeek(at)] ?? null;
}

/** نافذة دوام يوم تقويمي بصيغة YYYY-MM-DD (يُفسَّر كيوم تقويمي بتوقيت الرياض). */
export function businessWindowForDateKey(dateKey: string): BusinessDayWindow | null {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return BUSINESS_WEEK[d.getUTCDay()] ?? null;
}

/**
 * طول يوم الدوام بالساعات — وهو نفسه مدة "الباقة اليومية" (يوم كامل من الافتتاح
 * للإغلاق): 14 ساعة الأحد–الخميس، 13 ساعة السبت، و0 يوم الجمعة (إجازة).
 */
export function workingDayHours(at: Date): number {
  const w = businessWindowFor(at);
  return w ? w.closeHour - w.openHour : 0;
}

/** نفس الشيء لكن ليوم تقويمي بصيغة YYYY-MM-DD. */
export function workingDayHoursForDateKey(dateKey: string): number {
  const w = businessWindowForDateKey(dateKey);
  return w ? w.closeHour - w.openHour : 0;
}

/** اللحظة (UTC) المقابلة لساعة معيّنة بتوقيت الرياض ضمن نفس اليوم الرياضي لـ`at`. */
export function riyadhHourOnSameDay(at: Date, hour: number): Date {
  const shifted = new Date(at.getTime() + RIYADH_OFFSET_MS);
  const dayStartUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(dayStartUtc + hour * 60 * 60 * 1000 - RIYADH_OFFSET_MS);
}

/** هل المقر مفتوح في هذه اللحظة (يوم دوام + ضمن نافذته)؟ */
export function isWithinBusinessHours(at: Date): boolean {
  const w = businessWindowFor(at);
  if (!w) return false;
  const hour = riyadhHourOfDay(at);
  return hour >= w.openHour && hour < w.closeHour;
}

/** هل وقت البداية على شبكة ربع الساعة تماماً (بلا ثوانٍ أو أجزاء ثانية)؟ */
export function isOnSlotGrid(at: Date): boolean {
  return at.getUTCMinutes() % 15 === 0 && at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0;
}

/**
 * أقصى عدد ساعات يمكن حجزها ابتداءً من لحظة معيّنة حتى إغلاق نفس اليوم — يُستخدَم
 * لتقييد خيارات المدة في الواجهة وللتحقق منها على الخادم بنفس المنطق تماماً.
 * يُعيد 0 إن كان اليوم إجازة أو الوقت خارج نافذة الدوام.
 */
export function maxBookableHoursFrom(at: Date): number {
  const w = businessWindowFor(at);
  if (!w) return 0;
  const hour = riyadhHourOfDay(at);
  if (hour < w.openHour || hour >= w.closeHour) return 0;
  return Math.max(0, w.closeHour - hour);
}

const ARABIC_DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** اسم اليوم بالعربية لرسائل الخطأ الواضحة. */
export function riyadhDayName(at: Date): string {
  return ARABIC_DAY_NAMES[riyadhDayOfWeek(at)];
}

/** وصف مختصر لساعات الدوام يُعرض للعميل. */
export const BUSINESS_HOURS_SUMMARY = "الأحد–الخميس 8 ص – 10 م، السبت 9 ص – 10 م، والجمعة إجازة";

import type { BookingDTO, CheckInLogDTO } from "@/types";
import {
  isWithinBusinessHours,
  packageDailyBudgetMs,
  packageDayWindow,
  riyadhHourOfDay,
  riyadhHourOnSameDay,
} from "@/lib/business-hours";

/** مهلة الوصول للمقعد بعد مسح الباركود قبل بدء احتساب وقت الحجز المدفوع. */
export const ARRIVAL_BUFFER_SECONDS = 30;

/** إذا تبقّى هذا القدر أو أقل من وقت الحجز، يتحول التنبيه للون الأحمر الحاد. */
export const RED_ALERT_THRESHOLD_MS = 30 * 60 * 1000;

export type LiveAttendanceState =
  | { phase: "ARRIVING"; msUntilCountdownStarts: number }
  | { phase: "COUNTDOWN"; msRemaining: number; isAlert: boolean }
  | { phase: "OVERTIME"; msOvertime: number };

/** يجد آخر سجل CHECK_IN مرتبط بمعلومات المؤقت (لتحديد الحالة الحية لحجز حاضر حالياً). */
export function findActiveCheckInLog(
  checkInLogs: CheckInLogDTO[] | undefined
): CheckInLogDTO | undefined {
  return checkInLogs?.find((log) => log.action === "CHECK_IN" && log.bufferEndsAt && log.success);
}

/**
 * يحسب الحالة الحية (ARRIVING / COUNTDOWN / OVERTIME) لحجز مسجَّل حضوره الآن،
 * اعتماداً فقط على الطوابع الزمنية المخزَّنة في السيرفر (bufferEndsAt / expectedEndTime)
 * ووقت الجهاز الحالي — لا حاجة لاستدعاء الـ API في كل تكة عدّاد.
 */
export function computeLiveState(log: CheckInLogDTO | undefined, now: number): LiveAttendanceState | null {
  if (!log?.bufferEndsAt || !log.expectedEndTime) return null;

  const bufferEndsAt = new Date(log.bufferEndsAt).getTime();
  const expectedEndTime = new Date(log.expectedEndTime).getTime();

  if (now < bufferEndsAt) {
    return { phase: "ARRIVING", msUntilCountdownStarts: bufferEndsAt - now };
  }

  const msRemaining = expectedEndTime - now;
  if (msRemaining <= 0) {
    return { phase: "OVERTIME", msOvertime: -msRemaining };
  }

  return { phase: "COUNTDOWN", msRemaining, isAlert: msRemaining <= RED_ALERT_THRESHOLD_MS };
}

/**
 * شكل أدنى لسجل الحضور تقبله دوال حساب الرصيد — يعمل مع كائنات Prisma الخام
 * (حيث الحقول الزمنية من نوع Date) وأيضاً مع CheckInLogDTO المُسلسَل من الـ API
 * (حيث الحقول الزمنية نصوص ISO) دون الحاجة لتحويل يدوي بينهما.
 */
export interface CheckInLogLike {
  action: "CHECK_IN" | "CHECK_OUT";
  timestamp: string | Date;
  actualStartTime?: string | Date | null;
  success: boolean;
}

/** وحدة التقريب الزمني المعتمدة لاحتساب الوقت المستهلك: ربع ساعة. */
export const BILLING_QUARTER_MS = 15 * 60 * 1000;

/**
 * يقرّب مدة زمنية لأعلى (Ceiling) لأقرب ربع ساعة — سياسة احتساب الوقت المعتمدة
 * للعملاء: 26 دقيقة تُحتسب 30، و42 دقيقة تُحتسب 45، وهكذا. مدة صفرية تبقى صفراً
 * (لا تُحوَّل إلى ربع ساعة) حتى لا تُخصَم دقائق من رصيد جلسة لم تبدأ أصلاً.
 */
export function ceilToQuarterHourMs(ms: number): number {
  if (ms <= 0) return 0;
  return Math.ceil(ms / BILLING_QUARTER_MS) * BILLING_QUARTER_MS;
}

/** الباقات القصيرة (ساعة/4 ساعات/يومي) تُغلَق نهائياً بعد استهلاك وقتها أو أول
 *  انصراف — لا رصيد يُستأنف لاحقاً. الباقات الشهرية على النقيض تُستأنف عبر
 *  جلسات متعددة (حضور/انصراف) حتى نفاد الرصيد الكلي المدفوع. آمنة للاستخدام
 *  على العميل (client) والسيرفر معاً — مجرّد مقارنة نصوص، بلا اعتماديات Node. */
export function isResumableBookingType(bookingType: string): boolean {
  return bookingType === "MONTHLY_MORNING" || bookingType === "MONTHLY_EVENING";
}

/**
 * إجمالي الوقت الفعلي المُستهلَك عبر كل جلسات الحضور المكتملة (CHECK_IN→CHECK_OUT)
 * لهذا الحجز — يُستثنى منه أي جلسة حالية لم تُغلَق بعد (يُحسب لحظياً بشكل منفصل).
 * `roundSessionsToQuarterHour`: للباقات الشهرية القابلة للاستئناف — كل جلسة مكتملة
 * تُقرَّب لأعلى لأقرب ربع ساعة قبل خصمها من الرصيد الكلي (26 دقيقة → 30، و42 → 45)،
 * فيبدأ عدّاد أي عودة لاحقة من نفس الوقت المقرَّب الذي انتهت عنده الجلسة السابقة
 * بالضبط، بلا كسور دقائق متراكمة.
 */
export function computeElapsedActiveMs(
  checkInLogs: CheckInLogLike[] | undefined,
  options?: { roundSessionsToQuarterHour?: boolean }
): number {
  if (!checkInLogs || checkInLogs.length === 0) return 0;
  const sorted = [...checkInLogs]
    .filter((l) => l.success)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let elapsed = 0;
  let sessionStart: number | null = null;
  for (const log of sorted) {
    if (log.action === "CHECK_IN" && log.actualStartTime) {
      sessionStart = new Date(log.actualStartTime).getTime();
    } else if (log.action === "CHECK_OUT" && sessionStart !== null) {
      // Math.max(0, ...) لأن الانصراف قد يحدث أثناء مهلة الوصول (قبل بدء actualStartTime
      // فعلياً)، فتكون timestamp < sessionStart ونحصل على مدة سالبة تُضخّم الرصيد المتبقي
      // فوق ما تم دفعه فعلياً لو لم نمنعها.
      let sessionMs = Math.max(0, new Date(log.timestamp).getTime() - sessionStart);
      if (options?.roundSessionsToQuarterHour) {
        sessionMs = ceilToQuarterHourMs(sessionMs);
      }
      elapsed += sessionMs;
      sessionStart = null;
    }
  }
  return elapsed;
}

/**
 * الوقت المتبقي من "رصيد" الحجز (المدة الكاملة المدفوعة ناقص كل الجلسات
 * المكتملة سابقاً). للباقات الشهرية فقط: الانصراف لا يعني انتهاء الحجز — فقط
 * توقّف استهلاك الوقت مؤقتاً، ويُستأنف الرصيد المتبقي (مقرَّباً لأقرب ساعة لكل
 * جلسة) عند أي عودة لاحقة. الباقات القصيرة (ساعة/4 ساعات/يومي) ليست قابلة
 * للاستئناف أصلاً — بمجرد تسجيل الانصراف مرة واحدة ينتهي الحجز نهائياً والوقت
 * المتبقي يصبح صفراً فوراً، بصرف النظر عمّا استُهلِك فعلياً من الوقت المدفوع.
 */
export function computeRemainingBudgetMs(
  booking: {
    startTime: string | Date;
    endTime: string | Date;
    bookingType?: string;
    status?: string;
    checkInLogs?: CheckInLogLike[];
  },
  now: number = Date.now()
): number {
  const resumable = booking.bookingType ? isResumableBookingType(booking.bookingType) : true;

  if (!resumable) {
    if (booking.status === "CHECKED_OUT") return 0;
    const totalBudgetMs = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
    const elapsed = computeElapsedActiveMs(booking.checkInLogs, { roundSessionsToQuarterHour: false });
    return Math.max(0, totalBudgetMs - elapsed);
  }

  // الباقة الشهرية: الرصيد ليس (endTime - startTime) — تلك 30 يوماً متصلة (720
  // ساعة!) وهو رقم بلا معنى للعميل. الرصيد الحقيقي *يومي*: طول نافذة الباقة
  // (7 ساعات) ناقص ما استُهلك منها اليوم، ومحدوداً أيضاً بما تبقّى فعلياً حتى
  // إغلاق نافذة اليوم — فلا يُعرض رصيد لا يمكن استخدامه قبل انتهاء الفترة.
  if (now > new Date(booking.endTime).getTime()) return 0;

  const bookingType = booking.bookingType ?? "";
  const dailyBudgetMs = packageDailyBudgetMs(bookingType);
  if (dailyBudgetMs === 0) return 0;

  const usedTodayMs = computeElapsedActiveMs(todaysLogs(booking.checkInLogs, now), {
    roundSessionsToQuarterHour: true,
  });

  const window = packageDayWindow(bookingType);
  const msUntilWindowCloses = window
    ? riyadhHourOnSameDay(new Date(now), window.closeHour).getTime() - now
    : dailyBudgetMs;

  return Math.max(0, Math.min(dailyBudgetMs - usedTodayMs, msUntilWindowCloses));
}

/**
 * الأيام المتبقية في اشتراك شهري — هذا هو "الرصيد" الذي يهم المشترك فعلاً.
 *
 * عرض الرصيد بالساعات كان مربكاً: الاشتراك ليس رصيد ساعات يُستهلك، بل حق حضور
 * يومي متجدد ضمن فترته طوال مدته. الساعات المتبقية *اليوم* تُعرض في العدّاد
 * أثناء الجلسة فقط (computeRemainingBudgetMs)، أما الرصيد العام فبالأيام.
 *
 * يُحتسب باليوم التقويمي بتوقيت الرياض (لا بفارق 24 ساعة) — اشتراك ينتهي غداً
 * ظهراً يبقى "يوم واحد" وليس نصف يوم. يُعيد 0 عند الانتهاء.
 */
export function remainingSubscriptionDays(
  booking: { endTime: string | Date },
  now: number = Date.now()
): number {
  const endDay = riyadhDayStartMs(new Date(booking.endTime).getTime());
  const today = riyadhDayStartMs(now);
  return Math.max(0, Math.round((endDay - today) / (24 * 60 * 60 * 1000)));
}

/** صياغة عربية سليمة لعدد الأيام (يوم/يومان/أيام). */
export function dayCountLabel(days: number): string {
  if (days <= 0) return "انتهى الاشتراك";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  if (days <= 10) return `${days} أيام`;
  return `${days} يوماً`;
}

/** يقصر سجلات الحضور على جلسات اليوم الحالي (بتوقيت الرياض) — لحساب الرصيد اليومي للباقات. */
function todaysLogs(logs: CheckInLogLike[] | undefined, now: number): CheckInLogLike[] | undefined {
  if (!logs) return logs;
  const dayStart = riyadhDayStartMs(now);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return logs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return t >= dayStart && t < dayEnd;
  });
}

/**
 * الإجراء التالي المنطقي لهذا الحجز — المصدر الوحيد لقاعدة "أول مسح = دخول،
 * والمسح التالي = خروج (أو إيقاف مؤقت للباقات الشهرية)".
 *
 * يُستخدَم على الخادم لاستنتاج الإجراء من حالة الحجز بدل قبوله من المستدعي
 * (فلا يمكن لأحد أن يفرض "خروج" على حجز لم يُسجَّل دخوله، أو يكرر الدخول)،
 * وعلى الواجهة لعرض ما سيحدث عند المسح. `null` يعني لا إجراء صالح حالياً.
 *
 * يطابق تماماً شرط `validOrigin` في src/lib/checkin-core.ts.
 */
export function deriveNextCheckAction(booking: {
  status: string;
  bookingType: string;
}): "CHECK_IN" | "CHECK_OUT" | null {
  // الملغى والمرفوض فقط لا إجراء لهما (قرار إداري صريح).
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") return null;
  // حضور قائم → الإجراء التالي هو الانصراف. أي حالة أخرى → حضور: بانتظار
  // التأكيد، أو مؤكَّد، أو متأخر (NO_SHOW)، أو عاد بعد انصراف سابق.
  if (booking.status === "CHECKED_IN") return "CHECK_OUT";
  return "CHECK_IN";
}

/**
 * هل نحن الآن داخل نافذة الباقة الشهرية اليومية (الصباحية 8ص–3م أو المسائية
 * 3م–10م)؟ هذا هو القيد الزمني الصحيح لمشترك شهري — وليس نافذة "±30 دقيقة حول
 * وقت البدء" المخصَّصة لحجز مفرد بموعد محدد. المشترك يحضر أي يوم ضمن اشتراكه
 * وفي أي وقت ضمن فترته.
 */
export function isWithinPackageWindow(bookingType: string, now: number = Date.now()): boolean {
  const window = packageDayWindow(bookingType);
  if (!window) return false;
  if (!isWithinBusinessHours(new Date(now))) return false;
  const hour = riyadhHourOfDay(new Date(now));
  return hour >= window.openHour && hour < window.closeHour;
}

/** نص وصفي لنافذة الباقة يُعرض في رسائل الرفض. */
export function packageWindowLabel(bookingType: string): string {
  const w = packageDayWindow(bookingType);
  if (!w) return "";
  const fmt = (h: number) => (h < 12 ? `${h} صباحاً` : h === 12 ? "12 ظهراً" : `${h - 12} مساءً`);
  return `${fmt(w.openHour)} – ${fmt(w.closeHour)}`;
}

/** بداية اليوم بتوقيت الرياض (UTC+3 ثابت) للحظة معطاة، كطابع زمني UTC. */
function riyadhDayStartMs(at: number): number {
  const shifted = new Date(at + 3 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 3 * 60 * 60 * 1000;
}

/**
 * هل ما زال رمز QR الخاص بهذا الحجز صالحاً للعرض/المسح؟
 *
 * القاعدة تختلف جذرياً بين نوعَي الحجز:
 * - الباقات الشهرية (القابلة للاستئناف): الرمز يبقى صالحاً طوال مدة الاشتراك
 *   كاملة عبر جلسات حضور/انصراف متعددة — تسجيل الانصراف لا يُنهي الاشتراك، فلا
 *   يجوز إخفاء الرمز بعده. يسقط فقط بانتهاء مدة الاشتراك نفسها (endTime).
 * - الحجوزات غير المتجددة (ساعة/4 ساعات/يومي): رمز الحجز اليومي صالح ليومه فقط —
 *   ينتهي بأول انصراف فعلي، أو بانقضاء يوم الحجز نفسه بتوقيت الرياض أيهما أسبق،
 *   فلا يبقى رمز يوم أمس قابلاً للعرض والمسح اليوم.
 * الحالات المنتهية (ملغى/مرفوض/عدم حضور) لا رمز لها في كل الأحوال.
 *
 * هذا الفحص للعرض فقط — الرفض الفعلي يفرضه الخادم في checkin-core.ts.
 */
export function isBookingQrUsable(
  booking: { status: string; bookingType: string; startTime: string | Date; endTime: string | Date },
  now: number = Date.now()
): boolean {
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW" || booking.status === "REJECTED") {
    return false;
  }

  const endMs = new Date(booking.endTime).getTime();

  if (isResumableBookingType(booking.bookingType)) {
    return now <= endMs;
  }

  if (booking.status === "CHECKED_OUT") return false;
  // ما زال ضمن يوم الحجز نفسه بتوقيت الرياض (أو لم يبدأ بعد).
  return riyadhDayStartMs(now) <= riyadhDayStartMs(new Date(booking.startTime).getTime());
}

/** يهيّئ فرق وقت (بالميلي ثانية) كنص mm:ss أو hh:mm:ss. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function customerNameOf(booking: BookingDTO): string {
  return booking.user?.name ?? booking.guestName ?? "عميل";
}

/**
 * علامة نصية تُضاف إلى ملاحظات الحجز عند إلغائه تلقائياً (لا يدوياً من موظف)
 * بسبب عدم تأكيده خلال مهلة السماح — راجع reconcileExpiredBookings في
 * src/lib/booking-lifecycle.ts (خادم فقط). موجودة هنا (ملف آمن للعميل) ليستخدمها
 * كل من الخادم (عند كتابتها) والواجهة (عند عرض السبب المناسب للحجوزات الملغاة).
 */
export const AUTO_CANCEL_NOTE_MARKER = "[AUTO_CANCEL_NO_CONFIRM]";

/** سبب إلغاء واضح للعميل والموظف: تلقائي لعدم التأكيد، أو يدوي من الإدارة. */
export function cancellationReasonText(notes: string | null | undefined): string {
  if (notes?.includes(AUTO_CANCEL_NOTE_MARKER)) {
    return "أُلغي الحجز تلقائياً لعدم تأكيده خلال 5 دقائق من إنشائه";
  }
  return "تم إلغاء هذا الحجز من قِبل الإدارة";
}

export type DisplayStatus =
  | "PENDING"
  | "CONFIRMED"
  | "ACTIVE_NOW"
  | "COMPLETED"
  | "MISSED"
  | "CANCELLED"
  | "REJECTED";

/**
 * حالة معروضة موحَّدة لسجل الحجوزات — تُقابل حالة قاعدة البيانات الخام مباشرةً
 * (بلا حسابات زمنية إضافية مثل "متأخر" سابقاً)، باستثناء CHECKED_IN التي تُعرض
 * دائماً كـ"نشط الآن" بصرف النظر عن تجاوز الوقت من عدمه. تُستخدم في صفحة سجل
 * جميع الحجوزات لتصنيف/تصفية الصفوف.
 */
export function deriveDisplayStatus(
  booking: { status: string; startTime: string | Date; checkInLogs?: CheckInLogDTO[] },
  now: number
): DisplayStatus {
  switch (booking.status) {
    case "REJECTED":
      return "REJECTED";
    case "CANCELLED":
      return "CANCELLED";
    case "NO_SHOW":
      return "MISSED";
    case "CHECKED_OUT":
      return "COMPLETED";
    case "CHECKED_IN":
      return "ACTIVE_NOW";
    case "CONFIRMED":
      return "CONFIRMED";
    default:
      return "PENDING";
  }
}

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  PENDING: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  ACTIVE_NOW: "نشط الآن",
  COMPLETED: "مكتمل",
  MISSED: "فائت",
  CANCELLED: "ملغي",
  REJECTED: "مرفوض",
};

export const DISPLAY_STATUS_COLORS: Record<DisplayStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-300",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-300",
  ACTIVE_NOW: "bg-emerald-100 text-emerald-800 border-emerald-300",
  COMPLETED: "bg-gray-100 text-gray-600 border-gray-300",
  MISSED: "bg-rose-100 text-rose-800 border-rose-300",
  CANCELLED: "bg-gray-100 text-gray-400 border-gray-200",
  REJECTED: "bg-red-200 text-red-800 border-red-400",
};

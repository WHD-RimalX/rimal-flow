import type { BookingDTO, CheckInLogDTO } from "@/types";

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

const HOUR_MS = 60 * 60 * 1000;

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
 * `roundSessionsToHour`: للباقات الشهرية فقط — كل جلسة مكتملة تُقرَّب لأقرب ساعة
 * كاملة قبل خصمها من الرصيد الكلي (لأن نظام التسعير بالساعة يفرض حداً أدنى ساعة
 * واحدة لكل حجز، فالتسوية بعد كل جلسة تتبع نفس المنطق).
 */
export function computeElapsedActiveMs(
  checkInLogs: CheckInLogLike[] | undefined,
  options?: { roundSessionsToHour?: boolean }
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
      if (options?.roundSessionsToHour) {
        sessionMs = Math.round(sessionMs / HOUR_MS) * HOUR_MS;
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
export function computeRemainingBudgetMs(booking: {
  startTime: string | Date;
  endTime: string | Date;
  bookingType?: string;
  status?: string;
  checkInLogs?: CheckInLogLike[];
}): number {
  const resumable = booking.bookingType ? isResumableBookingType(booking.bookingType) : true;
  if (!resumable && booking.status === "CHECKED_OUT") {
    return 0;
  }

  const totalBudgetMs = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
  const elapsed = computeElapsedActiveMs(booking.checkInLogs, { roundSessionsToHour: resumable });
  return Math.max(0, totalBudgetMs - elapsed);
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

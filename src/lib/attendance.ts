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

/**
 * إجمالي الوقت الفعلي المُستهلَك عبر كل جلسات الحضور المكتملة (CHECK_IN→CHECK_OUT)
 * لهذا الحجز — يُستثنى منه أي جلسة حالية لم تُغلَق بعد (يُحسب لحظياً بشكل منفصل).
 */
export function computeElapsedActiveMs(checkInLogs: CheckInLogLike[] | undefined): number {
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
      elapsed += Math.max(0, new Date(log.timestamp).getTime() - sessionStart);
      sessionStart = null;
    }
  }
  return elapsed;
}

/**
 * الوقت المتبقي من "رصيد" الحجز (المدة الكاملة المدفوعة ناقص كل الجلسات
 * المكتملة سابقاً). الانصراف لا يعني انتهاء الحجز — فقط توقّف استهلاك الوقت
 * مؤقتاً؛ لهذا نستخدم هذه الدالة لبدء/استئناف العدّاد عند كل تسجيل دخول جديد،
 * ولعرض الوقت المتبقي حتى بعد تسجيل الانصراف بدل اعتباره "مكتملاً".
 */
export function computeRemainingBudgetMs(booking: {
  startTime: string | Date;
  endTime: string | Date;
  checkInLogs?: CheckInLogLike[];
}): number {
  const totalBudgetMs = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
  const elapsed = computeElapsedActiveMs(booking.checkInLogs);
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

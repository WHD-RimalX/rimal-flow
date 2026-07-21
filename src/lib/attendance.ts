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

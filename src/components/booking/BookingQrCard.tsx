"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useNow } from "@/lib/hooks/useNow";
import {
  computeLiveState,
  computeRemainingBudgetMs,
  findActiveCheckInLog,
  formatDuration,
  isResumableBookingType,
} from "@/lib/attendance";
import { BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS, BOOKING_TYPE_LABELS, formatArabicDateTime, formatSAR } from "@/lib/utils";
import type { BookingDTO } from "@/types";

/** يعرض حالة الوقت الحية لحجز العميل: بانتظار الوصول / عدّاد تنازلي / تجاوز / رصيد متبقٍ بعد الانصراف. */
function LiveTimerLine({ booking, now }: { booking: BookingDTO; now: number }) {
  const resumable = isResumableBookingType(booking.bookingType);

  if (booking.status === "CHECKED_OUT") {
    if (!resumable) {
      return <p className="text-sm font-bold text-gray-400">انتهت الجلسة — هذا الحجز مغلق</p>;
    }
    const remainingMs = computeRemainingBudgetMs(booking);
    if (remainingMs <= 0) {
      return <p className="text-sm font-bold text-gray-400">تم استهلاك كامل الرصيد</p>;
    }
    return <p className="text-sm font-bold text-rimal-purple">الرصيد المتبقي: {formatDuration(remainingMs)}</p>;
  }

  if (booking.status === "CHECKED_IN") {
    const liveState = computeLiveState(findActiveCheckInLog(booking.checkInLogs), now);
    if (!liveState) return null;
    if (liveState.phase === "ARRIVING") {
      return <p className="text-sm font-bold text-rimal-purple">جارِ الوصول للمقعد...</p>;
    }
    if (liveState.phase === "COUNTDOWN") {
      return (
        <p className={`text-lg font-extrabold ${liveState.isAlert ? "text-floor-alert" : "text-rimal-purple"}`}>
          {formatDuration(liveState.msRemaining)}
        </p>
      );
    }
    return <p className="text-lg font-extrabold text-floor-alert">تجاوزت الوقت بـ {formatDuration(liveState.msOvertime)}</p>;
  }

  if (booking.status === "PENDING" || booking.status === "CONFIRMED") {
    return <p className="text-sm text-gray-500">بانتظار تسجيل الحضور عند وصولك</p>;
  }

  return null;
}

export function BookingQrCard({ booking }: { booking: BookingDTO }) {
  const [showQr, setShowQr] = useState(false);
  const now = useNow(1000);

  const resumable = isResumableBookingType(booking.bookingType);
  const isClosed = booking.status === "CANCELLED" || booking.status === "NO_SHOW" || (booking.status === "CHECKED_OUT" && !resumable);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-gray-900">{booking.space.name}</p>
          <p className="text-xs text-gray-500">
            {BOOKING_TYPE_LABELS[booking.bookingType]} — {formatArabicDateTime(booking.startTime)}
          </p>
          <p className="mt-1 font-mono text-xs text-gray-400">{booking.bookingCode}</p>
        </div>
        <span className={`badge ${BOOKING_STATUS_COLORS[booking.status]}`}>{BOOKING_STATUS_LABELS[booking.status]}</span>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <LiveTimerLine booking={booking} now={now} />
      </div>

      {!isClosed && (
        <div className="mt-4">
          {showQr ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl border-4 border-rimal-purple/10 bg-white p-3">
                <QRCodeSVG value={booking.qrToken} size={176} fgColor="#4f3569" level="M" />
              </div>
              <p className="text-center text-xs text-gray-500">أظهر هذا الرمز للاستقبال عند الوصول أو المغادرة</p>
              <button
                type="button"
                onClick={() => setShowQr(false)}
                className="text-xs font-semibold text-gray-400 hover:text-rimal-purple"
              >
                إخفاء الرمز
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowQr(true)} className="btn-primary w-full">
              عرض رمز QR
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-left text-xs text-gray-400">{formatSAR(Number(booking.finalPrice))}</p>
    </div>
  );
}

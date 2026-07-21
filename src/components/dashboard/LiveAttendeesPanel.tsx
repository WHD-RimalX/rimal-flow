"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useNow } from "@/lib/hooks/useNow";
import { computeLiveState, customerNameOf, findActiveCheckInLog, formatDuration } from "@/lib/attendance";
import type { BookingDTO } from "@/types";

interface LiveAttendeesPanelProps {
  refreshSignal?: number;
}

/**
 * شاشة "الحاضرون الآن" — تعرض لكل حجز مسجَّل حضوره حالياً مؤقتاً تنازلياً حياً،
 * وتتحول صفوفه للون التنبيه الأحمر-الأرجواني عند تبقّي 30 دقيقة أو أقل.
 */
export function LiveAttendeesPanel({ refreshSignal }: LiveAttendeesPanelProps) {
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const now = useNow(1000);

  useEffect(() => {
    let mounted = true;
    function load() {
      const today = new Date().toISOString().slice(0, 10);
      apiFetch<{ bookings: BookingDTO[] }>(`/api/bookings?date=${today}&status=CHECKED_IN`)
        .then((data) => mounted && setBookings(data.bookings))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshSignal]);

  if (bookings.length === 0) {
    return (
      <div className="card">
        <h2 className="mb-1 text-sm font-bold text-gray-700">الحاضرون الآن</h2>
        <p className="text-sm text-gray-400">لا يوجد عملاء حاضرون حالياً</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="mb-4 text-sm font-bold text-gray-700">الحاضرون الآن</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bookings.map((booking) => {
          const liveState = computeLiveState(findActiveCheckInLog(booking.checkInLogs), now);
          const alert =
            liveState?.phase === "OVERTIME" || (liveState?.phase === "COUNTDOWN" && liveState.isAlert);

          return (
            <div
              key={booking.id}
              className={`rounded-2xl p-4 shadow-sm transition ${
                alert ? "animate-pulse-soft bg-floor-alert text-white" : "bg-floor-occupied/10 text-gray-800"
              }`}
            >
              <p className="text-xs font-bold">{booking.space.name}</p>
              <p className={`text-[11px] ${alert ? "text-white/85" : "text-gray-500"}`}>
                {customerNameOf(booking)}
              </p>

              <p className={`mt-2 text-lg font-extrabold tracking-wide ${alert ? "text-white" : "text-rimal-purple"}`}>
                {liveState?.phase === "ARRIVING" && "جارِ الوصول..."}
                {liveState?.phase === "COUNTDOWN" && formatDuration(liveState.msRemaining)}
                {liveState?.phase === "OVERTIME" && `+${formatDuration(liveState.msOvertime)}`}
                {!liveState && "—"}
              </p>
              <p className={`text-[11px] ${alert ? "text-white/85" : "text-gray-400"}`}>
                {liveState?.phase === "ARRIVING"
                  ? "مهلة الوصول للمقعد"
                  : liveState?.phase === "OVERTIME"
                  ? "تجاوز الوقت المحدد"
                  : "الوقت المتبقي"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

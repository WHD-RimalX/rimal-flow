"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useNow } from "@/lib/hooks/useNow";
import { computeLiveState, findActiveCheckInLog, formatDuration } from "@/lib/attendance";
import type { BookingDTO } from "@/types";

interface SeatManagePanelProps {
  booking: BookingDTO;
  onClose: () => void;
  onUpdated: () => void;
}

/** نافذة إدارة مقعد مشغول من الخريطة — تسجيل خروج أو إلغاء التخصيص مباشرة من المقعد نفسه. */
export function SeatManagePanel({ booking, onClose, onUpdated }: SeatManagePanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const liveState = computeLiveState(findActiveCheckInLog(booking.checkInLogs), now);
  const customerName = booking.user?.name ?? booking.guestName ?? "عميل";

  async function handleCheckOut() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ bookingCode: booking.bookingCode, action: "CHECK_OUT" }),
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الخروج");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnassign() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ seatIndex: null }),
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر إلغاء تخصيص المقعد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-[0_20px_60px_rgba(76,53,105,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">إدارة المقعد المشغول</p>
            <h3 className="text-base font-bold text-gray-900">{booking.space.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="rounded-xl bg-rimal-purple-50 p-4 text-sm">
          <p className="font-bold text-gray-900">{customerName}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-500">{booking.bookingCode}</p>
          <p className="mt-2 text-xs text-gray-500">الوقت المتبقي</p>
          <p
            className={`text-lg font-extrabold ${
              liveState?.phase === "OVERTIME" || (liveState?.phase === "COUNTDOWN" && liveState.isAlert)
                ? "text-floor-alert"
                : "text-rimal-purple"
            }`}
          >
            {liveState?.phase === "ARRIVING" && "جارِ الوصول..."}
            {liveState?.phase === "COUNTDOWN" && formatDuration(liveState.msRemaining)}
            {liveState?.phase === "OVERTIME" && `+${formatDuration(liveState.msOvertime)}`}
            {!liveState && "—"}
          </p>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        <div className="mt-4 grid grid-cols-1 gap-2">
          <button type="button" disabled={submitting} onClick={handleCheckOut} className="btn-accent w-full">
            {submitting ? "..." : "تسجيل خروج"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleUnassign}
            className="w-full rounded-xl border-0 bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-200"
          >
            إلغاء تخصيص المقعد (يبقى العميل مسجَّل حضوره)
          </button>
        </div>
      </div>
    </div>
  );
}

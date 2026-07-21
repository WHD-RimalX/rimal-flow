"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ar } from "date-fns/locale";
import { apiFetch } from "@/lib/api-client";
import { BOOKING_STATUS_COLORS, BOOKING_TYPE_LABELS } from "@/lib/utils";
import type { BookingDTO } from "@/types";

type ViewMode = "day" | "week" | "month";

export function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    // باگ سابق: كان from=to=anchorDate (نفس اللحظة بالضبط) فلا يطابق أي حجز.
    // التصحيح: احتساب حدود اليوم كاملاً (00:00 → 23:59:59) — نفس منطق السيرفر لباراميتر date.
    if (viewMode === "day") return { from: startOfDay(anchorDate), to: endOfDay(anchorDate) };
    if (viewMode === "week")
      return {
        from: startOfWeek(anchorDate, { weekStartsOn: 6 }),
        to: endOfWeek(anchorDate, { weekStartsOn: 6 }),
      };
    return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
  }, [viewMode, anchorDate]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    apiFetch<{ bookings: BookingDTO[] }>(`/api/bookings?${params.toString()}`)
      .then((data) => setBookings(data.bookings))
      .finally(() => setLoading(false));
  }, [range]);

  function shift(direction: 1 | -1) {
    if (viewMode === "day") setAnchorDate((d) => addDays(d, direction));
    else if (viewMode === "week") setAnchorDate((d) => addWeeks(d, direction));
    else setAnchorDate((d) => addMonths(d, direction));
  }

  const days = useMemo(() => {
    const list: Date[] = [];
    let cursor = range.from;
    if (viewMode === "month") cursor = startOfWeek(range.from, { weekStartsOn: 6 });
    const end = viewMode === "month" ? endOfWeek(range.to, { weekStartsOn: 6 }) : range.to;
    while (cursor <= end) {
      list.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return list;
  }, [range, viewMode]);

  function bookingsForDay(day: Date) {
    return bookings
      .filter((b) => isSameDay(new Date(b.startTime), day))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="btn-secondary !px-3 !py-1.5 text-xs">
            السابق
          </button>
          <p className="min-w-[10rem] text-center text-sm font-bold">
            {format(anchorDate, "d MMMM yyyy", { locale: ar })}
          </p>
          <button onClick={() => shift(1)} className="btn-secondary !px-3 !py-1.5 text-xs">
            التالي
          </button>
        </div>

        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === mode ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
              }`}
            >
              {mode === "day" ? "يومي" : mode === "week" ? "أسبوعي" : "شهري"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">جارِ تحميل التقويم...</p>
      ) : viewMode === "month" ? (
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => {
            const dayBookings = bookingsForDay(day);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[90px] rounded-xl border p-2 text-xs ${
                  isSameMonth(day, anchorDate) ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 text-gray-300"
                } ${isSameDay(day, new Date()) ? "ring-2 ring-rimal-orange/40" : ""}`}
              >
                <p className="mb-1 font-bold">{format(day, "d")}</p>
                {dayBookings.length > 0 && (
                  <span className="badge border-rimal-purple/30 bg-rimal-purple-50 text-rimal-purple">
                    {dayBookings.length} حجز
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`grid gap-3 ${viewMode === "day" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-7"}`}>
          {days.map((day) => {
            const dayBookings = bookingsForDay(day);
            return (
              <div key={day.toISOString()} className="rounded-xl border border-gray-100 p-2">
                <p className="mb-2 border-b border-dashed pb-1 text-center text-xs font-bold text-gray-600">
                  {format(day, "EEEE d MMM", { locale: ar })}
                </p>
                <div className="space-y-1.5">
                  {dayBookings.length === 0 && (
                    <p className="text-center text-[11px] text-gray-300">لا حجوزات</p>
                  )}
                  {dayBookings.map((b) => (
                    <div
                      key={b.id}
                      className={`rounded-lg border p-1.5 text-[11px] ${BOOKING_STATUS_COLORS[b.status]}`}
                      title={`${b.space.name} — ${BOOKING_TYPE_LABELS[b.bookingType]}`}
                    >
                      <p className="font-semibold">{format(new Date(b.startTime), "HH:mm")}</p>
                      <p className="truncate">{b.space.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

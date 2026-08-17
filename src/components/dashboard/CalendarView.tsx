"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ar } from "date-fns/locale";
import { apiFetch } from "@/lib/api-client";
import {
  DISPLAY_STATUS_COLORS,
  DISPLAY_STATUS_LABELS,
  deriveDisplayStatus,
} from "@/lib/attendance";
import { BOOKING_TYPE_LABELS, formatDateTime, formatSAR } from "@/lib/utils";
import type { BookingDTO } from "@/types";

export function CalendarView() {
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const range = useMemo(
    () => ({ from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) }),
    [anchorDate]
  );

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
    setAnchorDate((d) => addMonths(d, direction));
    setSelectedDay(null);
  }

  const days = useMemo(() => {
    const list: Date[] = [];
    let cursor = startOfWeek(range.from, { weekStartsOn: 6 });
    const end = endOfWeek(range.to, { weekStartsOn: 6 });
    while (cursor <= end) {
      list.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return list;
  }, [range]);

  function bookingsForDay(day: Date) {
    return bookings
      .filter((b) => isSameDay(new Date(b.startTime), day))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  const selectedDayBookings = selectedDay ? bookingsForDay(selectedDay) : [];

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="btn-secondary !px-3 !py-1.5 text-xs">
              الشهر السابق
            </button>
            <p className="min-w-[10rem] text-center text-sm font-bold">
              {format(anchorDate, "MMMM yyyy", { locale: ar })}
            </p>
            <button onClick={() => shift(1)} className="btn-secondary !px-3 !py-1.5 text-xs">
              الشهر التالي
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">جارِ تحميل التقويم...</p>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => {
              const dayBookings = bookingsForDay(day);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[90px] rounded-xl border p-2 text-right text-xs transition ${
                    isSameMonth(day, anchorDate) ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 text-gray-300"
                  } ${isSameDay(day, new Date()) ? "ring-2 ring-rimal-orange/40" : ""} ${
                    isSelected ? "outline outline-2 outline-rimal-purple" : ""
                  } hover:border-rimal-purple/40`}
                >
                  <p className="mb-1 font-bold">{format(day, "d")}</p>
                  {dayBookings.length > 0 && (
                    <span className="badge border-rimal-purple/30 bg-rimal-purple-50 text-rimal-purple">
                      {dayBookings.length} حجز
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedDay && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">
              حجوزات {format(selectedDay, "EEEE d MMMM yyyy", { locale: ar })}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-xs font-semibold text-gray-400 hover:text-rimal-purple">
              إغلاق
            </button>
          </div>

          {selectedDayBookings.length === 0 ? (
            <p className="text-sm text-gray-500">لا توجد حجوزات في هذا اليوم</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400">
                    <th className="pb-2 font-medium">الوقت</th>
                    <th className="pb-2 font-medium">العميل</th>
                    <th className="pb-2 font-medium">المساحة</th>
                    <th className="pb-2 font-medium">الباقة</th>
                    <th className="pb-2 font-medium">السعر</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayBookings.map((b) => {
                    const displayStatus = deriveDisplayStatus(b, Date.now());
                    return (
                      <tr key={b.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2.5 text-xs text-gray-600">{formatDateTime(b.startTime)}</td>
                        <td className="py-2.5">
                          {b.user?.name ?? b.guestName}
                          <p className="text-xs text-gray-400">{b.user?.phone ?? b.guestPhone}</p>
                        </td>
                        <td className="py-2.5">{b.space.name}</td>
                        <td className="py-2.5 text-xs text-gray-600">{BOOKING_TYPE_LABELS[b.bookingType]}</td>
                        <td className="py-2.5 font-semibold">{formatSAR(Number(b.finalPrice))}</td>
                        <td className="py-2.5">
                          <span className={`badge ${DISPLAY_STATUS_COLORS[displayStatus]}`}>
                            {DISPLAY_STATUS_LABELS[displayStatus]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

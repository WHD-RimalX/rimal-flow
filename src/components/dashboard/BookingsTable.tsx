"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useNow } from "@/lib/hooks/useNow";
import { cancellationReasonText, computeLiveState, computeRemainingBudgetMs, findActiveCheckInLog, formatDuration } from "@/lib/attendance";
import { ALLOWED_ADMIN_TRANSITIONS } from "@/lib/booking-transitions";
import {
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_LABELS,
  BOOKING_TYPE_LABELS,
  formatArabicDateTime,
  formatSAR,
} from "@/lib/utils";
import type { BookingDTO, BookingStatus } from "@/types";

const PAGE_SIZE = 10;

// أزرار الحالة اليدوية عبر PATCH /api/admin/bookings/:id — يجب أن تطابق
// ALLOWED_ADMIN_TRANSITIONS تماماً (السيرفر يرفض أي انتقال خارجها بـ409 الآن،
// SECURITY-AUDIT.md §3). CHECKED_IN→CHECKED_OUT مُستبعَد عمداً هنا؛ "تسجيل
// انصراف" له زر منفصل يمرّ عبر محرك الحضور (/api/checkin) لا هذا المسار.
const NEXT_ACTIONS: Partial<Record<BookingStatus, { label: string; next: BookingStatus }[]>> = {
  PENDING: [
    { label: "تأكيد", next: "CONFIRMED" },
    { label: "رفض", next: "REJECTED" },
    { label: "إلغاء", next: "CANCELLED" },
  ],
  CONFIRMED: [
    { label: "تسجيل عدم حضور", next: "NO_SHOW" },
    { label: "إلغاء", next: "CANCELLED" },
  ],
};

type FilterId = "full_day" | "checked_in" | "checked_out";

// "جميع المسجلين" أُزيلت من هنا — لوحة اليوم مقصورة على تشغيل اليوم الحالي؛
// عرض كل الحجوزات (بكل الحالات وكل التواريخ) أصبح له صفحة مستقلة: سجل الحجوزات.
const FILTERS: { id: FilterId; label: string; status?: string }[] = [
  { id: "full_day", label: "حضور اليوم كامل", status: "CHECKED_IN,CHECKED_OUT" },
  { id: "checked_in", label: "الموجودون حالياً", status: "CHECKED_IN" },
  { id: "checked_out", label: "المنصرفون", status: "CHECKED_OUT" },
];

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * خلية الوقت المتبقي — تبقى ظاهرة حتى بعد تسجيل الانصراف، لأن الانصراف لا يعني
 * انتهاء الحجز (قد يعود العميل لاحقاً ويستكمل رصيده المتبقي من نفس الحجز).
 */
function RemainingTimeCell({ booking, now }: { booking: BookingDTO; now: number }) {
  if (booking.status === "CHECKED_OUT") {
    const remainingMs = computeRemainingBudgetMs(booking);
    if (remainingMs <= 0) {
      return <span className="text-xs font-semibold text-gray-400">انتهى الوقت بالكامل</span>;
    }
    return <span className="text-xs font-semibold text-gray-500">{formatDuration(remainingMs)} متبقٍ</span>;
  }
  if (booking.status === "NO_SHOW") {
    return <span className="text-xs font-semibold text-rose-600">أُلغي الحجز بسبب عدم الحضور</span>;
  }
  if (booking.status === "CANCELLED") {
    return (
      <span className="text-xs text-gray-400" title={cancellationReasonText(booking.notes)}>
        ملغي — {cancellationReasonText(booking.notes)}
      </span>
    );
  }
  if (booking.status === "REJECTED") {
    return <span className="text-xs text-gray-400">مرفوض من الإدارة</span>;
  }

  const liveState =
    booking.status === "CHECKED_IN" ? computeLiveState(findActiveCheckInLog(booking.checkInLogs), now) : null;

  if (!liveState) return <span className="text-xs text-gray-300">—</span>;

  if (liveState.phase === "ARRIVING") {
    return <span className="text-xs font-semibold text-rimal-purple">جارِ الوصول...</span>;
  }
  if (liveState.phase === "COUNTDOWN") {
    return (
      <span className={`text-xs font-bold ${liveState.isAlert ? "text-floor-alert" : "text-rimal-purple"}`}>
        {formatDuration(liveState.msRemaining)}
      </span>
    );
  }
  return <span className="text-xs font-bold text-floor-alert">+{formatDuration(liveState.msOvertime)}</span>;
}

interface BookingsTableProps {
  /** أي تغيير في هذه القيمة يجبر الجدول على إعادة التحميل فوراً (مثلاً بعد حجز فوري من الخريطة). */
  refreshSignal?: number;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function BookingsTable({ refreshSignal }: BookingsTableProps = {}) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";

  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("full_day");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const now = useNow(1000);

  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      date: selectedDate,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (activeFilter.status) params.set("status", activeFilter.status);
    apiFetch<{ bookings: BookingDTO[]; total: number }>(`/api/bookings?${params.toString()}`)
      .then((data) => {
        setBookings(data.bookings);
        setTotal(data.total);
      })
      .catch(() => setError("تعذّر تحميل الحجوزات"))
      .finally(() => setLoading(false));
  }, [activeFilter.status, page, selectedDate]);

  // إعادة الصفحة إلى 1 عند تغيير الفلتر أو التاريخ لتفادي عرض صفحة فارغة بعد تضييق النتائج
  useEffect(() => {
    setPage(1);
  }, [filter, selectedDate]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [load, refreshSignal]);

  async function updateStatus(bookingId: string, status: BookingStatus) {
    setUpdatingId(bookingId);
    try {
      // تحويلات الحالة (تأكيد/إلغاء/عدم حضور...) عبر المسار الإداري المخصَّص لها —
      // PATCH /api/bookings/:id العام أصبح مقتصراً على تخصيص المقعد (seatIndex) فقط.
      await apiFetch(`/api/admin/bookings/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تحديث حالة الحجز");
    } finally {
      setUpdatingId(null);
    }
  }

  // تسجيل الانصراف يمر عبر محرك الحضور (نفس مسار الماسح) لا مسار الحالة العام —
  // هو من يُنشئ سجل CheckInLog المرافق ويحرر المقعد تلقائياً عند الاقتضاء
  // (SECURITY-AUDIT.md §3: تحديث CHECKED_OUT المباشر كان يفسد سجلات الحضور).
  async function performCheckOut(booking: BookingDTO) {
    setUpdatingId(booking.id);
    try {
      await apiFetch("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ bookingCode: booking.bookingCode, action: "CHECK_OUT" }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الانصراف");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-700">الحجوزات — لوحة التحكم الزمنية</h2>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border-0 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 shadow-sm"
          />
          {selectedDate !== todayIso() && (
            <button
              onClick={() => setSelectedDate(todayIso())}
              className="text-xs font-semibold text-rimal-purple hover:underline"
            >
              اليوم
            </button>
          )}
          <button onClick={load} className="text-xs font-semibold text-rimal-purple hover:underline">
            تحديث
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filter === f.id ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">جارِ التحميل...</p>
      ) : bookings.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد حجوزات مطابقة لهذا الفلتر</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th className="pb-2 font-medium">الوقت</th>
                  <th className="pb-2 font-medium">العميل</th>
                  <th className="pb-2 font-medium">المساحة</th>
                  <th className="pb-2 font-medium">الباقة</th>
                  <th className="pb-2 font-medium">السعر</th>
                  <th className="pb-2 font-medium">الوقت المتبقي</th>
                  <th className="pb-2 font-medium">الحالة</th>
                  <th className="pb-2 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-xs text-gray-600">
                      {formatArabicDateTime(booking.startTime)}
                      {isToday(booking.startTime) && (
                        <span className="mr-1 text-[10px] text-rimal-orange">● اليوم</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {booking.user?.name ?? booking.guestName}
                      <p className="text-xs text-gray-400">{booking.user?.phone ?? booking.guestPhone}</p>
                    </td>
                    <td className="py-2.5">{booking.space.name}</td>
                    <td className="py-2.5 text-xs text-gray-600">{BOOKING_TYPE_LABELS[booking.bookingType]}</td>
                    <td className="py-2.5 font-semibold">{formatSAR(Number(booking.finalPrice))}</td>
                    <td className="py-2.5">
                      <RemainingTimeCell booking={booking} now={now} />
                    </td>
                    <td className="py-2.5">
                      <span className={`badge ${BOOKING_STATUS_COLORS[booking.status]}`}>
                        {BOOKING_STATUS_LABELS[booking.status]}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {booking.status === "CHECKED_IN" && (
                          <button
                            disabled={updatingId === booking.id}
                            onClick={() => performCheckOut(booking)}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
                          >
                            تسجيل انصراف
                          </button>
                        )}
                        {(NEXT_ACTIONS[booking.status] ?? []).map((action) => (
                          <button
                            key={action.next}
                            disabled={updatingId === booking.id}
                            onClick={() => updateStatus(booking.id, action.next)}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
                          >
                            {action.label}
                          </button>
                        ))}
                        {/* المدير فقط يملك خيار الإلغاء، ومتاح فقط عندما يكون انتقالاً صالحاً فعلياً
                            حسب آلة الحالة المركزية (حالات نهائية كـCHECKED_OUT/CANCELLED لا تقبل أي انتقال) */}
                        {isAdmin &&
                          !(NEXT_ACTIONS[booking.status] ?? []).some((a) => a.next === "CANCELLED") &&
                          ALLOWED_ADMIN_TRANSITIONS[booking.status]?.has("CANCELLED") && (
                            <button
                              disabled={updatingId === booking.id}
                              onClick={() => updateStatus(booking.id, "CANCELLED")}
                              className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:border-red-400 disabled:opacity-40"
                            >
                              إلغاء
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400">
              {total} حجز إجمالاً — صفحة {page} من {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
              >
                السابق
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
              >
                الصفحة التالية
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

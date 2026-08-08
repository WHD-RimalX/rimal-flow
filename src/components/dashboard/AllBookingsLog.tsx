"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useNow } from "@/lib/hooks/useNow";
import {
  DISPLAY_STATUS_COLORS,
  DISPLAY_STATUS_LABELS,
  deriveDisplayStatus,
  type DisplayStatus,
} from "@/lib/attendance";
import { BOOKING_TYPE_LABELS, formatArabicDateTime, formatSAR } from "@/lib/utils";
import type { BookingDTO, SpaceDTO } from "@/types";

const PAGE_SIZE = 10;

const DISPLAY_FILTERS: { id: "ALL" | DisplayStatus; label: string }[] = [
  { id: "ALL", label: "الكل" },
  { id: "PENDING", label: DISPLAY_STATUS_LABELS.PENDING },
  { id: "CONFIRMED", label: DISPLAY_STATUS_LABELS.CONFIRMED },
  { id: "ACTIVE_NOW", label: DISPLAY_STATUS_LABELS.ACTIVE_NOW },
  { id: "COMPLETED", label: DISPLAY_STATUS_LABELS.COMPLETED },
  { id: "MISSED", label: DISPLAY_STATUS_LABELS.MISSED },
  { id: "CANCELLED", label: DISPLAY_STATUS_LABELS.CANCELLED },
  { id: "REJECTED", label: DISPLAY_STATUS_LABELS.REJECTED },
];

/** الحالات القابلة للتعديل يدوياً بحرية عبر هذه القائمة — تحويل مباشر بين أي منها. */
const EDITABLE_STATUSES = [
  { value: "PENDING", label: "قيد الانتظار" },
  { value: "CONFIRMED", label: "تأكيد" },
  { value: "REJECTED", label: "رفض" },
  { value: "CANCELLED", label: "إلغاء" },
];

/**
 * الحالات الخام التي يمكن للإداري تحويل الحجز إليها يدوياً، حسب حالته الحالية.
 * الحجوزات ضمن EDITABLE_STATUSES قابلة للتنقل الحر بينها كلها (بانتظار/تأكيد/
 * رفض/إلغاء). CHECKED_IN يُسمح فقط بإلغائه (تجاوزاً) — لا يجوز إعادته لبانتظار
 * أو تأكيد لأن ذلك يفقد سجلات الحضور الفعلية (bufferEndsAt/expectedEndTime).
 * CHECKED_OUT وNO_SHOW حالات نهائية ناتجة عن تدفّق فعلي (حضور/تسوية تلقائية)
 * ولا تُعدَّل يدوياً من هنا.
 */
function nextStatusOptions(rawStatus: string): { value: string; label: string }[] {
  if (EDITABLE_STATUSES.some((s) => s.value === rawStatus)) {
    return EDITABLE_STATUSES.filter((s) => s.value !== rawStatus);
  }
  if (rawStatus === "CHECKED_IN") {
    return [{ value: "CANCELLED", label: "إلغاء" }];
  }
  return [];
}

/**
 * سجل شامل لكل الحجوزات (بما فيها الاشتراكات الشهرية والحجوزات الملغاة/المنتهية) —
 * بلا تقييد بيوم واحد كلوحة اليوم التشغيلية؛ التصنيف حسب حالة معروضة موحَّدة
 * (قيد الانتظار/مؤكد/نشط الآن/مكتمل/فائت/ملغي/مرفوض) تقابل حالة قاعدة البيانات
 * الخام مباشرةً. يدعم أيضاً التصفية حسب المساحة وتاريخ محدَّد (يُطبَّقان سيرفرياً).
 */
export function AllBookingsLog() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";

  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | DisplayStatus>("ALL");
  const [spaceFilter, setSpaceFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const now = useNow(1000);

  useEffect(() => {
    apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces")
      .then((data) => setSpaces(data.spaces))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (spaceFilter !== "ALL") params.set("spaceId", spaceFilter);
    if (dateFilter) params.set("date", dateFilter);
    const qs = params.toString();
    apiFetch<{ bookings: BookingDTO[] }>(`/api/bookings${qs ? `?${qs}` : ""}`)
      .then((data) => setBookings(data.bookings))
      .catch(() => setError("تعذّر تحميل سجل الحجوزات"))
      .finally(() => setLoading(false));
  }, [spaceFilter, dateFilter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function changeStatus(bookingId: string, status: string) {
    setUpdatingId(bookingId);
    try {
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

  const rows = bookings
    .map((b) => ({ booking: b, displayStatus: deriveDisplayStatus(b, now) }))
    .filter((r) => filter === "ALL" || r.displayStatus === filter)
    .filter((r) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const name = (r.booking.user?.name ?? r.booking.guestName ?? "").toLowerCase();
      const phone = (r.booking.user?.phone ?? r.booking.guestPhone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || r.booking.bookingCode.toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.booking.startTime).getTime() - new Date(a.booking.startTime).getTime());

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [filter, query, spaceFilter, dateFilter]);

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-700">سجل جميع الحجوزات</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={spaceFilter}
            onChange={(e) => setSpaceFilter(e.target.value)}
            className="rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 shadow-sm"
          >
            <option value="ALL">كل المساحات</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 shadow-sm"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} className="text-xs font-semibold text-gray-400 hover:text-rimal-purple">
              إزالة التاريخ
            </button>
          )}
          <input
            type="text"
            placeholder="بحث بالاسم/الجوال/كود الحجز"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 shadow-sm"
          />
          <button onClick={load} className="text-xs font-semibold text-rimal-purple hover:underline">
            تحديث
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
        {DISPLAY_FILTERS.map((f) => (
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
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد حجوزات مطابقة</p>
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
                <th className="pb-2 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ booking, displayStatus }) => {
                const options = nextStatusOptions(booking.status);
                return (
                  <tr key={booking.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-xs text-gray-600">{formatArabicDateTime(booking.startTime)}</td>
                    <td className="py-2.5">
                      {booking.user?.name ?? booking.guestName}
                      <p className="text-xs text-gray-400">{booking.user?.phone ?? booking.guestPhone}</p>
                    </td>
                    <td className="py-2.5">{booking.space.name}</td>
                    <td className="py-2.5 text-xs text-gray-600">{BOOKING_TYPE_LABELS[booking.bookingType]}</td>
                    <td className="py-2.5 font-semibold">{formatSAR(Number(booking.finalPrice))}</td>
                    <td className="py-2.5">
                      <span className={`badge ${DISPLAY_STATUS_COLORS[displayStatus]}`}>
                        {DISPLAY_STATUS_LABELS[displayStatus]}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {isAdmin && options.length > 0 ? (
                        <select
                          disabled={updatingId === booking.id}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) changeStatus(booking.id, e.target.value);
                          }}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 disabled:opacity-40"
                        >
                          <option value="">إجراء...</option>
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>
              عرض {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} من {rows.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 transition hover:border-rimal-purple/40 disabled:opacity-40"
              >
                السابق
              </button>
              <span className="font-semibold text-gray-700">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 transition hover:border-rimal-purple/40 disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

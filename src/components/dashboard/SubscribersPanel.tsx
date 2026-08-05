"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useNow } from "@/lib/hooks/useNow";
import { computeRemainingBudgetMs, formatDuration } from "@/lib/attendance";
import { customerNameOf } from "@/lib/attendance";
import { formatArabicDateTime, formatSAR } from "@/lib/utils";
import type { BookingDTO, BookingType } from "@/types";

const SUBSCRIPTION_TYPES: { type: BookingType; label: string; accent: string }[] = [
  { type: "MONTHLY_MORNING", label: "الاشتراك الصباحي", accent: "border-amber-300" },
  { type: "MONTHLY_EVENING", label: "الاشتراك المسائي", accent: "border-indigo-300" },
];

type SubStatus = "ACTIVE" | "PRESENT" | "EXPIRED" | "CANCELLED";

const SUB_STATUS_LABELS: Record<SubStatus, string> = {
  ACTIVE: "نشط",
  PRESENT: "حاضر الآن",
  EXPIRED: "منتهي",
  CANCELLED: "ملغي",
};

const SUB_STATUS_COLORS: Record<SubStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  PRESENT: "bg-blue-100 text-blue-800 border-blue-300",
  EXPIRED: "bg-gray-100 text-gray-500 border-gray-300",
  CANCELLED: "bg-rose-100 text-rose-800 border-rose-300",
};

function deriveSubStatus(booking: BookingDTO, now: number): SubStatus {
  if (booking.status === "CANCELLED") return "CANCELLED";
  if (booking.status === "CHECKED_IN") return "PRESENT";
  if (new Date(booking.endTime).getTime() < now) return "EXPIRED";
  return "ACTIVE";
}

/** لوحة المشتركين — تعرض فقط حجوزات الباقات الشهرية (صباحي/مسائي)، مصنَّفة حسب نوع الاشتراك. */
export function SubscribersPanel() {
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ bookings: BookingDTO[] }>("/api/bookings")
      .then((data) =>
        setBookings(
          data.bookings.filter((b) => b.bookingType === "MONTHLY_MORNING" || b.bookingType === "MONTHLY_EVENING")
        )
      )
      .catch(() => setError("تعذّر تحميل قائمة المشتركين"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return <p className="text-sm text-gray-500">جارِ التحميل...</p>;
  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {SUBSCRIPTION_TYPES.map((group) => {
        const groupBookings = bookings
          .filter((b) => b.bookingType === group.type)
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        return (
          <div key={group.type} className={`card border-t-4 ${group.accent}`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">{group.label}</h3>
              <span className="badge border-rimal-purple/30 bg-rimal-purple-50 text-rimal-purple">
                {groupBookings.length} مشترك
              </span>
            </div>

            {groupBookings.length === 0 ? (
              <p className="text-sm text-gray-400">لا يوجد مشتركون في هذه الفئة</p>
            ) : (
              <div className="space-y-3">
                {groupBookings.map((b) => {
                  const subStatus = deriveSubStatus(b, now);
                  const remainingMs = computeRemainingBudgetMs(b);
                  return (
                    <div key={b.id} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-gray-900">{customerNameOf(b)}</p>
                          <p className="text-xs text-gray-400">{b.user?.phone ?? b.guestPhone}</p>
                        </div>
                        <span className={`badge ${SUB_STATUS_COLORS[subStatus]}`}>
                          {SUB_STATUS_LABELS[subStatus]}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-gray-500">
                        <span>المساحة: {b.space.name}</span>
                        <span className="text-left">{formatSAR(Number(b.finalPrice))}</span>
                        <span>بدأ: {formatArabicDateTime(b.startTime)}</span>
                        <span className="text-left">ينتهي: {formatArabicDateTime(b.endTime)}</span>
                      </div>
                      {subStatus !== "EXPIRED" && subStatus !== "CANCELLED" && (
                        <p className="mt-2 text-xs font-semibold text-rimal-purple">
                          الرصيد المتبقي: {formatDuration(remainingMs)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

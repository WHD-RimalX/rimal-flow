"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { BookingType } from "@/types";

interface Slot {
  startTime: string;
  isAvailable: boolean;
}

const WINDOW_BY_TYPE: Partial<Record<BookingType, { startHour: number; endHour: number; label: string }>> = {
  MONTHLY_MORNING: { startHour: 8, endHour: 15, label: "فترتك الصباحية (8:00 ص – 3:00 م)" },
  MONTHLY_EVENING: { startHour: 15, endHour: 22, label: "فترتك المسائية (3:00 م – 10:00 م)" },
};

function formatRiyadhTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Riyadh" });
}

/**
 * مؤشر إرشادي (بلا أي حجز/تسجيل فعلي) لمشتركي الباقة الشهرية — يعرض إشغال
 * اليوم الحالي مقصوراً على فترتهم (صباحي/مسائي) فقط، ليساعدهم على اختيار وقت
 * وصول أقل ازدحاماً. الاشتراك نفسه يسمح بالحضور في أي وقت ضمن الفترة أصلاً —
 * هذا عرض معلوماتي فقط، لا يُنشئ أو يحجز أي فتحة وقت.
 */
export function MonthlyArrivalPreview({ spaceId, bookingType }: { spaceId: string; bookingType: BookingType }) {
  const window = WINDOW_BY_TYPE[bookingType];
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useEffect(() => {
    if (!window) return;
    const today = new Date().toISOString().slice(0, 10);
    apiFetch<{ slots: Slot[] }>(`/api/availability?spaceId=${spaceId}&date=${today}&granularityMinutes=60`)
      .then((data) => setSlots(data.slots))
      .catch(() => setSlots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, bookingType]);

  if (!window) return null;

  const windowSlots = (slots ?? []).filter((s) => {
    const riyadhHour = (new Date(s.startTime).getUTCHours() + 3) % 24;
    return riyadhHour >= window.startHour && riyadhHour < window.endHour;
  });

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-bold text-gray-700">{window.label}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        إشغال اليوم ضمن فترتك — للاسترشاد فقط؛ اشتراكك يسمح لك بالحضور في أي وقت ضمن هذه الفترة بلا حجز إضافي.
      </p>
      {!slots ? (
        <p className="mt-2 text-[11px] text-gray-400">جارِ تحميل الإشغال...</p>
      ) : (
        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {windowSlots.map((s) => (
            <div
              key={s.startTime}
              className={`rounded-lg px-1 py-1.5 text-center text-[10px] font-semibold ${
                s.isAvailable ? "bg-white text-gray-600 ring-1 ring-gray-200" : "bg-floor-occupied text-white/90"
              }`}
            >
              {formatRiyadhTime(s.startTime)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

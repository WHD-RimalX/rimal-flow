"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Slot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

interface TimeSlotPickerProps {
  spaceId: string | null;
  date: string; // YYYY-MM-DD
  value: string | null; // ISO datetime للفتحة المختارة
  onChange: (isoStartTime: string) => void;
}

function formatRiyadhTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Riyadh",
  });
}

/**
 * منتقي وقت بصري بدقائق مضاعفات العشرة — الفتحات المحجوزة تظهر بلون الخريطة
 * الموف الغامق (floor-occupied) ولا يمكن اختيارها، والفتحة المختارة تظهر بلون
 * الخريطة الموف الفاتح (floor-bg) — نفس منطق ألوان الخريطة التفاعلية بالضبط.
 */
export function TimeSlotPicker({ spaceId, date, value, onChange }: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId || !date) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlots(null);
    setError(null);
    apiFetch<{ slots: Slot[] }>(
      `/api/availability?spaceId=${spaceId}&date=${date}&granularityMinutes=10`
    )
      .then((data) => !cancelled && setSlots(data.slots))
      .catch(() => !cancelled && setError("تعذّر تحميل الأوقات المتاحة"));
    return () => {
      cancelled = true;
    };
  }, [spaceId, date]);

  if (!spaceId) return null;
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!slots) return <p className="text-xs text-gray-400">جارِ تحميل الأوقات المتاحة...</p>;
  if (slots.length === 0) return <p className="text-xs text-gray-400">لا تتوفر أوقات لهذا اليوم</p>;

  return (
    <div>
      <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto rounded-xl bg-gray-50 p-2 sm:grid-cols-6">
        {slots.map((slot) => {
          const isSelected = value === slot.startTime;
          return (
            <button
              key={slot.startTime}
              type="button"
              disabled={!slot.isAvailable}
              onClick={() => onChange(slot.startTime)}
              className={`rounded-lg px-1.5 py-2 text-[11px] font-semibold transition ${
                !slot.isAvailable
                  ? "bg-floor-occupied text-white/90 cursor-not-allowed opacity-90"
                  : isSelected
                  ? "bg-floor-bg text-rimal-purple-dark ring-2 ring-rimal-purple"
                  : "bg-white text-gray-600 hover:bg-floor-bg/60"
              }`}
            >
              {formatRiyadhTime(slot.startTime)}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-floor-occupied" /> محجوز
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-floor-bg ring-1 ring-rimal-purple" /> مختار
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-white ring-1 ring-gray-200" /> متاح
        </span>
      </div>
    </div>
  );
}

"use client";

import { MAX_HOURLY_DURATION, hourLabel } from "@/lib/booking-wizard-helpers";

interface HourStepperProps {
  value: number;
  onChange: (hours: number) => void;
  min?: number;
  max?: number;
}

/** منتقي عدد الساعات (1 إلى 10 افتراضياً) — بديل أجمل من صف أزرار طويل أو قائمة select عادية. */
export function HourStepper({ value, onChange, min = 1, max = MAX_HOURLY_DURATION }: HourStepperProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 px-2 py-1.5">
      <button
        type="button"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-rimal-purple transition hover:bg-rimal-purple-50 disabled:opacity-30"
        aria-label="إنقاص ساعة"
      >
        −
      </button>
      <div className="text-center">
        <p className="text-lg font-extrabold text-gray-900">{value}</p>
        <p className="text-[11px] text-gray-500">{hourLabel(value)}</p>
      </div>
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-rimal-purple transition hover:bg-rimal-purple-50 disabled:opacity-30"
        aria-label="زيادة ساعة"
      >
        +
      </button>
    </div>
  );
}

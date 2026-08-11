"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { SLOT_GRANULARITY_MINUTES } from "@/lib/business-hours";

interface Slot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  reason: "PAST" | "BOOKED" | null;
}

/** سبب تعطيل الفتحة كما يعرضه المنتقي — يضيف "CLOSING" فوق أسباب الخادم. */
type SlotBlockReason = Slot["reason"] | "CLOSING";

interface TimeSlotPickerProps {
  spaceId: string | null;
  date: string; // YYYY-MM-DD
  value: string | null; // ISO datetime للفتحة المختارة
  onChange: (isoStartTime: string) => void;
  /** مدة الحجز المطلوبة بالدقائق (مثلاً 120 لباقة ساعتين) — الفتحة تُعتبر متاحة
   *  فقط إن كانت كل الفتحات الفرعية المتتالية اللازمة لتغطية هذه المدة متاحة أيضاً. */
  durationMinutes?: number;
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
 * منتقي وقت بصري بفتحات ربع ساعة (15 دقيقة) — الفتحات المحجوزة تظهر بلون الخريطة
 * الموف الغامق (floor-occupied) ولا يمكن اختيارها، والفتحة المختارة تظهر بلون
 * الخريطة الموف الفاتح (floor-bg) — نفس منطق ألوان الخريطة التفاعلية بالضبط.
 * كل فتحة معطَّلة تحمل سبباً واضحاً (محجوزة / فات وقتها / لا تكفي قبل الإغلاق)
 * بدل رفض صامت، وعند تمرير durationMinutes > 15 تُحسَب الإتاحة عبر كل الفتحات
 * المتتالية اللازمة لتغطية كامل مدة الحجز (لا الفتحة الأولى فقط).
 */
export function TimeSlotPicker({ spaceId, date, value, onChange, durationMinutes = SLOT_GRANULARITY_MINUTES }: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId || !date) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlots(null);
    setClosedReason(null);
    setError(null);
    apiFetch<{ slots: Slot[]; closedReason?: string }>(
      `/api/availability?spaceId=${spaceId}&date=${date}&granularityMinutes=${SLOT_GRANULARITY_MINUTES}`
    )
      .then((data) => {
        if (cancelled) return;
        setSlots(data.slots);
        if (data.slots.length === 0 && data.closedReason) setClosedReason(data.closedReason);
      })
      .catch(() => !cancelled && setError("تعذّر تحميل الأوقات المتاحة"));
    return () => {
      cancelled = true;
    };
  }, [spaceId, date]);

  if (!spaceId) return null;
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!slots) return <p className="text-xs text-gray-400">جارِ تحميل الأوقات المتاحة...</p>;
  if (slots.length === 0) return <p className="text-xs text-gray-400">{closedReason ?? "لا تتوفر أوقات لهذا اليوم"}</p>;

  const requiredSteps = Math.max(1, Math.ceil(durationMinutes / SLOT_GRANULARITY_MINUTES));

  /** يتحقق أن الفتحة ومدة الحجز الكاملة بعدها متاحة، ويُرجع أول سبب رفض يواجهه. */
  function checkCoverage(startIndex: number): { isAvailable: boolean; reason: SlotBlockReason } {
    if (startIndex + requiredSteps > slots!.length) {
      // لا تتبقّى فتحات كافية قبل الإغلاق لتغطية المدة المطلوبة — سبب مختلف
      // تماماً عن "محجوز" ويجب ألا يظهر للعميل كأن أحداً حجزها.
      return { isAvailable: false, reason: "CLOSING" };
    }
    for (let i = startIndex; i < startIndex + requiredSteps; i++) {
      const s = slots![i];
      if (!s.isAvailable) return { isAvailable: false, reason: s.reason };
    }
    return { isAvailable: true, reason: null };
  }

  // الفتحات التي لا يتبقّى بعدها وقت كافٍ قبل الإغلاق تُحذَف من العرض تماماً بدل
  // إظهارها معطَّلة — لا فائدة من عرض وقت لا يمكن حجزه بأي حال. تتكيّف تلقائياً
  // مع المدة المختارة: بحجز 3 ساعات تختفي كل فتحة تبدأ بعد 7 مساءً.
  const selectableSlots = slots
    .map((slot, index) => ({ slot, coverage: checkCoverage(index) }))
    .filter(({ coverage }) => coverage.reason !== "CLOSING");

  if (selectableSlots.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        لا تتوفر أوقات كافية لهذه المدة في هذا اليوم — جرّب مدة أقصر أو يوماً آخر.
      </p>
    );
  }

  return (
    <div>
      <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto rounded-xl bg-gray-50 p-2 sm:grid-cols-6">
        {selectableSlots.map(({ slot, coverage }) => {
          const isSelected = value === slot.startTime;
          const reasonLabel =
            coverage.reason === "PAST" ? "فات الوقت" : coverage.reason === "BOOKED" ? "محجوز" : null;
          return (
            <button
              key={slot.startTime}
              type="button"
              disabled={!coverage.isAvailable}
              title={
                coverage.reason === "PAST"
                  ? "هذا الوقت فات اليوم"
                  : coverage.reason === "BOOKED"
                  ? "هذه الفترة محجوزة بالكامل"
                  : undefined
              }
              onClick={() => onChange(slot.startTime)}
              className={`rounded-lg px-1.5 py-2 text-[11px] font-semibold transition ${
                !coverage.isAvailable
                  ? "bg-floor-occupied text-white/90 cursor-not-allowed opacity-90"
                  : isSelected
                  ? "bg-floor-bg text-rimal-purple-dark ring-2 ring-rimal-purple"
                  : "bg-white text-gray-600 hover:bg-floor-bg/60"
              }`}
            >
              {formatRiyadhTime(slot.startTime)}
              {reasonLabel && <span className="block text-[9px] opacity-90">{reasonLabel}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-floor-occupied" /> محجوز / فات وقته
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

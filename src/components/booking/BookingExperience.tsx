"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { BOOKING_TYPE_LABELS, formatSAR } from "@/lib/utils";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import type { BookingDTO, BookingType, SpaceDTO } from "@/types";

const BOOKING_TYPE_ORDER: BookingType[] = [
  "HOURLY",
  "FOUR_HOUR",
  "DAILY",
  "MONTHLY_MORNING",
  "MONTHLY_EVENING",
];

/** أوصاف إضافية لكل نوع حجز — تُعرض تحت السعر عند اختيار النوع. */
const BOOKING_TYPE_HINTS: Partial<Record<BookingType, string>> = {
  DAILY: "10 ساعات — من بداية الدوام حتى نهايته، لنفس اليوم",
  MONTHLY_MORNING: "الفترة الصباحية: 8:00 صباحاً – 4:00 عصراً، يومياً لمدة 30 يوماً",
  MONTHLY_EVENING: "الفترة المسائية: 4:00 عصراً – 11:00 مساءً، يومياً لمدة 30 يوماً",
};

/** الساعة الثابتة (بتوقيت الرياض) لبدء الحجوزات التي لا تحتاج اختيار وقت دقيق (يومي/شهري). */
const FIXED_START_HOUR: Partial<Record<BookingType, number>> = {
  DAILY: 9,
  MONTHLY_MORNING: 8,
  MONTHLY_EVENING: 16,
};

function priceForType(space: SpaceDTO, type: BookingType): number | null {
  const map: Record<BookingType, string | null> = {
    HOURLY: space.hourlyPrice,
    FOUR_HOUR: space.fourHourPrice,
    DAILY: space.dailyPrice,
    MONTHLY_MORNING: space.monthlyMorningPrice,
    MONTHLY_EVENING: space.monthlyEveningPrice,
  };
  const value = map[type];
  return value ? Number(value) : null;
}

function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** يبني لحظة UTC من تاريخ (يوم فقط) وساعة بتوقيت الرياض الثابت (UTC+3، بلا توقيت صيفي). */
function riyadhDateToIso(dateStr: string, riyadhHour: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, riyadhHour - 3, 0, 0)).toISOString();
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "المساحة",
  2: "نوع الحجز",
  3: "التفاصيل",
  4: "التأكيد",
};

function StepBreadcrumb({ step, maxReached }: { step: Step; maxReached: Step }) {
  return (
    <div className="mb-6 flex items-center gap-2 text-xs">
      {([1, 2, 3, 4] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${
              s === step
                ? "bg-rimal-purple text-white"
                : s < maxReached || s < step
                ? "bg-rimal-purple-50 text-rimal-purple"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {s}
          </span>
          <span className={s === step ? "font-bold text-gray-800" : "text-gray-400"}>{STEP_LABELS[s]}</span>
          {i < 3 && <span className="mx-1 text-gray-300">←</span>}
        </div>
      ))}
    </div>
  );
}

export function BookingExperience() {
  const { data: session } = useSession();
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [bookingType, setBookingType] = useState<BookingType | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [isStudent, setIsStudent] = useState(false);
  const [studentIdNumber, setStudentIdNumber] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingDTO | null>(null);

  useEffect(() => {
    apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces")
      .then((data) => setSpaces(data.spaces))
      .catch(() => setLoadError("تعذّر تحميل المساحات المتاحة"))
      .finally(() => setLoadingSpaces(false));
  }, []);

  const selectedSpace = useMemo(
    () => spaces.find((s) => s.id === selectedSpaceId) ?? null,
    [spaces, selectedSpaceId]
  );

  const availableTypes = useMemo(
    () => (selectedSpace ? BOOKING_TYPE_ORDER.filter((t) => priceForType(selectedSpace, t) !== null) : []),
    [selectedSpace]
  );

  const needsTimeSlot = bookingType === "HOURLY" || bookingType === "FOUR_HOUR";
  const studentEligible = selectedSpace ? Number(selectedSpace.studentDiscount) > 0 : false;

  const previewBase = selectedSpace && bookingType ? priceForType(selectedSpace, bookingType) : null;
  const previewDiscount =
    previewBase && isStudent && studentEligible && selectedSpace
      ? Math.round(previewBase * Number(selectedSpace.studentDiscount) * 100) / 100
      : 0;
  const previewFinal = previewBase !== null ? previewBase - previewDiscount : null;

  const effectiveStartIso = needsTimeSlot
    ? selectedSlotIso
    : bookingType
    ? riyadhDateToIso(selectedDate, FIXED_START_HOUR[bookingType] ?? 9)
    : null;

  function pickSpace(spaceId: string) {
    setSelectedSpaceId(spaceId);
    setBookingType(null);
    setSelectedSlotIso(null);
    setError(null);
    setStep(2);
  }

  function pickType(type: BookingType) {
    setBookingType(type);
    setSelectedSlotIso(null);
    setSelectedDate(toDateInputValue(new Date()));
    setError(null);
    setStep(3);
  }

  async function handleConfirm() {
    if (!selectedSpace || !bookingType || !session?.user || !effectiveStartIso) return;
    setSubmitting(true);
    setError(null);

    try {
      const booking = await apiFetch<BookingDTO>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          spaceId: selectedSpace.id,
          bookingType,
          startDate: effectiveStartIso,
          isStudent,
          studentIdNumber: isStudent ? studentIdNumber : undefined,
        }),
      });
      setResult(booking);
      setStep(4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setStep(1);
    setSelectedSpaceId(null);
    setBookingType(null);
    setSelectedSlotIso(null);
    setResult(null);
    setError(null);
  }

  // ---------- الخطوة 4: نتيجة الحجز ----------
  if (step === 4 && result) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <h3 className="text-lg font-bold text-gray-900">تم تأكيد حجزك بنجاح</h3>
        <p className="mt-1 text-sm text-gray-500">احتفظ بكود الحجز، وستجد رمز QR الخاص به في صفحة حجوزاتي</p>

        <div className="my-4 rounded-xl bg-rimal-purple-50 py-4">
          <p className="text-xs text-gray-500">كود الحجز</p>
          <p className="font-mono text-2xl font-extrabold tracking-widest text-rimal-purple">
            {result.bookingCode}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="text-gray-500">المساحة</div>
          <div className="font-semibold">{result.space.name}</div>
          <div className="text-gray-500">الباقة</div>
          <div className="font-semibold">{BOOKING_TYPE_LABELS[result.bookingType]}</div>
          <div className="text-gray-500">السعر الأساسي</div>
          <div className="font-semibold">{formatSAR(Number(result.basePrice))}</div>
          <div className="text-gray-500">الخصم</div>
          <div className="font-semibold text-emerald-600">-{formatSAR(Number(result.discountAmount))}</div>
          <div className="text-gray-500">الإجمالي</div>
          <div className="text-base font-extrabold text-rimal-orange">{formatSAR(Number(result.finalPrice))}</div>
        </dl>

        <div className="mt-5 flex gap-2">
          <a href="/my-bookings" className="btn-primary flex-1">
            عرض حجوزاتي
          </a>
          <button className="btn-secondary flex-1" onClick={startOver}>
            حجز آخر
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepBreadcrumb step={step} maxReached={step} />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* ---------- الخطوة 1: اختر المساحة ---------- */}
      {step === 1 && (
        <div>
          <h3 className="mb-3 text-sm font-bold text-gray-700">اختر المساحة المناسبة لك</h3>
          {loadingSpaces ? (
            <p className="text-sm text-gray-500">جارِ تحميل المساحات...</p>
          ) : loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.map((space) => (
                <div key={space.id} className="flex flex-col rounded-2xl border border-gray-200 p-4">
                  <p className="font-bold text-gray-900">{space.name}</p>
                  <p className="mt-1 flex-1 text-xs text-gray-500">{space.description}</p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-gray-400">{space.capacityUnits} وحدة</span>
                    {Number(space.studentDiscount) > 0 && (
                      <span className="badge border-rimal-orange/30 bg-rimal-orange-50 text-rimal-orange-600">
                        خصم طلاب {Math.round(Number(space.studentDiscount) * 100)}%
                      </span>
                    )}
                  </div>
                  {space.hourlyPrice && (
                    <p className="mt-2 text-xs text-gray-500">يبدأ من {formatSAR(Number(space.hourlyPrice))}</p>
                  )}
                  <button type="button" onClick={() => pickSpace(space.id)} className="btn-primary mt-4 w-full">
                    احجز الآن
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- الخطوة 2: نوع الحجز ---------- */}
      {step === 2 && selectedSpace && (
        <div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mb-3 text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            → تغيير المساحة
          </button>
          <h3 className="mb-3 text-sm font-bold text-gray-700">
            نوع الحجز — <span className="text-rimal-purple">{selectedSpace.name}</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {availableTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => pickType(type)}
                className="rounded-2xl border border-gray-200 p-4 text-right transition hover:border-rimal-purple/40 hover:bg-rimal-purple-50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900">{BOOKING_TYPE_LABELS[type]}</span>
                  <span className="font-extrabold text-rimal-orange">
                    {formatSAR(priceForType(selectedSpace, type)!)}
                  </span>
                </div>
                {BOOKING_TYPE_HINTS[type] && (
                  <p className="mt-1 text-xs text-gray-500">{BOOKING_TYPE_HINTS[type]}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- الخطوة 3: التفاصيل والتأكيد ---------- */}
      {step === 3 && selectedSpace && bookingType && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mb-3 text-xs font-semibold text-gray-400 hover:text-rimal-purple"
            >
              → تغيير نوع الحجز
            </button>
            <h3 className="mb-1 text-sm font-bold text-gray-700">
              {selectedSpace.name} — {BOOKING_TYPE_LABELS[bookingType]}
            </h3>
            {BOOKING_TYPE_HINTS[bookingType] && (
              <p className="mb-3 text-xs text-gray-500">{BOOKING_TYPE_HINTS[bookingType]}</p>
            )}

            <label className="label-field">التاريخ</label>
            <input
              type="date"
              className="input-field max-w-xs"
              value={selectedDate}
              min={toDateInputValue(new Date())}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setSelectedSlotIso(null);
              }}
              required
            />

            {needsTimeSlot && (
              <div className="mt-3">
                <label className="label-field">وقت البداية</label>
                <TimeSlotPicker
                  spaceId={selectedSpace.id}
                  date={selectedDate}
                  value={selectedSlotIso}
                  onChange={setSelectedSlotIso}
                />
                <p className="mt-1 text-xs text-gray-400">الحجز متاح يومياً من الساعة 9 صباحاً حتى 11 مساءً.</p>
              </div>
            )}

            {studentEligible && (
              <label className="mt-5 flex items-center gap-3 rounded-xl border border-rimal-orange/30 bg-rimal-orange-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={isStudent}
                  onChange={(e) => setIsStudent(e.target.checked)}
                  className="h-4 w-4 accent-rimal-orange"
                />
                <span>أنا طالب — فعّل خصم الطلاب تلقائياً على هذا الحجز</span>
              </label>
            )}
            {isStudent && studentEligible && (
              <input
                className="input-field mt-3 max-w-xs"
                placeholder="الرقم الجامعي"
                value={studentIdNumber}
                onChange={(e) => setStudentIdNumber(e.target.value)}
                required
              />
            )}

            {!session?.user && (
              <div className="mt-6 rounded-xl border border-rimal-purple/20 bg-rimal-purple-50 p-4 text-sm">
                <p className="font-bold text-gray-800">يلزم تسجيل الدخول لإتمام الحجز</p>
                <p className="mt-1 text-gray-600">سجّل دخولك أو أنشئ حساباً جديداً لإكمال العملية.</p>
                <div className="mt-3 flex gap-2">
                  <a href="/auth/login" className="btn-primary px-4 py-2 text-xs">
                    تسجيل الدخول
                  </a>
                  <a
                    href="/auth/register"
                    className="rounded-lg border border-rimal-purple px-4 py-2 text-xs font-semibold text-rimal-purple"
                  >
                    إنشاء حساب
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="card sticky top-20">
              <h3 className="mb-4 text-sm font-bold text-gray-700">ملخص الحجز</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">المساحة</dt>
                  <dd className="font-semibold">{selectedSpace.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">الباقة</dt>
                  <dd className="font-semibold">{BOOKING_TYPE_LABELS[bookingType]}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">السعر الأساسي</dt>
                  <dd className="font-semibold">{previewBase !== null ? formatSAR(previewBase) : "—"}</dd>
                </div>
                {previewDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <dt>خصم الطلاب</dt>
                    <dd>-{formatSAR(previewDiscount)}</dd>
                  </div>
                )}
                <div className="mt-2 flex justify-between border-t border-dashed pt-2 text-base font-extrabold">
                  <dt>الإجمالي المتوقع</dt>
                  <dd className="text-rimal-orange">{previewFinal !== null ? formatSAR(previewFinal) : "—"}</dd>
                </div>
                <p className="text-[11px] text-gray-400">* السعر النهائي يُحتسب ويُعتمد من الخادم عند تأكيد الحجز.</p>
              </dl>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || !session?.user || !effectiveStartIso}
                className="btn-accent mt-5 w-full"
              >
                {!session?.user
                  ? "سجّل الدخول لتأكيد الحجز"
                  : !effectiveStartIso
                  ? "أكمل اختيار الوقت أولاً"
                  : submitting
                  ? "جارِ تأكيد الحجز..."
                  : "تأكيد الحجز"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

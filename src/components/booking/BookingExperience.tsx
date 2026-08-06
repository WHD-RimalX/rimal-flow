"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { BOOKING_TYPE_LABELS, formatSAR } from "@/lib/utils";
import { FIXED_START_HOUR, priceForType, riyadhDateToIso, spaceImageUrl, toDateInputValue } from "@/lib/booking-wizard-helpers";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import type { BookingDTO, BookingType, SpaceDTO } from "@/types";

type MainTab = "spaces" | "memberships";

const SPACE_TYPES: BookingType[] = ["HOURLY", "FOUR_HOUR", "DAILY"];
const MEMBERSHIP_TYPES: BookingType[] = ["MONTHLY_MORNING", "MONTHLY_EVENING"];

/** أوصاف إضافية لكل نوع حجز — تُعرض تحت السعر عند اختيار النوع. */
const BOOKING_TYPE_HINTS: Partial<Record<BookingType, string>> = {
  DAILY: "10 ساعات — من بداية الدوام حتى نهايته، لنفس اليوم",
  MONTHLY_MORNING: "الفترة الصباحية: 8:00 صباحاً – 4:00 عصراً، يومياً لمدة 30 يوماً",
  MONTHLY_EVENING: "الفترة المسائية: 4:00 عصراً – 11:00 مساءً، يومياً لمدة 30 يوماً",
};

const DURATION_OPTIONS: { hours: 1 | 2 | 3; label: string }[] = [
  { hours: 1, label: "ساعة" },
  { hours: 2, label: "ساعتين" },
  { hours: 3, label: "ثلاث ساعات" },
];

const arabicDateOnlyFormatter = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" });

function formatDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return arabicDateOnlyFormatter.format(new Date(y, m - 1, d));
}

/** يضيف عدد أيام لتاريخ (YYYY-MM-DD) ويعيده بنفس الصيغة — لحساب تاريخ نهاية الاشتراك الشهري تلقائياً. */
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

/** مدة الاشتراك الشهري بالأيام — نفس القيمة المستخدمة في computeEndTime على السيرفر (src/lib/pricing.ts). */
const MONTHLY_SUBSCRIPTION_DAYS = 30;

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
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>("spaces");
  const [step, setStep] = useState<Step>(1);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [bookingType, setBookingType] = useState<BookingType | null>(null);
  const [durationHours, setDurationHours] = useState<1 | 2 | 3>(1);
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

  const visibleSpaces = useMemo(
    () =>
      mainTab === "memberships"
        ? spaces.filter((s) => s.monthlyMorningPrice || s.monthlyEveningPrice)
        : spaces,
    [spaces, mainTab]
  );

  const selectedSpace = useMemo(
    () => spaces.find((s) => s.id === selectedSpaceId) ?? null,
    [spaces, selectedSpaceId]
  );

  const availableTypes = useMemo(() => {
    if (!selectedSpace) return [];
    const pool = mainTab === "memberships" ? MEMBERSHIP_TYPES : SPACE_TYPES;
    return pool.filter((t) => priceForType(selectedSpace, t) !== null);
  }, [selectedSpace, mainTab]);

  const needsTimeSlot = bookingType === "HOURLY" || bookingType === "FOUR_HOUR";
  const isMonthly = bookingType === "MONTHLY_MORNING" || bookingType === "MONTHLY_EVENING";
  const studentEligible = selectedSpace ? Number(selectedSpace.studentDiscount) > 0 : false;

  const requiredDurationMinutes = bookingType === "HOURLY" ? durationHours * 60 : bookingType === "FOUR_HOUR" ? 240 : 60;

  const previewBase =
    selectedSpace && bookingType
      ? bookingType === "HOURLY"
        ? (priceForType(selectedSpace, "HOURLY") ?? 0) * durationHours
        : priceForType(selectedSpace, bookingType)
      : null;
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

  function requireLoginOrProceed(action: () => void) {
    if (!session?.user) {
      router.push("/auth/login");
      return;
    }
    action();
  }

  function pickSpace(spaceId: string) {
    requireLoginOrProceed(() => {
      setSelectedSpaceId(spaceId);
      setBookingType(null);
      setSelectedSlotIso(null);
      setError(null);
      setStep(2);
    });
  }

  function pickType(type: BookingType) {
    setBookingType(type);
    setDurationHours(1);
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
          durationHours: bookingType === "HOURLY" ? durationHours : undefined,
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
        <p className="mt-1 text-sm text-gray-500">احتفظ بكود الحجز ورمز QR — ستجدهما أيضاً في صفحة حجوزاتي</p>

        <div className="my-4 rounded-xl bg-rimal-purple-50 py-4">
          <p className="text-xs text-gray-500">كود الحجز</p>
          <p className="font-mono text-2xl font-extrabold tracking-widest text-rimal-purple">
            {result.bookingCode}
          </p>
        </div>

        <div className="mb-4 flex flex-col items-center gap-2">
          <div className="rounded-xl border-4 border-rimal-purple/10 bg-white p-3">
            <QRCodeSVG value={result.qrToken} size={176} fgColor="#4f3569" level="M" />
          </div>
          <p className="text-center text-xs text-gray-500">أظهر هذا الرمز للاستقبال عند الوصول أو المغادرة</p>
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

      {/* ---------- الخطوة 1: المساحات / العضويات ثم اختيار المساحة ---------- */}
      {step === 1 && (
        <div>
          <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1 sm:w-fit">
            <button
              type="button"
              onClick={() => setMainTab("spaces")}
              className={`flex-1 rounded-lg px-5 py-2 text-sm font-bold transition sm:flex-none ${
                mainTab === "spaces" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
              }`}
            >
              المساحات
            </button>
            <button
              type="button"
              onClick={() => setMainTab("memberships")}
              className={`flex-1 rounded-lg px-5 py-2 text-sm font-bold transition sm:flex-none ${
                mainTab === "memberships" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
              }`}
            >
              العضويات
            </button>
          </div>

          <h3 className="mb-3 text-sm font-bold text-gray-700">
            {mainTab === "memberships" ? "اختر مساحتك للاشتراك الشهري" : "اختر المساحة المناسبة لك"}
          </h3>
          {loadingSpaces ? (
            <p className="text-sm text-gray-500">جارِ تحميل المساحات...</p>
          ) : loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : visibleSpaces.length === 0 ? (
            <p className="text-sm text-gray-500">لا تتوفر عضويات شهرية حالياً.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSpaces.map((space) => (
                <div key={space.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200">
                  <div className="relative h-36 w-full bg-gray-100">
                    <Image
                      src={spaceImageUrl(space)}
                      alt={space.name}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
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
                    {mainTab === "memberships" ? (
                      <p className="mt-2 text-xs text-gray-500">
                        يبدأ من {formatSAR(Number(space.monthlyMorningPrice ?? space.monthlyEveningPrice))} / شهرياً
                      </p>
                    ) : (
                      space.hourlyPrice && (
                        <p className="mt-2 text-xs text-gray-500">يبدأ من {formatSAR(Number(space.hourlyPrice))}</p>
                      )
                    )}
                    <button type="button" onClick={() => pickSpace(space.id)} className="btn-primary mt-4 w-full">
                      {mainTab === "memberships" ? "اشترك الآن" : "احجز الآن"}
                    </button>
                  </div>
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
                    {type === "HOURLY" && <span className="text-[10px] font-normal text-gray-400"> /ساعة</span>}
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

            {bookingType === "HOURLY" && (
              <div className="mb-4">
                <label className="label-field">عدد الساعات</label>
                <div className="flex gap-2">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.hours}
                      type="button"
                      onClick={() => {
                        setDurationHours(opt.hours);
                        setSelectedSlotIso(null);
                      }}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        durationHours === opt.hours
                          ? "border-rimal-purple bg-rimal-purple-50 text-rimal-purple"
                          : "border-gray-200 text-gray-600 hover:border-rimal-purple/40"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="label-field">{isMonthly ? "تاريخ بداية الاشتراك" : "التاريخ"}</label>
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

            {isMonthly && selectedDate && (
              <p className="mt-2 text-xs text-gray-500">
                من <span className="font-semibold text-gray-700">{formatDateOnly(selectedDate)}</span> إلى{" "}
                <span className="font-semibold text-gray-700">
                  {formatDateOnly(addDaysToDateStr(selectedDate, MONTHLY_SUBSCRIPTION_DAYS))}
                </span>{" "}
                ({MONTHLY_SUBSCRIPTION_DAYS} يوماً)
              </p>
            )}

            {needsTimeSlot && (
              <div className="mt-3">
                <label className="label-field">وقت البداية</label>
                <TimeSlotPicker
                  spaceId={selectedSpace.id}
                  date={selectedDate}
                  value={selectedSlotIso}
                  onChange={setSelectedSlotIso}
                  durationMinutes={requiredDurationMinutes}
                />
                <p className="mt-1 text-xs text-gray-400">
                  الحجز متاح يومياً من الساعة 9 صباحاً، وآخر موعد لبدء الحجز الساعة 9 مساءً (يُغلق المكان الساعة 10 مساءً).
                </p>
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
                  <dd className="font-semibold">
                    {BOOKING_TYPE_LABELS[bookingType]}
                    {bookingType === "HOURLY" && ` (${DURATION_OPTIONS.find((o) => o.hours === durationHours)?.label})`}
                  </dd>
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

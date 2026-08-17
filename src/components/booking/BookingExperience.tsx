"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { BOOKING_TYPE_LABELS, formatSAR } from "@/lib/utils";
import {
  fixedStartHourForDate,
  hourLabel,
  maxHourlyDurationForDate,
  priceForType,
  riyadhDateToIso,
  toDateInputValue,
} from "@/lib/booking-wizard-helpers";
import { BUSINESS_HOURS_SUMMARY, businessWindowForDateKey } from "@/lib/business-hours";
import { TermsAgreement } from "@/components/booking/TermsAgreement";
import { DateField } from "@/components/ui/DateField";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import { HourStepper } from "@/components/booking/HourStepper";
import { CustomerPicker, type CustomerSelection } from "@/components/booking/CustomerPicker";
import { MembershipPlans } from "@/components/booking/MembershipPlans";
import { CatalogHero } from "@/components/booking/CatalogHero";
import { SpacesCatalog } from "@/components/booking/SpacesCatalog";
import type { BookingDTO, BookingType, SpaceDTO } from "@/types";

type MainTab = "spaces" | "memberships";

// باقة "4 ساعات" الثابتة أُزيلت لصالح باقة الساعة المرنة (1-10 ساعات عبر
// HourStepper) بدلاً منها. الاشتراك الشهري (صباحي/مسائي) عاد متاحاً من هنا
// أيضاً وليس فقط كبطاقات عرض عامة (MembershipPlans) — لأنه فعلياً باقة حقيقية
// لمساحات معينة (كالمساحة المشتركة) ولها سعر وتوقيت محدَّدان في بيانات المساحة.
// الباقة اليومية أُزيلت: الحجز بالساعة يغطيها بالكامل (حتى 14 ساعة = يوم دوام
// كامل)، فوجود باقتين لنفس الشيء كان يربك العميل بلا فائدة.
const SPACE_TYPES: BookingType[] = ["HOURLY", "MONTHLY_MORNING", "MONTHLY_EVENING"];

/** الاشتراكات الشهرية — تُعرض مجمَّعة تحت عنوان "باقات" منفصل عن الحجز المباشر. */
const PACKAGE_TYPES: BookingType[] = ["MONTHLY_MORNING", "MONTHLY_EVENING"];

/** بطاقة اختيار نوع حجز واحد — مشتركة بين مجموعة الحجز المباشر ومجموعة الباقات. */
function TypeCard({
  type,
  space,
  onPick,
}: {
  type: BookingType;
  space: SpaceDTO;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="rounded-2xl border border-gray-200 p-4 text-right transition hover:border-rimal-purple/40 hover:bg-rimal-purple-50"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-900">{BOOKING_TYPE_LABELS[type]}</span>
        <span className="font-extrabold text-rimal-orange">
          {formatSAR(priceForType(space, type)!)}
          {type === "HOURLY" && <span className="text-[10px] font-normal text-gray-400"> /ساعة</span>}
        </span>
      </div>
      {BOOKING_TYPE_HINTS[type] && <p className="mt-1 text-xs text-gray-500">{BOOKING_TYPE_HINTS[type]}</p>}
    </button>
  );
}

/** أوصاف إضافية لكل نوع حجز — تُعرض تحت السعر عند اختيار النوع. */
const BOOKING_TYPE_HINTS: Partial<Record<BookingType, string>> = {
  HOURLY: "احجز من ساعة واحدة حتى يوم الدوام كامل — تدفع مقابل ما تحجزه فقط",
  MONTHLY_MORNING: "الفترة الصباحية: 8:00 صباحاً – 3:00 عصراً، يومياً لمدة 30 يوماً",
  MONTHLY_EVENING: "الفترة المسائية: 3:00 عصراً – 10:00 مساءً، يومياً لمدة 30 يوماً",
};

const arabicDateOnlyFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  calendar: "gregory",
});

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

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: "المساحة",
  2: "نوع الحجز",
  3: "التفاصيل",
};

function StepBreadcrumb({ step }: { step: Step }) {
  return (
    <div className="mb-6 flex items-center gap-2 text-xs">
      {([1, 2, 3] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${
              s === step ? "bg-rimal-purple text-white" : s < step ? "bg-rimal-purple-50 text-rimal-purple" : "bg-gray-100 text-gray-400"
            }`}
          >
            {s}
          </span>
          <span className={s === step ? "font-bold text-gray-800" : "text-gray-400"}>{STEP_LABELS[s]}</span>
          {i < 2 && <span className="mx-1 text-gray-300">←</span>}
        </div>
      ))}
    </div>
  );
}

export function BookingExperience() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // حالة الخطوة/المساحة/النوع مُشتَقة بالكامل من رابط الصفحة (بدل useState محلي)
  // حتى يعمل زرّا الرجوع والتقدّم في المتصفح طبيعياً بين خطوات الحجز — كل انتقال
  // خطوة يدفع (push) رابطاً جديداً، فيتصرف تماماً كالتنقّل بين صفحات عادية.
  const mainTab: MainTab = searchParams.get("tab") === "memberships" ? "memberships" : "spaces";
  const selectedSpaceId = searchParams.get("space");
  const bookingType = searchParams.get("type") as BookingType | null;
  const step: Step = bookingType ? 3 : selectedSpaceId ? 2 : 1;

  const [durationHours, setDurationHours] = useState(1);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [isStudent, setIsStudent] = useState(false);
  const [studentIdNumber, setStudentIdNumber] = useState("");
  const [customerSelection, setCustomerSelection] = useState<CustomerSelection | null>(null);

  const isStaff = session?.user?.role != null && session.user.role !== "USER";

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
    () => (selectedSpace ? SPACE_TYPES.filter((t) => priceForType(selectedSpace, t) !== null) : []),
    [selectedSpace]
  );
  const directTypes = availableTypes.filter((t) => !PACKAGE_TYPES.includes(t));
  const packageTypes = availableTypes.filter((t) => PACKAGE_TYPES.includes(t));

  const isMonthly = bookingType === "MONTHLY_MORNING" || bookingType === "MONTHLY_EVENING";
  const needsTimeSlot = bookingType === "HOURLY";
  const studentEligible = selectedSpace ? Number(selectedSpace.studentDiscount) > 0 : false;

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

  // يوم الجمعة إجازة كاملة — نمنع اختياره من المصدر بدل تركه يفشل عند الإرسال.
  const selectedDayWindow = businessWindowForDateKey(selectedDate);
  const isClosedDay = selectedDayWindow === null;
  // سقف عدد الساعات = طول يوم الدوام المختار (14 عادةً، 13 السبت).
  const maxDuration = Math.max(1, maxHourlyDurationForDate(selectedDate));

  const fixedStartHour = bookingType ? fixedStartHourForDate(bookingType, selectedDate) : null;
  const effectiveStartIso = needsTimeSlot
    ? selectedSlotIso
    : bookingType && fixedStartHour !== null
    ? riyadhDateToIso(selectedDate, fixedStartHour)
    : null;

  function requireLoginOrProceed(action: () => void) {
    if (!session?.user) {
      router.push("/auth/login");
      return;
    }
    action();
  }

  function setMainTab(tab: MainTab) {
    router.push(tab === "spaces" ? "/" : "/?tab=memberships");
  }

  function pickSpace(spaceId: string) {
    requireLoginOrProceed(() => {
      setSelectedSlotIso(null);
      setError(null);
      router.push(`/?tab=${mainTab}&space=${encodeURIComponent(spaceId)}`);
    });
  }

  function pickType(type: BookingType) {
    setDurationHours(1);
    setSelectedSlotIso(null);
    setSelectedDate(toDateInputValue(new Date()));
    setError(null);
    router.push(`/?tab=${mainTab}&space=${encodeURIComponent(selectedSpaceId ?? "")}&type=${encodeURIComponent(type)}`);
  }

  function goToStep1() {
    router.push(mainTab === "spaces" ? "/" : "/?tab=memberships");
  }

  function goToStep2() {
    router.push(`/?tab=${mainTab}&space=${encodeURIComponent(selectedSpaceId ?? "")}`);
  }

  async function handleConfirm() {
    if (!selectedSpace || !bookingType || !session?.user || !effectiveStartIso || !acceptedTerms) return;
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
          acceptedTerms,
          isStudent,
          studentIdNumber: isStudent ? studentIdNumber : undefined,
          ...(isStaff && customerSelection ? customerSelection : {}),
        }),
      });
      setResult(booking);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setResult(null);
    setError(null);
    setCustomerSelection(null);
    router.push("/");
  }

  // ---------- نتيجة الحجز (شاشة عابرة فوق أي خطوة، لا تُسجَّل في الرابط) ----------
  if (result) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="card mx-auto max-w-lg text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
            ✓
          </div>
          <h3 className="text-lg font-bold text-gray-900">تم تأكيد حجزك بنجاح</h3>
          <p className="mt-1 text-sm text-gray-500">
            احتفظ بكود الحجز — ورمز المسح تجده في صفحة حجوزاتي وقت وصولك
          </p>

          <div className="my-4 rounded-xl bg-rimal-purple-50 py-4">
            <p className="text-xs text-gray-500">كود الحجز</p>
            <p className="font-mono text-2xl font-extrabold tracking-widest text-rimal-purple">
              {result.bookingCode}
            </p>
          </div>

          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-center text-xs leading-relaxed text-gray-500">
              رمز المسح مؤقت ويتجدد تلقائياً كل ثوانٍ لحمايتك — افتح صفحة{" "}
              <span className="font-semibold text-rimal-purple">حجوزاتي</span> عند وصولك للمقر لعرضه.
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
      </div>
    );
  }

  // ---------- الخطوة 1: المساحات / العضويات (بطل داكن + كتالوج) ----------
  if (step === 1) {
    return (
      <div>
        <CatalogHero mainTab={mainTab} onTabChange={setMainTab} />
        <div className="mx-auto max-w-6xl px-4 py-10">
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {mainTab === "memberships" ? (
            <MembershipPlans />
          ) : (
            <SpacesCatalog spaces={spaces} loading={loadingSpaces} error={loadError} onPick={pickSpace} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <StepBreadcrumb step={step} />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* ---------- الخطوة 2: نوع الحجز ---------- */}
      {step === 2 && selectedSpace && (
        <div>
          <button type="button" onClick={goToStep1} className="mb-3 text-xs font-semibold text-gray-400 hover:text-rimal-purple">
            → تغيير المساحة
          </button>
          <h3 className="mb-3 text-sm font-bold text-gray-700">
            نوع الحجز — <span className="text-rimal-purple">{selectedSpace.name}</span>
          </h3>
          {/* الحجز المباشر بالساعة أولاً، ثم الاشتراكات الشهرية تحت عنوان "باقات" */}
          {directTypes.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {directTypes.map((type) => (
                <TypeCard
                  key={type}
                  type={type}
                  space={selectedSpace}
                  onPick={() => pickType(type)}
                />
              ))}
            </div>
          )}

          {packageTypes.length > 0 && (
            <div className={directTypes.length > 0 ? "mt-6" : ""}>
              <div className="mb-3 flex items-center gap-3">
                <h4 className="text-sm font-extrabold text-gray-800">باقات</h4>
                <span className="h-px flex-1 bg-gray-200" />
                <span className="text-[11px] text-gray-400">اشتراك شهري متجدد يومياً</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {packageTypes.map((type) => (
                  <TypeCard
                    key={type}
                    type={type}
                    space={selectedSpace}
                    onPick={() => pickType(type)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- الخطوة 3: التفاصيل والتأكيد ---------- */}
      {step === 3 && selectedSpace && bookingType && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <button type="button" onClick={goToStep2} className="mb-3 text-xs font-semibold text-gray-400 hover:text-rimal-purple">
              → تغيير نوع الحجز
            </button>
            <h3 className="mb-1 text-sm font-bold text-gray-700">
              {selectedSpace.name} — {BOOKING_TYPE_LABELS[bookingType]}
            </h3>
            {BOOKING_TYPE_HINTS[bookingType] && (
              <p className="mb-3 text-xs text-gray-500">{BOOKING_TYPE_HINTS[bookingType]}</p>
            )}

            {isStaff && (
              <div className="mb-4">
                <CustomerPicker allowSelf={false} onChange={setCustomerSelection} />
              </div>
            )}

            {bookingType === "HOURLY" && (
              <div className="mb-4 max-w-xs">
                <label className="label-field">عدد الساعات</label>
                <HourStepper
                  value={Math.min(durationHours, maxDuration)}
                  max={maxDuration}
                  onChange={(h) => {
                    setDurationHours(h);
                    setSelectedSlotIso(null);
                  }}
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  حتى {maxDuration} ساعة — طول يوم الدوام في التاريخ المختار.
                </p>
              </div>
            )}

            <label className="label-field">{isMonthly ? "تاريخ بداية الاشتراك" : "التاريخ"}</label>
            <DateField
              className="input-field max-w-xs"
              value={selectedDate}
              min={toDateInputValue(new Date())}
              onChange={(v) => {
                setSelectedDate(v);
                setSelectedSlotIso(null);
              }}
              required
            />
            <p className="mt-1 text-[11px] text-gray-400">{BUSINESS_HOURS_SUMMARY}</p>
            {isClosedDay && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-700">
                المقر مغلق يوم الجمعة (إجازة أسبوعية) — اختر يوماً آخر.
              </p>
            )}

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
                  durationMinutes={durationHours * 60}
                />
                <p className="mt-1 text-xs text-gray-400">
                  فتحات ربع ساعة ضمن دوام اليوم المختار — {BUSINESS_HOURS_SUMMARY}. تُعرض فقط الأوقات التي
                  تكفي لإتمام المدة المطلوبة قبل الإغلاق.
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

            <TermsAgreement accepted={acceptedTerms} onChange={setAcceptedTerms} />
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
                    {bookingType === "HOURLY" && ` (${hourLabel(durationHours)})`}
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
                disabled={submitting || !session?.user || !effectiveStartIso || isClosedDay || !acceptedTerms}
                className="btn-accent mt-5 w-full"
              >
                {!session?.user
                  ? "سجّل الدخول لتأكيد الحجز"
                  : isClosedDay
                  ? "المقر مغلق في هذا اليوم"
                  : !effectiveStartIso
                  ? "أكمل اختيار الوقت أولاً"
                  : !acceptedTerms
                  ? "وافق على الشروط والأحكام أولاً"
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

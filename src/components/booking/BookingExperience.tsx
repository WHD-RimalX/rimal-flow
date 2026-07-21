"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { BOOKING_TYPE_LABELS, formatSAR } from "@/lib/utils";
import type { BookingDTO, BookingType, SpaceDTO } from "@/types";

const BOOKING_TYPE_ORDER: BookingType[] = [
  "HOURLY",
  "FOUR_HOUR",
  "DAILY",
  "MONTHLY_MORNING",
  "MONTHLY_EVENING",
];

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

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function BookingExperience() {
  const { data: session } = useSession();
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [bookingType, setBookingType] = useState<BookingType>("HOURLY");
  const [isStudent, setIsStudent] = useState(false);
  const [studentIdNumber, setStudentIdNumber] = useState("");
  const [startTime, setStartTime] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 15 * 60 * 1000)));
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingDTO | null>(null);

  useEffect(() => {
    apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces")
      .then((data) => {
        setSpaces(data.spaces);
        if (data.spaces.length) setSelectedSpaceId(data.spaces[0].id);
      })
      .catch(() => setError("تعذّر تحميل المساحات المتاحة"))
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

  useEffect(() => {
    if (availableTypes.length && !availableTypes.includes(bookingType)) {
      setBookingType(availableTypes[0]);
    }
  }, [availableTypes, bookingType]);

  const studentEligible = selectedSpace ? Number(selectedSpace.studentDiscount) > 0 : false;

  const previewBase = selectedSpace ? priceForType(selectedSpace, bookingType) : null;
  const previewDiscount =
    previewBase && isStudent && studentEligible && selectedSpace
      ? Math.round(previewBase * Number(selectedSpace.studentDiscount) * 100) / 100
      : 0;
  const previewFinal = previewBase !== null ? previewBase - previewDiscount : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSpace) return;
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const booking = await apiFetch<{ booking: BookingDTO }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          spaceId: selectedSpace.id,
          bookingType,
          startTime: new Date(startTime).toISOString(),
          isStudent,
          studentIdNumber: isStudent ? studentIdNumber : undefined,
          ...(session?.user
            ? {}
            : { guestName, guestPhone, guestEmail: guestEmail || undefined }),
        }),
      });
      setResult(booking.booking);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("حدث خطأ غير متوقع أثناء إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <h3 className="text-lg font-bold text-gray-900">تم تأكيد حجزك بنجاح</h3>
        <p className="mt-1 text-sm text-gray-500">احتفظ بكود الحجز لاستخدامه عند تسجيل الحضور</p>

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
          <div className="font-semibold text-emerald-600">
            -{formatSAR(Number(result.discountAmount))}
          </div>
          <div className="text-gray-500">الإجمالي</div>
          <div className="text-base font-extrabold text-rimal-orange">
            {formatSAR(Number(result.finalPrice))}
          </div>
        </dl>

        <button className="btn-primary mt-5 w-full" onClick={() => setResult(null)}>
          إنشاء حجز جديد
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h3 className="mb-3 text-sm font-bold text-gray-700">1. اختر المساحة</h3>
        {loadingSpaces ? (
          <p className="text-sm text-gray-500">جارِ تحميل المساحات...</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {spaces.map((space) => (
              <button
                type="button"
                key={space.id}
                onClick={() => setSelectedSpaceId(space.id)}
                className={`rounded-2xl border p-4 text-right transition ${
                  selectedSpaceId === space.id
                    ? "border-rimal-purple bg-rimal-purple-50 ring-2 ring-rimal-purple/30"
                    : "border-gray-200 bg-white hover:border-rimal-purple/40"
                }`}
              >
                <p className="font-bold text-gray-900">{space.name}</p>
                <p className="mt-1 text-xs text-gray-500">{space.description}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-400">{space.capacityUnits} وحدة متاحة</span>
                  {Number(space.studentDiscount) > 0 && (
                    <span className="badge border-rimal-orange/30 bg-rimal-orange-50 text-rimal-orange-600">
                      خصم طلاب {Math.round(Number(space.studentDiscount) * 100)}%
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <h3 className="mb-3 mt-6 text-sm font-bold text-gray-700">2. نوع الحجز</h3>
        <div className="flex flex-wrap gap-2">
          {availableTypes.map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => setBookingType(type)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                bookingType === type
                  ? "border-rimal-purple bg-rimal-purple text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-rimal-purple/40"
              }`}
            >
              {BOOKING_TYPE_LABELS[type]}
              {selectedSpace && priceForType(selectedSpace, type) !== null && (
                <span className="mr-1 opacity-75">
                  ({formatSAR(priceForType(selectedSpace, type)!)})
                </span>
              )}
            </button>
          ))}
        </div>

        <h3 className="mb-3 mt-6 text-sm font-bold text-gray-700">3. وقت البداية</h3>
        <input
          type="datetime-local"
          className="input-field max-w-xs"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />

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
          <>
            <h3 className="mb-3 mt-6 text-sm font-bold text-gray-700">
              4. بياناتك (حجز كضيف)
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="input-field"
                placeholder="الاسم الكامل"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                required
              />
              <input
                className="input-field"
                placeholder="رقم الجوال (05xxxxxxxx)"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                required
              />
              <input
                className="input-field sm:col-span-2"
                placeholder="البريد الإلكتروني (اختياري)"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <div className="lg:col-span-2">
        <div className="card sticky top-20">
          <h3 className="mb-4 text-sm font-bold text-gray-700">ملخص الحجز</h3>
          {selectedSpace ? (
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
              <p className="text-[11px] text-gray-400">
                * السعر النهائي يُحتسب ويُعتمد من الخادم عند تأكيد الحجز.
              </p>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">اختر مساحة لعرض ملخص السعر</p>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>
          )}

          <button type="submit" disabled={submitting || !selectedSpace} className="btn-accent mt-5 w-full">
            {submitting ? "جارِ تأكيد الحجز..." : "تأكيد الحجز"}
          </button>
        </div>
      </div>
    </form>
  );
}

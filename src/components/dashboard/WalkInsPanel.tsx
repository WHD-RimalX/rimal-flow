"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  DISPLAY_STATUS_COLORS,
  DISPLAY_STATUS_LABELS,
  deriveDisplayStatus,
} from "@/lib/attendance";
import { BOOKING_TYPE_LABELS, formatDateTime, formatSAR } from "@/lib/utils";
import { FIXED_START_HOUR, priceForType, riyadhDateToIso, toDateInputValue } from "@/lib/booking-wizard-helpers";
import { DateField } from "@/components/ui/DateField";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import { HourStepper } from "@/components/booking/HourStepper";
import { CustomerPicker, type CustomerSelection } from "@/components/booking/CustomerPicker";
import type { BookingDTO, BookingType, SpaceDTO } from "@/types";

// الباقة اليومية أُزيلت — الحجز بالساعة (حتى يوم دوام كامل) يغطيها.
const CREATABLE_TYPES: BookingType[] = ["HOURLY", "MONTHLY_MORNING", "MONTHLY_EVENING"];

/** نموذج تسجيل حجز جديد من لوحة التحكم — إما لعميل مسجَّل مسبقاً (بحث بالاسم/الجوال)
 *  أو لضيف walk-in بلا حساب (اسم + جوال فقط، يظهر لاحقاً في قائمة الزائرين). */
function CreateBookingForm({ onCreated }: { onCreated: () => void }) {
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [customerSelection, setCustomerSelection] = useState<CustomerSelection | null>(null);

  const [spaceId, setSpaceId] = useState("");
  const [bookingType, setBookingType] = useState<BookingType>("HOURLY");
  const [durationHours, setDurationHours] = useState(1);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces")
      .then((data) => {
        setSpaces(data.spaces);
        if (data.spaces[0]) setSpaceId(data.spaces[0].id);
      })
      .catch(() => {});
  }, []);

  const selectedSpace = useMemo(() => spaces.find((s) => s.id === spaceId) ?? null, [spaces, spaceId]);
  const availableTypes = useMemo(
    () => (selectedSpace ? CREATABLE_TYPES.filter((t) => priceForType(selectedSpace, t) !== null) : []),
    [selectedSpace]
  );
  const needsTimeSlot = bookingType === "HOURLY";

  const effectiveStartIso = needsTimeSlot
    ? selectedSlotIso
    : riyadhDateToIso(selectedDate, FIXED_START_HOUR[bookingType] ?? 9);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSpace || !effectiveStartIso) return;
    if (!customerSelection) {
      setError("يجب اختيار عميل مسجَّل أو إدخال بيانات ضيف كاملة");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<BookingDTO>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          spaceId: selectedSpace.id,
          bookingType,
          startDate: effectiveStartIso,
          durationHours: bookingType === "HOURLY" ? durationHours : undefined,
          ...customerSelection,
        }),
      });
      setCustomerSelection(null);
      setSelectedSlotIso(null);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h3 className="text-sm font-bold text-gray-700">تسجيل حجز جديد</h3>

      <CustomerPicker allowSelf={false} onChange={setCustomerSelection} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label-field">المساحة</label>
          <select
            className="input-field"
            value={spaceId}
            onChange={(e) => {
              setSpaceId(e.target.value);
              setSelectedSlotIso(null);
            }}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-field">نوع الحجز</label>
          <select
            className="input-field"
            value={bookingType}
            onChange={(e) => {
              setBookingType(e.target.value as BookingType);
              setSelectedSlotIso(null);
            }}
          >
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {BOOKING_TYPE_LABELS[t]} — {selectedSpace ? formatSAR(priceForType(selectedSpace, t)!) : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {bookingType === "HOURLY" && (
        <div className="max-w-xs">
          <label className="label-field">عدد الساعات</label>
          <HourStepper
            value={durationHours}
            onChange={(h) => {
              setDurationHours(h);
              setSelectedSlotIso(null);
            }}
          />
        </div>
      )}

      <div>
        <label className="label-field">التاريخ</label>
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
      </div>

      {needsTimeSlot && selectedSpace && (
        <div>
          <label className="label-field">وقت البداية</label>
          <TimeSlotPicker
            spaceId={selectedSpace.id}
            date={selectedDate}
            value={selectedSlotIso}
            onChange={setSelectedSlotIso}
            durationMinutes={durationHours * 60}
          />
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <button type="submit" disabled={submitting || !effectiveStartIso} className="btn-accent w-full">
        {submitting ? "جارِ الإنشاء..." : "إنشاء الحجز"}
      </button>
    </form>
  );
}

/**
 * لوحة "الزائرين" — حجوزات الضيوف (walk-in) بلا حساب مسجَّل، منفصلة عن حجوزات
 * العملاء المسجَّلين. تتيح إنشاء حجز جديد (لعميل مسجَّل أو ضيف) وتسجيل حضور/انصراف
 * الضيف مباشرة بكود حجزه (بلا حاجة لرمز QR الذي لا يملكه أصلاً).
 */
export function WalkInsPanel() {
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const now = Date.now();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ bookings: BookingDTO[] }>("/api/bookings")
      .then((data) => setBookings(data.bookings.filter((b) => !b.userId)))
      .catch(() => setError("تعذّر تحميل قائمة الزائرين"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function performAction(booking: BookingDTO, action: "CHECK_IN" | "CHECK_OUT") {
    setActingId(booking.id);
    setError(null);
    try {
      await apiFetch("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ bookingCode: booking.bookingCode, action }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تنفيذ الإجراء");
    } finally {
      setActingId(null);
    }
  }

  const rows = bookings
    .filter((b) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (b.guestName ?? "").toLowerCase().includes(q) || (b.guestPhone ?? "").includes(q) || b.bookingCode.toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-700">الزائرون (walk-in)</h2>
          <p className="text-xs text-gray-500">حجوزات الضيوف بلا حساب مسجَّل — منفصلة عن العملاء المسجَّلين</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary !px-4 !py-2 text-xs">
          {showForm ? "إخفاء نموذج الحجز" : "+ حجز جديد"}
        </button>
      </div>

      {showForm && (
        <CreateBookingForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="card">
        <div className="mb-4 flex items-center justify-between gap-3">
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

        {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-500">جارِ التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">لا يوجد زائرون مطابقون</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th className="pb-2 font-medium">الوقت</th>
                  <th className="pb-2 font-medium">الاسم</th>
                  <th className="pb-2 font-medium">الجوال</th>
                  <th className="pb-2 font-medium">المساحة</th>
                  <th className="pb-2 font-medium">الباقة</th>
                  <th className="pb-2 font-medium">الحالة</th>
                  <th className="pb-2 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((booking) => {
                  const displayStatus = deriveDisplayStatus(booking, now);
                  return (
                    <tr key={booking.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 text-xs text-gray-600">{formatDateTime(booking.startTime)}</td>
                      <td className="py-2.5 font-medium text-gray-800">{booking.guestName}</td>
                      <td className="py-2.5 text-xs text-gray-500">{booking.guestPhone}</td>
                      <td className="py-2.5">{booking.space.name}</td>
                      <td className="py-2.5 text-xs text-gray-600">{BOOKING_TYPE_LABELS[booking.bookingType]}</td>
                      <td className="py-2.5">
                        <span className={`badge ${DISPLAY_STATUS_COLORS[displayStatus]}`}>
                          {DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1.5">
                          {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
                            <button
                              disabled={actingId === booking.id}
                              onClick={() => performAction(booking, "CHECK_IN")}
                              className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
                            >
                              تسجيل حضور
                            </button>
                          )}
                          {booking.status === "CHECKED_IN" && (
                            <button
                              disabled={actingId === booking.id}
                              onClick={() => performAction(booking, "CHECK_OUT")}
                              className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:border-rimal-purple hover:text-rimal-purple disabled:opacity-40"
                            >
                              تسجيل انصراف
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

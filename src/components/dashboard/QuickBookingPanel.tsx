"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { BookingDTO, SpaceDTO } from "@/types";

interface QuickBookingPanelProps {
  space: SpaceDTO;
  /** المقعد المرئي المحدَّد على الخريطة — يُحفظ في الحجز ليبقى إشغال الخريطة يدوياً بالكامل. */
  seatIndex: number;
  onClose: () => void;
  onCreated: () => void;
}

const VENUE_QR_CODE = process.env.NEXT_PUBLIC_VENUE_QR_CODE ?? "RIMALX-HQ-MAIN-BRANCH-0001";

function customerLabel(b: BookingDTO): { name: string; phone: string | null } {
  return { name: b.user?.name ?? b.guestName ?? "بدون اسم", phone: b.user?.phone ?? b.guestPhone };
}

/**
 * نافذة تخصيص المقعد اليدوي — تظهر كـ Modal عند اختيار مقعد متاح من خريطة المقر.
 * القائمة تقتصر عمداً على الحاضرين المسجَّل دخولهم اليوم (CHECKED_IN) وغير
 * مخصَّصين لمقعد بعد — وليس كامل قاعدة بيانات العملاء — لأن التخصيص هنا هو
 * وضع مرئي فقط لشخص موجود بالفعل، وليس إنشاء حجز جديد له (فلا يُحتسب حجزاً
 * مكرَّراً). اختيار أحدهم يحدِّث حجزه الموجود فقط (seatIndex)، دون إنشاء حجز جديد.
 * تبويب "ضيف جديد" مخصَّص فقط لمن وصل للتو ولا يوجد له حجز مسبق: يُنشئ حجزاً
 * ويسجّل حضوره فوراً (Check-in حقيقي بمؤقّت) ثم يخصّصه لهذا المقعد.
 */
export function QuickBookingPanel({ space, seatIndex, onClose, onCreated }: QuickBookingPanelProps) {
  const [mode, setMode] = useState<"present" | "guest">("present");

  const [presentBookings, setPresentBookings] = useState<BookingDTO[] | null>(null);
  const [loadingPresent, setLoadingPresent] = useState(true);
  const [query, setQuery] = useState("");

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingDTO | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    apiFetch<{ bookings: BookingDTO[] }>(`/api/bookings?date=${today}&status=CHECKED_IN`)
      .then((res) => setPresentBookings(res.bookings.filter((b) => b.seatIndex === null)))
      .catch(() => setPresentBookings([]))
      .finally(() => setLoadingPresent(false));
  }, []);

  const filteredPresent = useMemo(() => {
    if (!presentBookings) return [];
    const q = query.trim().toLowerCase();
    if (!q) return presentBookings;
    return presentBookings.filter((b) => {
      const { name, phone } = customerLabel(b);
      return name.toLowerCase().includes(q) || (phone ?? "").includes(q);
    });
  }, [presentBookings, query]);

  async function assignExisting(booking: BookingDTO) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ booking: BookingDTO }>(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ seatIndex }),
      });
      setResult(res.booking);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تخصيص المقعد");
    } finally {
      setSubmitting(false);
    }
  }

  async function createAndCheckInGuest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<{ booking: BookingDTO }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          spaceId: space.id,
          seatIndex,
          bookingType: "HOURLY",
          startTime: new Date().toISOString(),
          guestName,
          guestPhone,
        }),
      });
      // تسجيل حضور فعلي فوري (نفس محرك الـ QR) حتى يعمل المؤقّت التنازلي بشكل صحيح
      const checkedIn = await apiFetch<{ booking: BookingDTO }>("/api/checkin", {
        method: "POST",
        body: JSON.stringify({
          bookingCode: created.booking.bookingCode,
          action: "CHECK_IN",
          qrCode: VENUE_QR_CODE,
        }),
      });
      setResult(checkedIn.booking);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الضيف");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_20px_60px_rgba(76,53,105,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">تخصيص مقعد — من خريطة المقر</p>
            <h3 className="text-base font-bold text-gray-900">{space.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {result ? (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
            تم تخصيص المقعد بنجاح لكود الحجز <span className="font-mono font-bold">{result.bookingCode}</span>.
            <button onClick={onClose} className="btn-primary mt-4 w-full">
              إغلاق
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setMode("present")}
                className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                  mode === "present" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
                }`}
              >
                الحاضرون الآن
              </button>
              <button
                type="button"
                onClick={() => setMode("guest")}
                className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                  mode === "guest" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
                }`}
              >
                ضيف جديد (تسجيل فوري)
              </button>
            </div>

            {mode === "present" ? (
              <div>
                <label className="label-field">ابحث بالاسم أو رقم الجوال بين الحاضرين الآن</label>
                <input
                  className="input-field"
                  placeholder="مثال: أحمد أو 05xxxxxxxx"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />

                {loadingPresent ? (
                  <p className="mt-3 text-xs text-gray-400">جارِ التحميل...</p>
                ) : filteredPresent.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-400">
                    لا يوجد حاضرون غير مخصَّصين لمقعد يطابقون البحث — سجّل الحضور أولاً من صفحة تسجيل
                    الحضور، أو استخدم تبويب "ضيف جديد" لمن وصل للتو.
                  </p>
                ) : (
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-gray-50 p-1.5">
                    {filteredPresent.map((b) => {
                      const { name, phone } = customerLabel(b);
                      return (
                        <button
                          type="button"
                          key={b.id}
                          disabled={submitting}
                          onClick={() => assignExisting(b)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm transition hover:bg-white hover:shadow-sm disabled:opacity-50"
                        >
                          <div>
                            <span className="font-medium text-gray-800">{name}</span>
                            <p className="text-xs text-gray-400">{b.space.name}</p>
                          </div>
                          <span className="text-xs text-gray-400">{phone}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={createAndCheckInGuest} className="space-y-3">
                <p className="text-xs text-gray-500">
                  لمن لا يملك حجزاً مسبقاً — سيُنشأ حجز باقة الساعة ويُسجَّل حضوره فوراً.
                </p>
                <div>
                  <label className="label-field">اسم العميل</label>
                  <input
                    className="input-field"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label-field">رقم الجوال</label>
                  <input
                    className="input-field"
                    placeholder="0512345678"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" disabled={submitting} className="btn-accent w-full">
                  {submitting ? "جارِ التسجيل..." : "تسجيل الحضور وتخصيص المقعد"}
                </button>
              </form>
            )}

            {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

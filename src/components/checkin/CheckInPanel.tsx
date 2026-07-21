"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_LABELS,
  BOOKING_TYPE_LABELS,
  formatArabicDateTime,
} from "@/lib/utils";
import { QrScanner } from "@/components/checkin/QrScanner";
import type { BookingDTO } from "@/types";

type CheckAction = "CHECK_IN" | "CHECK_OUT";

const VENUE_QR_CODE = process.env.NEXT_PUBLIC_VENUE_QR_CODE ?? "RIMALX-HQ-MAIN-BRANCH-0001";

/** الخطوة الأولى: مسح رمز QR الخاص بالمقر — عبر الكاميرا الفعلية أو محاكاة/إدخال يدوي للتجربة محلياً. */
function ScanStep({ onScanned }: { onScanned: (qrCode: string) => void }) {
  const [manualCode, setManualCode] = useState("");
  const [useCamera, setUseCamera] = useState(true);

  return (
    <div className="card mx-auto max-w-md">
      <h1 className="text-lg font-extrabold text-gray-900">امسح رمز QR الخاص بمقر رمال X</h1>
      <p className="mt-1 text-sm text-gray-500">
        وجّه الكاميرا نحو رمز الاستقبال، أو استخدم محاكاة المسح للتجربة التشغيلية محلياً.
      </p>

      {useCamera ? (
        <div className="mt-4">
          <QrScanner
            onScan={(value) => {
              onScanned(value);
            }}
          />
          <button
            type="button"
            onClick={() => setUseCamera(false)}
            className="mt-3 w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            لا تعمل الكاميرا؟ إدخال يدوي
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <input
            className="input-field text-center font-mono text-xs"
            placeholder="الصق قيمة رمز QR هنا"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
          />
          <button
            type="button"
            disabled={!manualCode.trim()}
            onClick={() => onScanned(manualCode.trim())}
            className="btn-secondary w-full"
          >
            متابعة
          </button>
          <button
            type="button"
            onClick={() => setUseCamera(true)}
            className="w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            الرجوع لمسح الكاميرا
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => onScanned(VENUE_QR_CODE)}
        className="btn-accent mt-4 w-full"
      >
        محاكاة المسح (بدون كاميرا)
      </button>
    </div>
  );
}

const ELIGIBLE_STATUSES = new Set(["CONFIRMED", "CHECKED_IN"]);

/** بطاقة حجز واحد مع أزرار تسجيل الدخول/الخروج المباشرة — لا حاجة لكتابة كود الحجز يدوياً. */
function BookingActionCard({
  booking,
  scannedQr,
  onDone,
}: {
  booking: BookingDTO;
  scannedQr: string;
  onDone: (result: BookingDTO, message: string) => void;
}) {
  const [pendingAction, setPendingAction] = useState<CheckAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: CheckAction) {
    setPendingAction(action);
    setError(null);
    try {
      const res = await apiFetch<{ booking: BookingDTO; message: string }>("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ bookingCode: booking.bookingCode, action, qrCode: scannedQr }),
      });
      onDone(res.booking, res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold text-gray-900">{booking.space.name}</span>
        <span className={`badge ${BOOKING_STATUS_COLORS[booking.status]}`}>
          {BOOKING_STATUS_LABELS[booking.status]}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {BOOKING_TYPE_LABELS[booking.bookingType]} — {formatArabicDateTime(booking.startTime)}
      </p>
      <p className="mt-1 font-mono text-xs text-gray-400">{booking.bookingCode}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pendingAction !== null || booking.status === "CHECKED_IN"}
          onClick={() => handleAction("CHECK_IN")}
          className="btn-primary !py-2 text-sm"
        >
          {pendingAction === "CHECK_IN" ? "..." : "تسجيل دخول"}
        </button>
        <button
          type="button"
          disabled={pendingAction !== null || booking.status !== "CHECKED_IN"}
          onClick={() => handleAction("CHECK_OUT")}
          className="btn-accent !py-2 text-sm"
        >
          {pendingAction === "CHECK_OUT" ? "..." : "تسجيل خروج"}
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function CheckInPanel() {
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [myBookings, setMyBookings] = useState<BookingDTO[] | null>(null);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  const [bookingCode, setBookingCode] = useState("");
  const [pendingAction, setPendingAction] = useState<CheckAction | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [booking, setBooking] = useState<BookingDTO | null>(null);

  // بعد نجاح المسح: إن كان العميل مسجَّلاً دخوله، نجلب حجوزاته مباشرة ونعرض
  // أزرار تسجيل الدخول/الخروج فوراً بدل مطالبته بكتابة كود الحجز يدوياً.
  useEffect(() => {
    if (!scannedQr) return;
    let cancelled = false;
    setLoadingBookings(true);
    apiFetch<{ bookings: BookingDTO[] }>("/api/bookings")
      .then((data) => {
        if (cancelled) return;
        const eligible = data.bookings
          .filter((b) => ELIGIBLE_STATUSES.has(b.status))
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        setMyBookings(eligible);
      })
      .catch(() => {
        // زائر غير مسجَّل دخوله (401) أو خطأ شبكة — ننتقل تلقائياً للإدخال اليدوي بكود الحجز
        if (!cancelled) {
          setMyBookings([]);
          setManualMode(true);
        }
      })
      .finally(() => !cancelled && setLoadingBookings(false));
    return () => {
      cancelled = true;
    };
  }, [scannedQr]);

  async function handleManualAction(action: CheckAction) {
    if (!bookingCode.trim()) {
      setMessage({ type: "error", text: "يرجى إدخال كود الحجز أولاً" });
      return;
    }
    if (!scannedQr) return;
    setPendingAction(action);
    setMessage(null);

    try {
      const res = await apiFetch<{ booking: BookingDTO; message: string }>("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ bookingCode: bookingCode.trim(), action, qrCode: scannedQr }),
      });
      setBooking(res.booking);
      setMessage({ type: "success", text: res.message });
    } catch (err) {
      setBooking(null);
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "حدث خطأ غير متوقع" });
    } finally {
      setPendingAction(null);
    }
  }

  function reset() {
    setScannedQr(null);
    setMyBookings(null);
    setManualMode(false);
    setBookingCode("");
    setMessage(null);
    setBooking(null);
  }

  if (!scannedQr) {
    return <ScanStep onScanned={setScannedQr} />;
  }

  return (
    <div className="card mx-auto max-w-md">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-gray-900">تسجيل الحضور / الانصراف</h1>
        <button onClick={reset} className="text-xs font-semibold text-gray-400 hover:text-rimal-purple">
          امسح رمزاً آخر
        </button>
      </div>

      {loadingBookings ? (
        <p className="mt-4 text-sm text-gray-500">جارِ التحقق من حجوزاتك...</p>
      ) : booking ? (
        <div className="mt-4 rounded-xl border border-gray-200 p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold">{booking.space.name}</span>
            <span className={`badge ${BOOKING_STATUS_COLORS[booking.status]}`}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </span>
          </div>
          <p className="text-gray-500">
            الموعد: {formatArabicDateTime(booking.startTime)} — {formatArabicDateTime(booking.endTime)}
          </p>
        </div>
      ) : !manualMode && myBookings && myBookings.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-500">اختر حجزك لتسجيل الدخول أو الخروج مباشرة:</p>
          {myBookings.map((b) => (
            <BookingActionCard
              key={b.id}
              booking={b}
              scannedQr={scannedQr}
              onDone={(result, msg) => {
                setBooking(result);
                setMessage({ type: "success", text: msg });
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className="w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            حجز آخر بكود مختلف؟ إدخال يدوي
          </button>
        </div>
      ) : (
        <div className="mt-4">
          {!manualMode && (
            <p className="mb-3 text-sm text-gray-500">
              لا توجد لديك حجوزات نشطة الآن — أدخل كود الحجز يدوياً (مثلاً لحجز ضيف).
            </p>
          )}
          <label className="label-field">كود الحجز</label>
          <input
            className="input-field text-center font-mono tracking-widest"
            placeholder="RMX-XXXXXXXX"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
          />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => handleManualAction("CHECK_IN")}
              className="btn-primary"
            >
              {pendingAction === "CHECK_IN" ? "جارِ التسجيل..." : "تسجيل دخول"}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => handleManualAction("CHECK_OUT")}
              className="btn-accent"
            >
              {pendingAction === "CHECK_OUT" ? "جارِ التسجيل..." : "تسجيل خروج"}
            </button>
          </div>

          {message && (
            <p
              className={`mt-4 rounded-lg p-3 text-sm ${
                message.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

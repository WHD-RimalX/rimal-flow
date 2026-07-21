"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS, formatArabicDateTime } from "@/lib/utils";
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

export function CheckInPanel() {
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState("");
  const [pendingAction, setPendingAction] = useState<CheckAction | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [booking, setBooking] = useState<BookingDTO | null>(null);

  async function handleAction(action: CheckAction) {
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
      <p className="mt-1 text-sm text-gray-500">
        تم التحقق من رمز QR الخاص بمقر رمال X. أدخل كود حجزك ثم اختر الإجراء المطلوب.
      </p>

      <label className="label-field mt-5">كود الحجز</label>
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
          onClick={() => handleAction("CHECK_IN")}
          className="btn-primary"
        >
          {pendingAction === "CHECK_IN" ? "جارِ التسجيل..." : "تسجيل دخول"}
        </button>
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => handleAction("CHECK_OUT")}
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

      {booking && (
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
      )}
    </div>
  );
}

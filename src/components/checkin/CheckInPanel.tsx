"use client";

import { useState } from "react";
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

/**
 * الخطوة الأولى: مسح رمز QR الخاص بحجز العميل نفسه (وليس رمزاً ثابتاً للمقر) —
 * كل حجز له رمز خاص به يصل إليه العميل من حسابه. عند تعطّل الكاميرا يمكن
 * للاستقبال إدخال كود الحجز يدوياً بعد التحقق من الهوية شخصياً.
 */
type ManualMode = "camera" | "code" | "phone";

function ScanStep({
  onLookup,
  loading,
  error,
}: {
  onLookup: (params: { qrToken?: string; bookingCode?: string; phone?: string }) => void;
  loading: boolean;
  error: string | null;
}) {
  const [manualCode, setManualCode] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<ManualMode>("camera");

  return (
    <div className="card mx-auto max-w-md">
      <h1 className="text-lg font-extrabold text-gray-900">امسح رمز QR الخاص بحجز العميل</h1>
      <p className="mt-1 text-sm text-gray-500">
        وجّه الكاميرا نحو رمز QR الظاهر في حساب العميل — الرمز خاص بحجزه هو تحديداً وينتهي بانتهاء حجزه.
      </p>

      {mode === "camera" && (
        <div className="mt-4">
          <QrScanner onScan={(value) => onLookup({ qrToken: value })} />
          <button
            type="button"
            onClick={() => setMode("code")}
            className="mt-3 w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            لا تعمل الكاميرا؟ إدخال كود الحجز يدوياً
          </button>
          <button
            type="button"
            onClick={() => setMode("phone")}
            className="mt-1 w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            ضيف بلا تطبيق؟ بحث برقم الجوال
          </button>
        </div>
      )}

      {mode === "code" && (
        <div className="mt-4 space-y-3">
          <input
            className="input-field text-center font-mono text-xs uppercase"
            placeholder="RMX-XXXXXXXX"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            disabled={!manualCode.trim() || loading}
            onClick={() => onLookup({ bookingCode: manualCode.trim() })}
            className="btn-secondary w-full"
          >
            {loading ? "جارِ البحث..." : "بحث"}
          </button>
          <button
            type="button"
            onClick={() => setMode("camera")}
            className="w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            الرجوع لمسح الكاميرا
          </button>
        </div>
      )}

      {mode === "phone" && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">
            لضيوف walk-in بلا حجز عبر التطبيق ولا رمز QR — يُعثَر على أنسب حجز نشط بهذا الرقم.
          </p>
          <input
            className="input-field text-center text-sm"
            placeholder="0512345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            type="button"
            disabled={!phone.trim() || loading}
            onClick={() => onLookup({ phone: phone.trim() })}
            className="btn-secondary w-full"
          >
            {loading ? "جارِ البحث..." : "بحث"}
          </button>
          <button
            type="button"
            onClick={() => setMode("camera")}
            className="w-full text-center text-xs font-semibold text-gray-400 hover:text-rimal-purple"
          >
            الرجوع لمسح الكاميرا
          </button>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function CheckInPanel() {
  const [booking, setBooking] = useState<BookingDTO | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<CheckAction | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleLookup(params: { qrToken?: string; bookingCode?: string; phone?: string }) {
    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await apiFetch<{ booking: BookingDTO }>("/api/checkin/lookup", {
        method: "POST",
        body: JSON.stringify(params),
      });
      setBooking(res.booking);
      setMessage(null);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : "تعذّر العثور على الحجز");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleAction(action: CheckAction) {
    if (!booking) return;
    setPendingAction(action);
    setMessage(null);
    try {
      const res = await apiFetch<{ booking: BookingDTO; message: string }>("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ qrToken: booking.qrToken, action }),
      });
      setBooking(res.booking);
      setMessage({ type: "success", text: res.message });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "حدث خطأ غير متوقع" });
    } finally {
      setPendingAction(null);
    }
  }

  function reset() {
    setBooking(null);
    setMessage(null);
    setLookupError(null);
  }

  if (!booking) {
    return <ScanStep onLookup={handleLookup} loading={lookupLoading} error={lookupError} />;
  }

  const customerName = booking.user?.name ?? booking.guestName ?? "عميل";

  return (
    <div className="card mx-auto max-w-md">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-gray-900">تسجيل الحضور / الانصراف</h1>
        <button onClick={reset} className="text-xs font-semibold text-gray-400 hover:text-rimal-purple">
          امسح رمزاً آخر
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-gray-900">{customerName}</span>
          <span className={`badge ${BOOKING_STATUS_COLORS[booking.status]}`}>
            {BOOKING_STATUS_LABELS[booking.status]}
          </span>
        </div>
        <p className="text-gray-500">{booking.space.name}</p>
        <p className="text-xs text-gray-400">
          {BOOKING_TYPE_LABELS[booking.bookingType]} — {formatArabicDateTime(booking.startTime)}
        </p>
        <p className="mt-1 font-mono text-xs text-gray-400">{booking.bookingCode}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={pendingAction !== null || booking.status === "CHECKED_IN"}
          onClick={() => handleAction("CHECK_IN")}
          className="btn-primary"
        >
          {pendingAction === "CHECK_IN" ? "جارِ التسجيل..." : "تسجيل دخول"}
        </button>
        <button
          type="button"
          disabled={pendingAction !== null || booking.status !== "CHECKED_IN"}
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
    </div>
  );
}

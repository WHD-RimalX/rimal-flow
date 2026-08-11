"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, ApiError } from "@/lib/api-client";

interface ScanTokenResponse {
  scanToken: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * رمز QR متجدد تلقائياً — SECURITY-AUDIT.V2.md §2 (FLOW-X01).
 *
 * الرمز المعروض هنا مؤقت (عمره ثوانٍ) ويُستهلَك عند أول مسح ناجح، ثم يُطلَب رمز
 * جديد تلقائياً. الأثر العملي: لقطة الشاشة تفقد قيمتها قبل أن تُرسَل أصلاً، وأي
 * محاولة لإعادة استخدام رمز سبق مسحه تُرفض من الخادم صراحةً.
 *
 * يُظهر عدّاداً تنازلياً لطمأنة العميل أن التجديد تلقائي وليس عطلاً.
 */
export function RotatingQr({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<ScanTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchToken = useCallback(async () => {
    try {
      const res = await apiFetch<ScanTokenResponse>(`/api/bookings/${bookingId}/scan-token`, { method: "POST" });
      if (cancelledRef.current) return;
      setData(res);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof ApiError ? err.message : "تعذّر تحميل رمز المسح");
    }
  }, [bookingId]);

  // أول تحميل + إعادة الطلب تلقائياً قبل انتهاء الصلاحية بخمس ثوانٍ.
  useEffect(() => {
    cancelledRef.current = false;
    fetchToken();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchToken]);

  useEffect(() => {
    if (!data) return;
    const expiresAt = new Date(data.expiresAt).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        fetchToken();
        return;
      }
      timerRef.current = setTimeout(tick, 1000);
    };

    tick();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, fetchToken]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="rounded-lg bg-red-50 p-2 text-center text-xs text-red-700">{error}</p>
        <button type="button" onClick={fetchToken} className="text-xs font-semibold text-rimal-purple">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <p className="text-xs text-gray-400">جارِ توليد رمز المسح...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl border-4 border-rimal-purple/10 bg-white p-3">
        <QRCodeSVG value={data.scanToken} size={176} fgColor="#4f3569" level="M" />
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-emerald-500" />
        <p className="text-xs font-semibold text-gray-600">
          يتجدد الرمز تلقائياً خلال {secondsLeft} ثانية
        </p>
      </div>
      <p className="text-center text-[11px] leading-relaxed text-gray-400">
        رمز مؤقت لمرة واحدة — لا تُشارك لقطة شاشة منه، فهي تنتهي صلاحيتها خلال ثوانٍ.
      </p>
    </div>
  );
}

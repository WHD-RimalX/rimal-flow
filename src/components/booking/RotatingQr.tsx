"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/** طول دورة العدّاد المعروض (ثوانٍ) — عرض فقط، لا يُبطل الرمز. */
const DISPLAY_CYCLE_SECONDS = 45;

/**
 * رمز QR الخاص بالحجز + عدّاد مرئي.
 *
 * ⚠️ ملاحظة أمنية مهمة (مقصودة ومؤقتة): الرمز المعروض هنا **ثابت** طوال عمر
 * الحجز، والعدّاد أدناه **واجهة فقط** لا يُبطل الرمز عند وصوله للصفر.
 *
 * السبب: النسخة المتجددة (رمز مؤقت 45 ثانية يُستهلَك مرة واحدة) كانت تفشل
 * عملياً عند المسح بالكاميرا — كل تجديد يُبطل الرمز السابق، فأي تأخّر بين
 * ظهور الرمز على شاشة العميل والتقاط الكاميرا له ينتج رمزاً منتهياً ورفضاً.
 * أُعيد الرمز الثابت بطلب صريح لضمان عمل العرض التقديمي.
 *
 * الأثر الأمني الذي يعود بهذا القرار (SECURITY-AUDIT.V2.md §2، FLOW-X01):
 * لقطة شاشة واحدة للرمز تبقى صالحة طوال عمر الحجز ويمكن لأي شخص استخدامها.
 * البنية المتجددة ما زالت موجودة كاملة في الكود (src/lib/scan-token.ts ومسار
 * /api/bookings/:id/scan-token) ويمكن إعادة تفعيلها فوراً بعد العرض.
 */
export function RotatingQr({ token }: { token: string }) {
  const [secondsLeft, setSecondsLeft] = useState(DISPLAY_CYCLE_SECONDS);

  useEffect(() => {
    const id = setInterval(() => {
      // عدّاد دائري للعرض فقط — يعود للبداية ولا يمس صلاحية الرمز إطلاقاً.
      setSecondsLeft((s) => (s <= 1 ? DISPLAY_CYCLE_SECONDS : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl border-4 border-rimal-purple/10 bg-white p-3">
        <QRCodeSVG value={token} size={176} fgColor="#4f3569" level="M" />
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-emerald-500" />
        <p className="text-xs font-semibold text-gray-600">الرمز نشط — {secondsLeft} ثانية</p>
      </div>
    </div>
  );
}

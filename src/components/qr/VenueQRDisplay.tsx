"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * عرض رمز QR الثابت الخاص بمقر رمال X — لأغراض العرض والمحاكاة التشغيلية.
 * في الاستخدام الفعلي يكون هذا الرمز مطبوعاً وملصقاً عند مدخل المقر، ويقوم
 * العميل بمسحه للوصول لصفحة تسجيل الحضور/الانصراف الخاصة بحجزه.
 */
export function VenueQRDisplay({ size = 176 }: { size?: number }) {
  const venueCode = process.env.NEXT_PUBLIC_VENUE_QR_CODE ?? "RIMALX-HQ-MAIN-BRANCH-0001";

  return (
    <div className="card flex flex-col items-center gap-3 text-center">
      <p className="badge border-rimal-purple/30 bg-rimal-purple-50 text-rimal-purple">
        رمز QR الخاص بمقر رمال X
      </p>
      <div className="rounded-xl border-4 border-rimal-purple/10 bg-white p-3">
        <QRCodeSVG value={venueCode} size={size} fgColor="#4f3569" level="M" />
      </div>
      <p className="max-w-xs text-xs text-gray-500">
        امسح هذا الرمز عند الوصول للمقر لتسجيل الحضور، أو عند المغادرة لتسجيل الانصراف.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { BOOKING_TERMS } from "@/lib/booking-terms";

/**
 * الشروط والأحكام + مربع الموافقة الإلزامي قبل تأكيد الحجز.
 *
 * البند الأول (احتساب الوقت بتقريب ربع الساعة لأعلى) مُبرَز عمداً في الأعلى
 * وبتنسيق مميّز، لأنه أكثر بند يفاجئ العميل بعد الجلسة إن لم يره مسبقاً.
 */
export function TermsAgreement({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [highlight, ...rest] = BOOKING_TERMS;

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-gray-800">الشروط والأحكام</h4>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold text-rimal-purple hover:underline"
        >
          {expanded ? "إخفاء التفاصيل" : "عرض كل البنود"}
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-rimal-orange/40 bg-rimal-orange-50 p-3">
        <p className="text-xs font-bold text-gray-800">⏱ {highlight.title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{highlight.body}</p>
      </div>

      {expanded && (
        <ol className="mt-3 space-y-2.5 border-t border-dashed border-gray-200 pt-3">
          {rest.map((term, i) => (
            <li key={term.title} className="text-[11px] leading-relaxed">
              <span className="font-bold text-gray-700">
                {i + 2}. {term.title}:
              </span>{" "}
              <span className="text-gray-600">{term.body}</span>
            </li>
          ))}
        </ol>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-sm shadow-sm">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-rimal-purple"
        />
        <span className="text-xs leading-relaxed text-gray-700">
          أقررت بأنني قرأت <span className="font-bold">الشروط والأحكام</span> أعلاه ووافقت عليها، وأفهم تحديداً أن
          وقت جلستي يُحتسب <span className="font-bold">مقرَّباً لأعلى إلى أقرب ربع ساعة</span>.
        </span>
      </label>
    </div>
  );
}

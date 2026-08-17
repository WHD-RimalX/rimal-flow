"use client";

import { useRef } from "react";

interface DateFieldProps {
  /** القيمة بصيغة YYYY-MM-DD (نفس صيغة input[type=date] القياسية). */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  /** نص يظهر حين لا توجد قيمة مختارة. */
  placeholder?: string;
  "aria-label"?: string;
}

/** يحوّل YYYY-MM-DD إلى dd/mm/yyyy للعرض فقط. */
function toDisplay(value: string): string {
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/**
 * حقل تاريخ يعرض دائماً بصيغة dd/mm/yyyy.
 *
 * حقل `input[type="date"]` الأصلي يعرض التاريخ بصيغة لغة *المتصفح* لا صيغة
 * الصفحة — فيظهر mm/dd/yyyy لمن نظامه أمريكي مهما ضبطنا `lang` أو CSS، ولا توجد
 * أي وسيلة قياسية لتغيير ذلك. لذا نعرض النص بأنفسنا بالصيغة المطلوبة، ونُبقي
 * حقل التاريخ الأصلي شفافاً فوقه ليحتفظ بتقويم المتصفح ودعم لوحة المفاتيح
 * وقارئات الشاشة والتحقق من min/max — بلا مكتبة تقويم خارجية.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  required,
  className = "",
  placeholder = "يوم/شهر/سنة",
  ...rest
}: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = toDisplay(value);

  return (
    // focus-within بديل focus: التركيز يقع على الحقل الداخلي لا على الحاوية،
    // فلولاه لاختفت حلقة التركيز التي يوفّرها صنف input-field على بقية الحقول.
    <div
      className={`relative focus-within:border-rimal-purple focus-within:ring-2 focus-within:ring-rimal-purple/20 ${className}`}
    >
      {/* الطبقة المرئية: النص بالصيغة المطلوبة */}
      <div className="pointer-events-none flex items-center justify-between gap-2">
        <span className={display ? "text-gray-700" : "text-gray-400"}>{display || placeholder}</span>
        <svg
          className="h-4 w-4 shrink-0 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </div>

      {/*
        حقل التاريخ الحقيقي شفاف فوق الطبقة المرئية بالكامل: التقويم الأصلي
        والتنقل بلوحة المفاتيح وقارئ الشاشة تعمل كلها كالمعتاد، والمعروض للعين
        هو نصنا نحن. `showPicker()` تفتح التقويم من أي نقرة داخل الحقل.
      */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => {
          try {
            inputRef.current?.showPicker?.();
          } catch {
            // بعض المتصفحات تمنع showPicker خارج تفاعل موثوق — التقويم الافتراضي يعمل بدونها.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        {...rest}
      />
    </div>
  );
}

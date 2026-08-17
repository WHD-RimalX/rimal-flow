import type { Metadata } from "next";
import localFont from "next/font/local";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/**
 * خطوط الهوية البصرية لرمال X — مطابِقة لتركيب موقع rimalx.co نفسه.
 *
 * فُحص الموقع فعلياً فتبيّن أن حزمته الأساسية هي:
 *   "GE SS Two", Tajawal, sans-serif
 * أي أن GE SS Two يرسم *الحروف العربية فقط*، وكل ما عداه (الأرقام، الحروف
 * اللاتينية، الرموز مثل % و— و…) يسقط على Tajawal — وهو ما يفسّر اختلاف الشكل
 * حين استُخدم Source Sans مكان Tajawal في هذه المواضع.
 *
 * GE SS Two محوَّل من OTF إلى WOFF2 (12KB لكل وزن بدل 20KB). الخط لا يحتوي أي
 * حرف لاتيني إطلاقاً (فحص cmap: 4 رموز فقط هي [ \ ] _ )، ولا يوفّر إلا ثلاثة
 * أوزان — لذا تُخصَّص الأوزان الوسيطة التي تستخدمها الواجهة (600/800) لأقرب وزن
 * متاح صراحةً بدل ترك المتصفح يصطنع تعريضاً صناعياً يشوّه الحرف العربي.
 */
const geSsTwo = localFont({
  src: [
    { path: "../fonts/GESSTwo-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/GESSTwo-Medium.woff2", weight: "400", style: "normal" },
    { path: "../fonts/GESSTwo-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/GESSTwo-Bold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/GESSTwo-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/GESSTwo-Bold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-arabic",
  display: "swap",
});

/** الخط الرديف المباشر بعد GE SS Two — يرسم الأرقام والرموز، تماماً كما في rimalx.co. */
const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

/**
 * Source Sans 3 — الخط الإنجليزي الثانوي المعتمد في دليل الهوية. ليس ضمن الحزمة
 * الافتراضية (موقعهم لا يضعه فيها أيضاً)، بل يُستدعى صراحةً عبر صنف `font-latin`
 * للنصوص الإنجليزية البحتة. `preload: false` حتى لا يُحمَّل 164KB إلا عند استخدامه فعلاً.
 *
 * ملاحظة: Futura (الخط الإنجليزي الأساسي في الدليل) غير مستخدَم هنا — وصل بصيغة
 * ‎.ttc‎ التي لا تدعمها المتصفحات في ‎@font-face‎. وموقعهم نفسه يذكره بالاسم فقط
 * دون ملف، فيظهر لمن لديه الخط مثبَّتاً على جهازه فقط ويسقط للثانوي عند بقية الزوار.
 */
const sourceSans = localFont({
  src: [{ path: "../fonts/SourceSans3-Variable.woff2", weight: "200 900", style: "normal" }],
  variable: "--font-latin",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "رمال فلو | Rimal Flow — رمال X",
  description: "مركز العمليات الذكي للحجوزات والمساحات — رمال X",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${geSsTwo.variable} ${tajawal.variable} ${sourceSans.variable}`}
    >
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

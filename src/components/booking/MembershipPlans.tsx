"use client";

import { useState } from "react";
import { formatSAR } from "@/lib/utils";

interface MembershipPlan {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  freeHours: number;
  discountPercent: number;
  icon: string;
  iconBg: string;
  popular?: boolean;
  features: string[];
}

const PLANS: MembershipPlan[] = [
  {
    id: "basic",
    name: "العضوية الأساسية",
    nameEn: "Basic Membership",
    price: 449,
    freeHours: 30,
    discountPercent: 10,
    icon: "✨",
    iconBg: "bg-rimal-orange-50 text-rimal-orange-600",
    features: [
      "30 ساعة مجانية شهرياً",
      "خصم 10% على الحجوزات الإضافية",
      "وصول لمساحات العمل المشتركة",
      "إنترنت مجاني عالي السرعة",
      "تأكيد تلقائي للحجوزات",
      "4 أكواب قهوة مجانية شهرياً",
    ],
  },
  {
    id: "pro",
    name: "العضوية الاحترافية",
    nameEn: "Pro Membership",
    price: 1099,
    freeHours: 75,
    discountPercent: 20,
    icon: "⚡",
    iconBg: "bg-white/15 text-white",
    popular: true,
    features: [
      "75 ساعة مجانية شهرياً",
      "خصم 20% على الحجوزات الإضافية",
      "وصول لجميع أنواع المساحات",
      "دعوات مجانية لفعاليات Rimal X",
      "استشارة شهرية واحدة مع فريقنا",
      "10 أكواب قهوة مجانية شهرياً",
    ],
  },
  {
    id: "enterprise",
    name: "عضوية الشركات",
    nameEn: "Enterprise Membership",
    price: 1879,
    freeHours: 200,
    discountPercent: 30,
    icon: "👑",
    iconBg: "bg-gray-100 text-gray-700",
    features: [
      "200 ساعة مجانية شهرياً لفريق العمل",
      "خصم 30% على الحجوزات والخدمات الإضافية",
      "استشارتان شهرياً لتطوير الأعمال",
      "دعم تقني مخصص للشركات",
      "أولوية في حجز القاعات والمساحات",
      "فاتورة شهرية موحدة للشركة",
      "12 كوب قهوة مجانية شهرياً",
    ],
  },
];

/**
 * بطاقات العضويات الثلاث — نظام مستقل تماماً عن حجز مساحة بعينها (رصيد ساعات
 * شهري + خصم عام يُطبَّق على أي حجز إضافي)، على عكس MONTHLY_MORNING/EVENING
 * الحالية المرتبطة بمساحة واحدة. الاشتراك الفعلي (رصيد/خصم تلقائي) غير مُفعَّل
 * بعد فنياً — هذه واجهة العرض فقط ريثما يُبنى نموذج بيانات العضويات.
 */
export function MembershipPlans() {
  const [contactPlan, setContactPlan] = useState<MembershipPlan | null>(null);

  return (
    <div>
      <div className="mb-6 text-center">
        <h3 className="text-2xl font-extrabold text-gray-900">اختر ما يناسبك</h3>
        <p className="mt-1 text-sm text-gray-500">كل عضوية صُممت لتمنحك قيمة حقيقية — اختر الفئة وابدأ اليوم</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col overflow-hidden rounded-2xl border ${
              plan.popular ? "border-rimal-purple bg-rimal-purple text-white shadow-xl md:-my-2 md:py-2" : "border-gray-200 bg-white"
            }`}
          >
            {plan.popular && (
              <div className="bg-rimal-orange py-1.5 text-center text-xs font-bold text-white">✨ الأكثر شعبية</div>
            )}
            <div className="flex flex-1 flex-col p-6">
              <div className={`grid h-12 w-12 place-items-center rounded-xl text-xl ${plan.iconBg}`}>{plan.icon}</div>
              <p className="mt-4 text-lg font-extrabold">{plan.name}</p>
              <p className={`text-xs ${plan.popular ? "text-white/70" : "text-gray-400"}`}>{plan.nameEn}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold">{formatSAR(plan.price)}</span>
              </div>
              <p className={`text-xs ${plan.popular ? "text-white/70" : "text-gray-400"}`}>شهرياً</p>

              <div className={`mt-4 grid grid-cols-2 gap-2 rounded-xl p-3 text-center ${plan.popular ? "bg-white/10" : "bg-gray-50"}`}>
                <div>
                  <p className="text-lg font-extrabold">{plan.discountPercent}%</p>
                  <p className={`text-[11px] ${plan.popular ? "text-white/70" : "text-gray-500"}`}>خصم إضافي</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold">{plan.freeHours}</p>
                  <p className={`text-[11px] ${plan.popular ? "text-white/70" : "text-gray-500"}`}>ساعة مجانية</p>
                </div>
              </div>

              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${
                        plan.popular ? "bg-rimal-orange text-white" : "bg-rimal-orange-50 text-rimal-orange-600"
                      }`}
                    >
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => setContactPlan(plan)}
                className={`mt-6 w-full rounded-xl py-2.5 text-sm font-bold transition ${
                  plan.popular ? "bg-rimal-orange text-white hover:opacity-90" : "bg-neutral-900 text-white hover:opacity-90"
                }`}
              >
                اشترك الآن
              </button>
            </div>
          </div>
        ))}
      </div>

      {contactPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
          onClick={() => setContactPlan(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rimal-purple-50 text-2xl">
              {contactPlan.icon}
            </div>
            <p className="font-bold text-gray-900">شكراً لاهتمامك بـ{contactPlan.name}</p>
            <p className="mt-2 text-sm text-gray-500">
              الاشتراك الإلكتروني في العضويات قريباً — تواصل مع فريق الاستقبال حالياً لتفعيل عضويتك مباشرة.
            </p>
            <button type="button" onClick={() => setContactPlan(null)} className="btn-primary mt-5 w-full">
              حسناً
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

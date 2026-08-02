import { Header } from "@/components/ui/Header";
import { BookingExperience } from "@/components/booking/BookingExperience";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-10 grid gap-6 lg:grid-cols-3 lg:items-center">
          <div className="lg:col-span-2">
            <p className="badge border-rimal-orange/30 bg-rimal-orange-50 text-rimal-orange-600">
              رمال X — مركز العمليات الذكي
            </p>
            <h1 className="mt-3 text-3xl font-extrabold text-gray-900 sm:text-4xl">
              احجز مساحتك في <span className="text-rimal-purple">رمال فلو</span> بضغطة واحدة
            </h1>
            <p className="mt-3 max-w-xl text-gray-600">
              اختر المساحة المناسبة، حدد نوع الحجز، واستفد من خصم الطلاب تلقائياً — سجّل
              دخولك أو أنشئ حساباً جديداً لإتمام الحجز.
            </p>
          </div>
          <div className="flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="رمال X" className="w-full max-w-xs" />
          </div>
        </section>

        <section className="card">
          <BookingExperience />
        </section>
      </main>
    </>
  );
}

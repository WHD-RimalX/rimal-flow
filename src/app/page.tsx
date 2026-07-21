import { Header } from "@/components/ui/Header";
import { BookingExperience } from "@/components/booking/BookingExperience";
import { VenueQRDisplay } from "@/components/qr/VenueQRDisplay";

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
              اختر المساحة المناسبة، حدد نوع الحجز، واستفد من خصم الطلاب تلقائياً — الحجز
              متاح للأعضاء المسجلين وأيضاً كضيف بدون الحاجة لإنشاء حساب.
            </p>
          </div>
          <VenueQRDisplay />
        </section>

        <section className="card">
          <BookingExperience />
        </section>
      </main>
    </>
  );
}

import Link from "next/link";
import { Header } from "@/components/ui/Header";

export default function UnauthorizedPage() {
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-red-50 text-3xl text-red-500">
          🚫
        </div>
        <p className="badge border-red-200 bg-red-50 text-red-600">403 — غير مصرَّح</p>
        <h1 className="mt-3 text-2xl font-extrabold text-gray-900">لا تملك صلاحية الوصول لهذه الصفحة</h1>
        <p className="mt-2 text-sm text-gray-500">
          لوحة العمليات (رمال فلو) مخصصة لموظفي الاستقبال والمدراء فقط. إذا كنت تعتقد أن هذا
          خطأ، تواصل مع إدارة رمال X.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/" className="btn-secondary">
            العودة للصفحة الرئيسية
          </Link>
        </div>
      </main>
    </>
  );
}

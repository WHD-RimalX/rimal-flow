import { CustomersPanel } from "@/components/dashboard/CustomersPanel";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">العملاء المسجَّلون</h1>
        <p className="text-sm text-gray-500">كل من أنشأ حساباً على الموقع — الاسم ورقم الجوال والبريد الإلكتروني</p>
      </div>
      <CustomersPanel />
    </div>
  );
}

import { AllBookingsLog } from "@/components/dashboard/AllBookingsLog";

export default function AllBookingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">سجل الحجوزات</h1>
        <p className="text-sm text-gray-500">
          كل الحجوزات على الإطلاق — بما فيها الاشتراكات الشهرية والملغاة والمنتهية — بحالاتها الفعلية اللحظية
        </p>
      </div>
      <AllBookingsLog />
    </div>
  );
}

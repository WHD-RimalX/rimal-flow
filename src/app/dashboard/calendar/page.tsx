import { CalendarView } from "@/components/dashboard/CalendarView";

export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">التقويم التفاعلي</h1>
        <p className="text-sm text-gray-500">عرض شهري لجميع الحجوزات — اضغط على أي يوم لعرض تفاصيل حجوزاته</p>
      </div>
      <CalendarView />
    </div>
  );
}

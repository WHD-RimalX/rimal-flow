import { WalkInsPanel } from "@/components/dashboard/WalkInsPanel";

export default function WalkInsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">الزائرون</h1>
        <p className="text-sm text-gray-500">حجوزات الضيوف بلا حساب مسجَّل (walk-in) — إنشاء حجز جديد وتسجيل حضورهم برقم الجوال</p>
      </div>
      <WalkInsPanel />
    </div>
  );
}

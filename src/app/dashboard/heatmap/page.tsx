import { HeatMapPanel } from "@/components/dashboard/HeatMapPanel";

export default function HeatMapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">الخريطة الحرارية</h1>
        <p className="text-sm text-gray-500">
          متى يمتلئ المقر ومتى يهدأ — لجدولة الموظفين وتسعير الفترات الهادئة بقرار مبني على بيانات فعلية
        </p>
      </div>
      <HeatMapPanel />
    </div>
  );
}

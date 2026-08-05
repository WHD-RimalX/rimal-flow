import { SubscribersPanel } from "@/components/dashboard/SubscribersPanel";

export default function SubscribersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">المشتركون</h1>
        <p className="text-sm text-gray-500">أصحاب الاشتراكات الشهرية، مصنَّفين حسب نوع الاشتراك (صباحي/مسائي)</p>
      </div>
      <SubscribersPanel />
    </div>
  );
}

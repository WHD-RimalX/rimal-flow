"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatSAR } from "@/lib/utils";
import type { DashboardSummaryDTO } from "@/types";

const CARD_CONFIG: {
  key: keyof DashboardSummaryDTO;
  label: string;
  accent: string;
}[] = [
  { key: "totalToday", label: "إجمالي حجوزات اليوم", accent: "border-rimal-purple/30 text-rimal-purple" },
  { key: "currentlyCheckedIn", label: "الحاضرون الآن", accent: "border-emerald-300 text-emerald-600" },
  { key: "upcomingSoon", label: "قادمون خلال ساعة", accent: "border-blue-300 text-blue-600" },
  { key: "lateArrivals", label: "متأخرون عن الموعد", accent: "border-amber-300 text-amber-600" },
  { key: "checkedOutToday", label: "غادروا اليوم", accent: "border-gray-300 text-gray-500" },
  // "مشتركون شهريون نشطون" أُزيلت من هنا — لوحة اليوم تشغيلية يومية، ومتابعة
  // الاشتراكات الشهرية أصبح لها مكان مخصَّص أفضل: صفحة /dashboard/subscribers.
];

export function StatsCards() {
  const [summary, setSummary] = useState<DashboardSummaryDTO | null>(null);

  useEffect(() => {
    let mounted = true;
    function load() {
      apiFetch<DashboardSummaryDTO>("/api/dashboard/summary")
        .then((data) => mounted && setSummary(data))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {CARD_CONFIG.map((card) => (
        <div key={card.key} className={`card border-t-4 ${card.accent}`}>
          <p className="text-2xl font-extrabold">{summary ? summary[card.key] : "—"}</p>
          <p className="mt-1 text-xs text-gray-500">{card.label}</p>
        </div>
      ))}
      {/* يظهر فقط لمن يملك صلاحية canViewReports — الحقل غائب تماماً عن الاستجابة لغيرهم */}
      {summary?.revenueToday !== undefined && (
        <div className="card border-t-4 border-emerald-400 text-emerald-700">
          <p className="text-2xl font-extrabold">{formatSAR(Number(summary.revenueToday))}</p>
          <p className="mt-1 text-xs text-gray-500">إيراد اليوم</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatSAR } from "@/lib/utils";
import type { SpaceDTO } from "@/types";

interface HeatMapData {
  days: number;
  hours: number[];
  openDays: number[];
  grid: Record<string, Record<string, number>>;
  peak: number;
  peakCell: { day: number; hour: number } | null;
  totalBookings: number;
  totalRevenue: number;
}

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const RANGES = [
  { days: 7, label: "آخر أسبوع" },
  { days: 30, label: "آخر 30 يوماً" },
  { days: 90, label: "آخر 3 أشهر" },
];

/** صيغة الساعة بنظام 12 مع ص/م — مختصرة لتناسب رأس عمود ضيق. */
function hourLabel(h: number): string {
  const suffix = h < 12 ? "ص" : "م";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

/**
 * تدرّج لوني نسبي: الشدة تُقاس مقابل أعلى خلية في الشبكة نفسها، لا مقابل رقم
 * مطلق — فالخريطة تبقى مقروءة سواء كان الذروة 3 حجوزات أو 300.
 */
function cellStyle(value: number, peak: number): { className: string; style: React.CSSProperties } {
  if (value === 0) {
    return { className: "text-gray-300", style: { background: "#F3F4F6" } };
  }
  const ratio = peak > 0 ? value / peak : 0;
  // تدرّج من البرتقالي الفاتح (هويّة رمال) إلى الموف الغامق عند الذروة.
  const from = { r: 253, g: 233, b: 198 }; // #f9e9c6
  const to = { r: 79, g: 53, b: 105 }; //     #4f3569
  const mix = (a: number, b: number) => Math.round(a + (b - a) * ratio);
  const bg = `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
  return {
    className: ratio > 0.55 ? "text-white" : "text-gray-700",
    style: { background: bg },
  };
}

/**
 * الخريطة الحرارية — كثافة الإشغال لكل (يوم أسبوع × ساعة).
 *
 * الغرض التشغيلي: معرفة ساعات الذروة والركود لجدولة الموظفين وتسعير الفترات
 * الهادئة، بدل تخمينها. تُحتسب كل ساعة يلامسها الحجز لا ساعة البداية فقط.
 */
export function HeatMapPanel() {
  const [data, setData] = useState<HeatMapData | null>(null);
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [rangeDays, setRangeDays] = useState(30);
  const [spaceId, setSpaceId] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces")
      .then((d) => setSpaces(d.spaces))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(rangeDays) });
    if (spaceId !== "ALL") params.set("spaceId", spaceId);
    apiFetch<HeatMapData>(`/api/dashboard/heatmap?${params}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذّر تحميل الخريطة الحرارية"))
      .finally(() => setLoading(false));
  }, [rangeDays, spaceId]);

  /** أكثر ساعة وأهدأ ساعة عبر كل الأيام — خلاصة عملية فوق الشبكة. */
  const insights = useMemo(() => {
    if (!data) return null;
    const perHour = data.hours.map((h) => ({
      hour: h,
      total: data.openDays.reduce((sum, d) => sum + (data.grid[String(d)]?.[String(h)] ?? 0), 0),
    }));
    const perDay = data.openDays.map((d) => ({
      day: d,
      total: data.hours.reduce((sum, h) => sum + (data.grid[String(d)]?.[String(h)] ?? 0), 0),
    }));
    const busiestHour = [...perHour].sort((a, b) => b.total - a.total)[0];
    const quietestHour = [...perHour].filter((x) => x.total > 0).sort((a, b) => a.total - b.total)[0];
    const busiestDay = [...perDay].sort((a, b) => b.total - a.total)[0];
    return { busiestHour, quietestHour, busiestDay, hasData: perHour.some((x) => x.total > 0) };
  }, [data]);

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-700">كثافة الإشغال</h2>
          <p className="text-xs text-gray-400">عدد الحجوزات التي تشغل كل ساعة، موزّعة على أيام الأسبوع</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 shadow-sm"
          >
            <option value="ALL">كل المساحات</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg bg-gray-50 p-0.5 shadow-sm">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setRangeDays(r.days)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  rangeDays === r.days ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {loading && <p className="py-8 text-center text-xs text-gray-400">جارِ تحليل الحجوزات...</p>}

      {!loading && data && (
        <>
          {insights?.hasData ? (
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-rimal-purple-50 p-3">
                <p className="text-[11px] text-gray-500">ساعة الذروة</p>
                <p className="text-sm font-extrabold text-rimal-purple">
                  {hourLabel(insights.busiestHour.hour)} — {insights.busiestHour.total} حجز
                </p>
              </div>
              <div className="rounded-xl bg-rimal-orange-50 p-3">
                <p className="text-[11px] text-gray-500">أكثر أيام الأسبوع ازدحاماً</p>
                <p className="text-sm font-extrabold text-rimal-orange-600">
                  {DAY_NAMES[insights.busiestDay.day]} — {insights.busiestDay.total} حجز
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-[11px] text-gray-500">أهدأ ساعة (فرصة عروض)</p>
                <p className="text-sm font-extrabold text-gray-700">
                  {insights.quietestHour ? `${hourLabel(insights.quietestHour.hour)} — ${insights.quietestHour.total} حجز` : "—"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              لا توجد حجوزات كافية في هذه الفترة لرسم نمط واضح — جرّب نطاقاً أطول.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0.5 text-center">
              <thead>
                <tr>
                  <th className="sticky right-0 bg-white pe-2 text-[10px] font-medium text-gray-400"></th>
                  {data.hours.map((h) => (
                    <th key={h} className="pb-1 text-[10px] font-medium text-gray-400">
                      {hourLabel(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.openDays.map((d) => (
                  <tr key={d}>
                    <td className="sticky right-0 whitespace-nowrap bg-white pe-2 text-start text-[11px] font-semibold text-gray-600">
                      {DAY_NAMES[d]}
                    </td>
                    {data.hours.map((h) => {
                      const value = data.grid[String(d)]?.[String(h)] ?? 0;
                      const { className, style } = cellStyle(value, data.peak);
                      return (
                        <td key={h} className="p-0">
                          <div
                            style={style}
                            className={`grid h-8 min-w-[2rem] place-items-center rounded-md text-[11px] font-bold ${className}`}
                            title={`${DAY_NAMES[d]} ${hourLabel(h)} — ${value} حجز`}
                          >
                            {value || ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span>هادئ</span>
              <div className="flex">
                {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                  <span
                    key={r}
                    className="h-3 w-6 first:rounded-s-md last:rounded-e-md"
                    style={cellStyle(r === 0 ? 0 : Math.max(1, Math.round(r * data.peak)), data.peak).style}
                  />
                ))}
              </div>
              <span>ذروة ({data.peak})</span>
            </div>
            <p className="text-[11px] text-gray-400">
              {data.totalBookings} حجزاً خلال {data.days} يوماً — بإيراد {formatSAR(data.totalRevenue)}
            </p>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
            تُحتسب كل ساعة يشغلها الحجز لا ساعة بدايته فقط، فحجز من 9 إلى 12 يظهر في الساعات الثلاث.
            الاشتراكات الشهرية مستبعَدة لأن امتدادها 30 يوماً يُغرق الشبكة ويخفي أنماط الحجز الفعلية.
          </p>
        </>
      )}
    </div>
  );
}

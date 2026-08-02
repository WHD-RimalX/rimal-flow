/**
 * عدد المقاعد المرئية القابلة للتخصيص على الخريطة التفاعلية لكل مساحة —
 * مرجع مشترك بين الخريطة (src/components/floor-map) ومحرك تسجيل الحضور
 * (يحتاجه للتسكين التلقائي عند تسجيل الحضور) حتى لا يختلف الرقمان.
 * المساحات غير المذكورة هنا (لاونج كبار الشخصيات، الكبسولة، إلخ) غرفة واحدة
 * كاملة (seatIndex=0 ضمنياً عبر HallCard) ولا حاجة لتسكين تلقائي فيها.
 */
export const SEAT_COUNT_BY_SLUG: Record<string, number> = {
  "shared-workspace": 25,
  "dual-workspace": 3,
};

export function getSeatCountForSpace(slug: string): number | null {
  return SEAT_COUNT_BY_SLUG[slug] ?? null;
}

import Image from "next/image";
import { formatSAR } from "@/lib/utils";
import { spaceImageUrl } from "@/lib/booking-wizard-helpers";
import type { SpaceDTO } from "@/types";

interface SpacesCatalogProps {
  spaces: SpaceDTO[];
  loading: boolean;
  error: string | null;
  onPick: (spaceId: string) => void;
}

interface CatalogGroup {
  title: string;
  icon: string;
  subtitle: string;
  slugs: string[];
  gridCols: string;
}

const GROUPS: CatalogGroup[] = [
  {
    title: "مساحات العمل",
    icon: "🕐",
    subtitle: "مساحات مرنة بالساعة أو اليوم أو الشهر",
    slugs: ["shared-workspace", "dual-workspace"],
    gridCols: "sm:grid-cols-2 lg:max-w-2xl lg:mx-auto",
  },
  {
    title: "القاعات والمرافق الخاصة",
    icon: "✨",
    subtitle: "قاعات تدريب، عصف ذهني، كبسولات، ولاونج كبار الشخصيات",
    slugs: ["open-training-hall", "innovation-hub", "soundproof-pod", "vip-lounge"],
    gridCols: "sm:grid-cols-2 lg:grid-cols-4",
  },
];

// عدد الأشخاص المعروض على بطاقة كل مساحة = سعة "الحجز الواحد" منها (وليس
// إجمالي كل الوحدات المتزامنة مجتمعة) — قيمة عرض بحتة، لا تُخزَّن في قاعدة
// البيانات ولا تمس capacityUnits (التي تبقى دائماً هي المتحكم الفعلي بعدد
// الحجوزات المتزامنة المسموحة وبخريطة المقاعد). مثال: مساحة العمل المشتركة
// فيها 17 كرسياً منفصلاً لكن كل حجز واحد لشخص واحد فقط، فتُعرض "شخص واحد"؛
// لاونج كبار الشخصيات كيان واحد يُحجز دفعة واحدة لمجموعة حتى 10 أشخاص.
// أي مساحة غير مذكورة هنا تعرض capacityUnits كما هي (سلوك افتراضي معقول).
const DISPLAY_PERSON_CAPACITY: Record<string, number> = {
  "shared-workspace": 1,
  "dual-workspace": 2,
  "vip-lounge": 10,
  "open-training-hall": 30,
  "innovation-hub": 7,
};

function totalPersonCapacity(space: SpaceDTO): number {
  return DISPLAY_PERSON_CAPACITY[space.slug] ?? space.capacityUnits;
}

function personCountLabel(n: number): string {
  if (n === 1) return "شخص واحد";
  if (n === 2) return "شخصان";
  return `${n} أشخاص`;
}

type PriceRow = { label: string; value: string; colorClass: string };

/**
 * السعر بالساعة فقط للحجز المباشر — الباقة اليومية أُزيلت لأن الحجز بالساعة
 * (حتى 14 ساعة، أي يوم الدوام كاملاً) يغطيها بالكامل.
 */
function hourlyRow(space: SpaceDTO): PriceRow | null {
  return space.hourlyPrice
    ? { label: "ساعة", value: space.hourlyPrice, colorClass: "text-rimal-orange" }
    : null;
}

/** الاشتراكات الشهرية تُعرض تحت عنوان "باقات" منفصل لتمييزها عن السعر بالساعة. */
function packageRows(space: SpaceDTO): PriceRow[] {
  return [
    { label: "☀️ شهري صباحي", value: space.monthlyMorningPrice, colorClass: "text-rimal-purple" },
    { label: "🌙 شهري مسائي", value: space.monthlyEveningPrice, colorClass: "text-rimal-purple" },
  ].filter((r): r is PriceRow => r.value !== null);
}

function SpaceCard({ space, onPick }: { space: SpaceDTO; onPick: (spaceId: string) => void }) {
  const discountPercent = Math.round(Number(space.studentDiscount) * 100);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-lg">
      <div className="relative h-44 w-full shrink-0 bg-gray-100">
        <Image src={spaceImageUrl(space)} alt={space.name} fill sizes="(max-width: 768px) 100vw, 25vw" className="object-cover" />
        <span className="absolute right-3 top-3 rounded-full bg-neutral-900/80 px-2.5 py-1 text-[11px] font-semibold text-white">
          👤 {personCountLabel(totalPersonCapacity(space))}
        </span>
        {discountPercent > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-rimal-orange px-2.5 py-1 text-[11px] font-bold text-white">
            خصم طلاب {discountPercent}%
          </span>
        )}
      </div>

      {/* flex-1 يجعل الأعمدة المجاورة بنفس ارتفاع بطاقتها الأطول (سواء اختلف عدد
          فقرات السعر أو طول الوصف)، وmt-auto على الزر يثبّته دائماً بأسفل البطاقة
          بحيث تتوازى أزرار "احجز هذه المساحة" أفقياً مهما اختلف محتوى كل بطاقة. */}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-bold text-gray-900">{space.name}</h3>
        {space.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{space.description}</p>}

        <div className="mt-4 space-y-1.5 border-t border-dashed border-gray-200 pt-3 text-sm">
          {(() => {
            const hourly = hourlyRow(space);
            return hourly ? (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{hourly.label}</span>
                <span className={`font-bold ${hourly.colorClass}`}>{formatSAR(Number(hourly.value))}</span>
              </div>
            ) : null;
          })()}

          {packageRows(space).length > 0 && (
            <>
              <p className="pt-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-400">باقات</p>
              {packageRows(space).map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-gray-500">{row.label}</span>
                  <span className={`font-bold ${row.colorClass}`}>{formatSAR(Number(row.value))}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onPick(space.id)}
          className="mt-auto w-full rounded-xl bg-neutral-900 py-2.5 text-sm font-bold text-white transition hover:bg-black"
        >
          احجز هذه المساحة ←
        </button>
      </div>
    </div>
  );
}

/** كتالوج المساحات — مجمَّعة في أقسام (مساحات العمل / القاعات والمرافق الخاصة) مطابقة لتصنيف rimalx.co. */
export function SpacesCatalog({ spaces, loading, error, onPick }: SpacesCatalogProps) {
  if (loading) return <p className="text-sm text-gray-500">جارِ تحميل المساحات...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-12">
      {GROUPS.map((group) => {
        const groupSpaces = group.slugs
          .map((slug) => spaces.find((s) => s.slug === slug))
          .filter((s): s is SpaceDTO => Boolean(s));
        if (groupSpaces.length === 0) return null;

        return (
          <div key={group.title}>
            <div className="mb-1 flex items-center justify-center gap-2">
              <h2 className="text-2xl font-extrabold text-gray-900">{group.title}</h2>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-rimal-purple-50 text-base">{group.icon}</span>
            </div>
            <p className="text-center text-sm text-gray-500">{group.subtitle}</p>

            <div className={`mt-6 grid gap-5 ${group.gridCols}`}>
              {groupSpaces.map((space) => (
                <SpaceCard key={space.id} space={space} onPick={onPick} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

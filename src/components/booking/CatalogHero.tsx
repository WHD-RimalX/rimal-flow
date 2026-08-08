interface CatalogHeroProps {
  mainTab: "spaces" | "memberships";
  onTabChange: (tab: "spaces" | "memberships") => void;
}

const COPY = {
  spaces: {
    accent: "العمل",
    rest: "مساحات",
    subtitle: "بيئات عمل متنوعة تناسب جميع احتياجاتك — من المساحات المشتركة إلى قاعات التدريب ولاونج كبار الشخصيات",
  },
  memberships: {
    accent: "إنتاجيتك",
    rest: "استثمر في",
    subtitle: "وفّر أكثر مع عضويتنا — ساعات مجانية شهرياً، خصومات حصرية، وأكواب قهوة علينا",
  },
};

/** قسم البطل العلوي بخطوة اختيار المساحة/العضوية — خلفية داكنة مطابقة لأسلوب rimalx.co، ومحتواه يتغيّر حسب التبويب النشط. */
export function CatalogHero({ mainTab, onTabChange }: CatalogHeroProps) {
  const copy = COPY[mainTab];

  return (
    <section className="bg-gradient-to-b from-neutral-900 to-neutral-800 px-4 py-14 text-center">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 inline-flex gap-1 rounded-xl bg-white/10 p-1">
          <button
            type="button"
            onClick={() => onTabChange("spaces")}
            className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
              mainTab === "spaces" ? "bg-white text-gray-900 shadow-sm" : "text-gray-300 hover:text-white"
            }`}
          >
            المساحات
          </button>
          <button
            type="button"
            onClick={() => onTabChange("memberships")}
            className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
              mainTab === "memberships" ? "bg-white text-gray-900 shadow-sm" : "text-gray-300 hover:text-white"
            }`}
          >
            العضويات
          </button>
        </div>

        <h1 className="text-3xl font-extrabold text-white sm:text-5xl">
          {copy.rest} <span className="text-rimal-orange">{copy.accent}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-gray-300 sm:text-base">{copy.subtitle}</p>
      </div>
    </section>
  );
}

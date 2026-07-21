"use client";

import { useMemo, useState } from "react";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatSAR } from "@/lib/utils";
import { useNow } from "@/lib/hooks/useNow";
import {
  computeLiveState,
  findActiveCheckInLog,
  formatDuration,
  type LiveAttendanceState,
} from "@/lib/attendance";
import type { BookingDTO, SpaceDTO } from "@/types";

/**
 * خريطة مقر رمال X التفاعلية — مقسّمة إلى طابقين (أرضي/علوي) حسب المخطط الفعلي للمقر.
 *
 * قواعد بصرية صارمة (لا يجوز كسرها):
 *  - ممنوع أي حدود/حواف سوداء إطلاقاً — التمييز بين الأشكال يتم فقط عبر لون
 *    الخلفية والظلال الناعمة (shadow) والزوايا المنحنية.
 *  - أربعة ألوان أساسية فقط: floor.bg (المحيط) / floor.available (متاح) /
 *    floor.occupied (محجوز) / floor.facility (مرافق غير قابلة للحجز)، بالإضافة
 *    إلى floor.alert (تنبيه أحمر-أرجواني) عند اقتراب انتهاء وقت الحجز (≤30 دقيقة).
 *
 * ملاحظة تقنية: قاعدة البيانات تتعقّب سعة كل مساحة كرقم إجمالي (capacityUnits)
 * دون ترقيم مقاعد فردي دائم. لعرض حالة كل "مقعد" على الخريطة، تُحسب المقاعد
 * المحجوزة من عدد الحجوزات النشطة حالياً لكل مساحة، وتُسند لأول N مقعد بترتيب
 * ثابت (بحسب وقت إنشاء الحجز) — تمثيل عرضي وليس ترقيماً فعلياً مخزَّناً في DB.
 */

interface SeatInfo {
  key: string;
  spaceName: string;
  seatLabel: string;
  price: number | null;
  occupied: boolean;
  confirmedNotArrived: boolean;
  customerName?: string | null;
  clickable: boolean;
  liveState: LiveAttendanceState | null;
}

interface InteractiveFloorMapProps {
  onSelectSpace?: (space: SpaceDTO) => void;
}

const SLUGS = {
  shared: "shared-workspace",
  dual: "dual-workspace",
  vip: "vip-lounge",
  pod: "soundproof-pod",
  innovation: "innovation-hub",
  training: "open-training-hall",
} as const;

function useFloorMapData() {
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    function load() {
      const today = new Date().toISOString().slice(0, 10);
      Promise.all([
        apiFetch<{ spaces: SpaceDTO[] }>("/api/spaces"),
        apiFetch<{ bookings: BookingDTO[] }>(`/api/bookings?date=${today}`).catch(() => ({
          bookings: [] as BookingDTO[],
        })),
      ])
        .then(([spacesRes, bookingsRes]) => {
          if (!mounted) return;
          setSpaces(spacesRes.spaces);
          setBookings(bookingsRes.bookings);
        })
        .finally(() => mounted && setLoading(false));
    }

    load();
    const interval = setInterval(load, 20_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return { spaces, bookings, loading };
}

/** الحجوزات (محجوزة أو حاضرة الآن) لمساحة معينة تتداخل مع الوقت الحالي — تظهر كمقاعد مشغولة على الخريطة. */
function activeBookingsForSpace(bookings: BookingDTO[], spaceId: string, now: number) {
  return bookings
    .filter(
      (b) =>
        b.spaceId === spaceId &&
        (b.status === "CHECKED_IN" || b.status === "CONFIRMED") &&
        new Date(b.startTime).getTime() <= now &&
        new Date(b.endTime).getTime() >= now
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function buildSeatInfo(
  spaceName: string,
  seatLabel: string,
  price: number | null,
  booking: BookingDTO | undefined,
  now: number,
  key: string
): SeatInfo {
  const liveState =
    booking?.status === "CHECKED_IN" ? computeLiveState(findActiveCheckInLog(booking.checkInLogs), now) : null;

  return {
    key,
    spaceName,
    seatLabel,
    price,
    occupied: Boolean(booking),
    confirmedNotArrived: booking?.status === "CONFIRMED",
    customerName: booking?.user?.name ?? booking?.guestName ?? null,
    clickable: !booking,
    liveState,
  };
}

function isRedAlert(seat: Pick<SeatInfo, "liveState">) {
  return (
    seat.liveState?.phase === "OVERTIME" ||
    (seat.liveState?.phase === "COUNTDOWN" && seat.liveState.isAlert)
  );
}

function TooltipStatusLine({ seat }: { seat: SeatInfo }) {
  // لا نكرر "متاح للحجز" هنا — لون المقعد (الذهبي) ودليل الألوان أعلى الخريطة يوضّحان ذلك
  if (!seat.occupied) {
    return null;
  }
  if (seat.confirmedNotArrived) {
    return <p className="mt-1 text-[11px] font-bold text-rimal-purple">محجوز — بانتظار تسجيل الحضور</p>;
  }
  if (seat.liveState?.phase === "ARRIVING") {
    return <p className="mt-1 text-[11px] font-bold text-rimal-purple">جارِ الوصول للمقعد...</p>;
  }
  if (seat.liveState?.phase === "COUNTDOWN") {
    return (
      <p className={`mt-1 text-[11px] font-bold ${seat.liveState.isAlert ? "text-floor-alert" : "text-rimal-purple"}`}>
        الوقت المتبقي: {formatDuration(seat.liveState.msRemaining)}
      </p>
    );
  }
  if (seat.liveState?.phase === "OVERTIME") {
    return (
      <p className="mt-1 text-[11px] font-bold text-floor-alert">
        تجاوز الوقت بـ {formatDuration(seat.liveState.msOvertime)}
      </p>
    );
  }
  return <p className="mt-1 text-[11px] font-bold text-rimal-purple">محجوز الآن</p>;
}

function Seat({ seat, onClick, className = "" }: { seat: SeatInfo; onClick?: () => void; className?: string }) {
  const alert = isRedAlert(seat);
  const bg = seat.occupied ? (alert ? "bg-floor-alert" : "bg-floor-occupied") : "bg-floor-available";

  return (
    <div className={`group relative ${className}`}>
      <button
        type="button"
        onClick={seat.clickable ? onClick : undefined}
        disabled={!seat.clickable}
        className={`h-9 w-9 rounded-xl ${bg} shadow-[0_2px_6px_rgba(115,79,150,0.25)] transition
          hover:-translate-y-0.5 hover:shadow-[0_6px_14px_rgba(115,79,150,0.35)]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white
          ${alert ? "animate-pulse-soft" : ""}
          ${seat.clickable ? "cursor-pointer" : "cursor-default opacity-90"}`}
        aria-label={seat.seatLabel}
      />

      <div
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-48 -translate-x-1/2 rounded-2xl bg-white/95 p-3 text-right opacity-0 shadow-[0_10px_30px_rgba(76,53,105,0.25)] backdrop-blur transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <p className="text-xs font-bold text-gray-900">{seat.spaceName}</p>
        <p className="text-[11px] text-gray-500">{seat.seatLabel}</p>
        {seat.price !== null && (
          <p className="mt-1 text-[11px] font-semibold text-rimal-purple">يبدأ من {formatSAR(seat.price)}</p>
        )}
        <TooltipStatusLine seat={seat} />
        {seat.occupied && seat.customerName && (
          <p className="mt-0.5 text-[11px] text-gray-500">العميل: {seat.customerName}</p>
        )}
      </div>
    </div>
  );
}

/** عنصر هيكلي/مرفق غير قابل للحجز (بدون أي مسمى افتراضي) — label اختياري فقط للمرافق المسمّاة فعلياً كـ"المعمل". */
function FacilityBlock({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div
      className={`grid place-items-center rounded-2xl bg-floor-facility text-center shadow-[0_4px_12px_rgba(250,157,125,0.35)] ${className}`}
    >
      {label && <span className="px-2 text-xs font-bold text-white/95">{label}</span>}
    </div>
  );
}

function HallCard({
  space,
  bookings,
  now,
  onSelect,
  className = "",
  size = "md",
}: {
  space: SpaceDTO | undefined;
  bookings: BookingDTO[];
  now: number;
  onSelect?: (space: SpaceDTO) => void;
  className?: string;
  size?: "md" | "lg";
}) {
  if (!space) return null;
  const active = activeBookingsForSpace(bookings, space.id, now);
  const booking = active[0];
  const price = space.hourlyPrice ? Number(space.hourlyPrice) : null;
  const seat = buildSeatInfo(space.name, "القاعة كاملة", price, booking, now, space.id);
  const alert = isRedAlert(seat);
  const bg = seat.occupied ? (alert ? "bg-floor-alert" : "bg-floor-occupied") : "bg-floor-available";

  return (
    <div className={`group relative ${className}`}>
      <button
        type="button"
        onClick={seat.clickable ? () => onSelect?.(space) : undefined}
        disabled={!seat.clickable}
        className={`flex h-full w-full flex-col items-center justify-center gap-2 rounded-3xl px-4 text-center shadow-[0_6px_20px_rgba(115,79,150,0.2)] transition
          ${bg}
          ${size === "lg" ? "py-8" : "py-6"}
          hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(115,79,150,0.3)]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white
          ${alert ? "animate-pulse-soft" : ""}
          ${seat.clickable ? "cursor-pointer" : "cursor-default opacity-95"}`}
      >
        <span className={`font-extrabold ${seat.occupied ? "text-white" : "text-rimal-purple-dark"}`}>
          {space.name}
        </span>
        {/* لا نكرر "متاحة للحجز" — لون البطاقة ودليل الألوان يوضّحان الحالة؛ نعرض نصاً فقط عند وجود حجز فعلي */}
        {seat.occupied && (
          <span className="text-xs text-white/85">
            {seat.liveState?.phase === "COUNTDOWN"
              ? `⏱ ${formatDuration(seat.liveState.msRemaining)}`
              : seat.liveState?.phase === "OVERTIME"
              ? `⏱ +${formatDuration(seat.liveState.msOvertime)}`
              : seat.liveState?.phase === "ARRIVING"
              ? "جارِ الوصول..."
              : "محجوزة الآن"}
          </span>
        )}
      </button>

      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-48 -translate-x-1/2 rounded-2xl bg-white/95 p-3 text-right opacity-0 shadow-[0_10px_30px_rgba(76,53,105,0.25)] backdrop-blur transition-all duration-150 group-hover:opacity-100">
        <p className="text-xs font-bold text-gray-900">{seat.spaceName}</p>
        {seat.price !== null && (
          <p className="mt-1 text-[11px] font-semibold text-rimal-purple">{formatSAR(seat.price)} / للساعة</p>
        )}
        <TooltipStatusLine seat={seat} />
        {seat.occupied && seat.customerName && (
          <p className="mt-0.5 text-[11px] text-gray-500">العميل: {seat.customerName}</p>
        )}
      </div>
    </div>
  );
}

const LEGEND_ITEMS = [
  { swatch: "bg-floor-bg", label: "خلفية عامة للخريطة", ring: true },
  { swatch: "bg-floor-available", label: "متاح للحجز" },
  { swatch: "bg-floor-occupied", label: "محجوز حالياً" },
  { swatch: "bg-floor-alert", label: "تنبيه: ≤30 دقيقة متبقية" },
  { swatch: "bg-floor-facility", label: "مرافق غير قابلة للحجز" },
];

type FloorId = "ground" | "first";

const FLOOR_TABS: { id: FloorId; label: string }[] = [
  { id: "ground", label: "الدور الأرضي" },
  { id: "first", label: "الدور العلوي" },
];

export function InteractiveFloorMap({ onSelectSpace }: InteractiveFloorMapProps) {
  const { spaces, bookings, loading } = useFloorMapData();
  const [floor, setFloor] = useState<FloorId>("ground");
  // يُشغَّل هذا العدّاد كل ثانية فقط لدفع إعادة رسم المؤقتات الحية على الخريطة
  const now = useNow(1000);

  const spaceBySlug = useMemo(() => {
    const map: Record<string, SpaceDTO> = {};
    spaces.forEach((s) => (map[s.slug] = s));
    return map;
  }, [spaces]);

  const shared = spaceBySlug[SLUGS.shared];
  const dual = spaceBySlug[SLUGS.dual];

  // عدد المقاعد المعروضة بصرياً على الخريطة لمساحة العمل المشتركة أكبر من سعتها
  // الفعلية المخزَّنة (capacityUnits=17) لمطابقة المخطط المعماري المرفق بدقة —
  // هذا تمثيل عرضي فقط؛ التحقق من التعارض والسعة الفعلية عند الحجز يبقى من السيرفر
  // حصراً بناءً على capacityUnits الحقيقي، بصرف النظر عن عدد المقاعد المرسومة هنا.
  const TOTAL_VISUAL_SHARED_SEATS = 26;

  const sharedSeats: SeatInfo[] = useMemo(() => {
    if (!shared) return [];
    const active = activeBookingsForSpace(bookings, shared.id, now);
    const price = shared.hourlyPrice ? Number(shared.hourlyPrice) : null;
    return Array.from({ length: TOTAL_VISUAL_SHARED_SEATS }, (_, i) =>
      buildSeatInfo(shared.name, `مقعد رقم ${i + 1}`, price, active[i], now, `${shared.id}-${i}`)
    );
  }, [shared, bookings, now]);

  const dualSeats: SeatInfo[] = useMemo(() => {
    if (!dual) return [];
    const active = activeBookingsForSpace(bookings, dual.id, now);
    const price = dual.hourlyPrice ? Number(dual.hourlyPrice) : null;
    return Array.from({ length: dual.capacityUnits }, (_, i) =>
      buildSeatInfo(dual.name, `طاولة ثنائية رقم ${i + 1}`, price, active[i], now, `${dual.id}-${i}`)
    );
  }, [dual, bookings, now]);

  // توزيع الـ 26 مقعداً المرسومة حسب المخطط: 6 بعمود رأسي يمين الدور الأرضي،
  // 8 على شكل حرف L أقصى يسار الدور العلوي، و12 (صفّان متقابلان) يمين الدور العلوي.
  const sharedGround = sharedSeats.slice(0, 6);
  const sharedLShape = sharedSeats.slice(6, 14);
  const sharedFirstRowA = sharedSeats.slice(14, 20);
  const sharedFirstRowB = sharedSeats.slice(20, 26);

  function handleSeatClick(space: SpaceDTO | undefined) {
    if (space) onSelectSpace?.(space);
  }

  return (
    <div className="rounded-3xl bg-floor-bg p-5 shadow-inner">
      {/* دليل الألوان */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl bg-white/60 px-4 py-3 shadow-sm">
        <p className="text-xs font-bold text-gray-700">خريطة مقر رمال X التفاعلية</p>
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span
                className={`h-3.5 w-3.5 rounded-full ${item.swatch} ${
                  item.ring ? "shadow-[0_0_0_2px_rgba(255,255,255,0.9)]" : ""
                }`}
              />
              <span className="text-[11px] text-gray-600">{item.label}</span>
            </div>
          ))}
        </div>
        {loading && <span className="text-[11px] text-gray-400">جارِ تحديث الحالة اللحظية...</span>}
      </div>

      {/* التنقل بين الطابقين */}
      <div className="mb-5 flex gap-1 rounded-xl bg-white/60 p-1 shadow-sm">
        {FLOOR_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFloor(tab.id)}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
              floor === tab.id ? "bg-rimal-purple text-white shadow-sm" : "text-gray-500 hover:text-rimal-purple"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {floor === "ground" ? (
        // الدور الأرضي: مساحة العمل المشتركة يميناً (أول عنصر بالترتيب = يمين في RTL)،
        // عنصر هيكلي علوي ثم كبسولة الصوت وسطاً، وعناصر هيكلية غير قابلة للحجز يساراً (آخر عنصر).
        <section className="rounded-2xl bg-white/50 p-4 shadow-sm">
          <p className="mb-3 text-[11px] font-bold text-gray-500">الدور الأرضي</p>
          <div className="flex flex-wrap items-stretch justify-between gap-8">
            {/* يمين: عمود مقاعد المساحة المشتركة (ذهبي) */}
            <div className="flex flex-col items-center gap-3">
              <p className="text-[11px] text-gray-500">مساحة عمل مشتركة</p>
              <div className="flex flex-col gap-2">
                {sharedGround.map((seat) => (
                  <Seat key={seat.key} seat={seat} onClick={() => handleSeatClick(shared)} />
                ))}
              </div>
            </div>

            {/* وسط: عنصر هيكلي علوي كبير، ثم كبسولة عازلة للصوت أسفله */}
            <div className="flex flex-col items-center justify-between gap-4">
              <FacilityBlock className="h-28 w-40" />
              <div className="flex flex-col items-center gap-2">
                <p className="text-[11px] text-gray-500">كبسولة عازلة للصوت</p>
                <HallCard
                  space={spaceBySlug[SLUGS.pod]}
                  bookings={bookings}
                  now={now}
                  onSelect={handleSeatClick}
                  className="w-44"
                />
              </div>
            </div>

            {/* يسار: عناصر هيكلية/مرافق غير قابلة للحجز (برتقالي) */}
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <FacilityBlock key={i} className="h-14 w-14" />
              ))}
            </div>
          </div>
        </section>
      ) : (
        // الدور العلوي — حسب الصورة المرفقة بالضبط: 3 مناطق.
        // يمين (أقصى اليمين): المعمل، ثم المساحة المشتركة الرئيسية، ثم قاعة التدريب — نفس العرض لكل الثلاثة.
        // وسط: مساحة عمل ثنائية فقط (عنصر عائم أعلى الوسط، منفصل عن عمود اليمين).
        // يسار (أقصى اليسار): مقاعد على شكل L، ثم لاونج VIP، ثم قاعة الابتكار تحتها مباشرة.
        <section className="rounded-2xl bg-white/50 p-4 shadow-sm">
          <p className="mb-3 text-[11px] font-bold text-gray-500">الدور العلوي</p>
          <div className="grid gap-5 lg:grid-cols-[260px_1fr_220px]">
            {/* أقصى اليمين: المعمل، ثم المساحة المشتركة الرئيسية، ثم قاعة التدريب — نفس العرض */}
            <div className="flex flex-col gap-4">
              <FacilityBlock label="المعمل (The Lab)" className="min-h-[100px]" />

              <div>
                <p className="mb-2 text-[11px] text-gray-500">مساحة العمل المشتركة — رئيسي</p>
                <div className="space-y-2">
                  <div className="flex flex-wrap justify-center gap-2">
                    {sharedFirstRowA.map((seat) => (
                      <Seat key={seat.key} seat={seat} onClick={() => handleSeatClick(shared)} />
                    ))}
                  </div>
                  <div className="mx-auto h-px w-2/3 bg-rimal-purple/10" />
                  <div className="flex flex-wrap justify-center gap-2">
                    {sharedFirstRowB.map((seat) => (
                      <Seat key={seat.key} seat={seat} onClick={() => handleSeatClick(shared)} />
                    ))}
                  </div>
                </div>
              </div>

              {/* قاعة التدريب — بنفس عرض المعمل والمساحة المشتركة أعلاها */}
              <HallCard
                space={spaceBySlug[SLUGS.training]}
                bookings={bookings}
                now={now}
                onSelect={handleSeatClick}
                size="lg"
                className="w-full"
              />
            </div>

            {/* الوسط: مساحة عمل ثنائية فقط — عنصر عائم أعلى الوسط */}
            <div>
              <p className="mb-2 text-[11px] text-gray-500">مساحة عمل ثنائية</p>
              <div className="flex flex-wrap gap-3">
                {dualSeats.map((seat) => {
                  const alert = isRedAlert(seat);
                  const bg = seat.occupied ? (alert ? "bg-floor-alert" : "bg-floor-occupied") : "bg-floor-available";
                  return (
                    <div key={seat.key} className="group relative">
                      <button
                        type="button"
                        onClick={seat.clickable ? () => handleSeatClick(dual) : undefined}
                        disabled={!seat.clickable}
                        className={`h-11 w-20 rounded-2xl ${bg} shadow-[0_2px_6px_rgba(115,79,150,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_14px_rgba(115,79,150,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                          alert ? "animate-pulse-soft" : ""
                        } ${seat.clickable ? "cursor-pointer" : "cursor-default opacity-90"}`}
                        aria-label={seat.seatLabel}
                      />
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-48 -translate-x-1/2 rounded-2xl bg-white/95 p-3 text-right opacity-0 shadow-[0_10px_30px_rgba(76,53,105,0.25)] transition-all duration-150 group-hover:opacity-100">
                        <p className="text-xs font-bold text-gray-900">{seat.spaceName}</p>
                        <p className="text-[11px] text-gray-500">{seat.seatLabel}</p>
                        {seat.price !== null && (
                          <p className="mt-1 text-[11px] font-semibold text-rimal-purple">يبدأ من {formatSAR(seat.price)}</p>
                        )}
                        <TooltipStatusLine seat={seat} />
                        {seat.occupied && seat.customerName && (
                          <p className="mt-0.5 text-[11px] text-gray-500">العميل: {seat.customerName}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* أقصى اليسار: 8 مقاعد على شكل حرف L، ثم لاونج VIP، ثم قاعة الابتكار تحتها مباشرة */}
            <div className="flex flex-col items-center gap-4">
              <div>
                <p className="mb-2 text-center text-[11px] text-gray-500">مساحة عمل مشتركة</p>
                {/* items-end تُحاذي الصف والعمود لنفس الحافة (أقصى اليسار) فيرتسم شكل حرف L/٦ معكوس بدقة */}
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    {sharedLShape.slice(0, 4).map((seat) => (
                      <Seat key={seat.key} seat={seat} onClick={() => handleSeatClick(shared)} />
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    {sharedLShape.slice(4, 8).map((seat) => (
                      <Seat key={seat.key} seat={seat} onClick={() => handleSeatClick(shared)} />
                    ))}
                  </div>
                </div>
              </div>

              {/* بدون شبكة زخرفية داخلية — لتطابق حجم قاعدة الابتكار تماماً */}
              <HallCard
                space={spaceBySlug[SLUGS.vip]}
                bookings={bookings}
                now={now}
                onSelect={handleSeatClick}
                size="lg"
                className="w-full"
              />
              <HallCard
                space={spaceBySlug[SLUGS.innovation]}
                bookings={bookings}
                now={now}
                onSelect={handleSeatClick}
                size="lg"
                className="w-full"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

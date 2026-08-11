import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { businessWindowForDateKey } from "@/lib/business-hours";
import { addMinutes } from "date-fns";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const RIYADH_OFFSET_HOURS = 3;

interface WeeklyDayWindow {
  open: string;
  close: string;
}

/** يحوّل "HH:MM" بتوقيت الرياض المحلي إلى عدد دقائق منذ منتصف الليل بتوقيت UTC. */
function riyadhTimeToUtcMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h - RIYADH_OFFSET_HOURS) * 60 + m;
}

/**
 * فتحات الوقت المتاحة لمساحة معينة في يوم محدد — عام (لا يتطلب تسجيل دخول)،
 * مطابقاً لـ `GET /api/spaces` في هذا. مبني على `weeklyAvailability` للمساحة
 * (بتوقيت الرياض المحلي) مقيَّداً أيضاً بساعات العمل العامة 8 صباحاً–10 مساءً
 * (نفس القيد المطبَّق فعلياً عند إنشاء الحجز في `createBookingSchema`)، مقسَّماً
 * لفتحات بحجم `granularityMinutes` (افتراضياً 60، ويستخدم منتقي الوقت 15 دقيقة)
 * — كل فتحة تُفحَص مقابل الحجوزات الفعلية المتداخلة لتحديد `isAvailable`.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spaceId = searchParams.get("spaceId");
    const dateParam = searchParams.get("date");
    const granularityMinutes = Math.max(5, Number(searchParams.get("granularityMinutes")) || 60);

    if (!spaceId || !dateParam) {
      return NextResponse.json({ error: "يجب تحديد spaceId و date" }, { status: 400 });
    }

    const date = new Date(`${dateParam}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "صيغة التاريخ غير صالحة" }, { status: 400 });
    }

    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space || !space.isActive) {
      return NextResponse.json({ error: "المساحة المطلوبة غير موجودة أو غير متاحة" }, { status: 404 });
    }

    // ساعات دوام المقر لهذا اليوم (الجمعة إجازة، السبت يفتح 9ص، الباقي 8ص) —
    // مصدر الحقيقة الموحَّد نفسه المستخدَم في التحقق عند إنشاء الحجز.
    const venueWindow = businessWindowForDateKey(dateParam);
    if (!venueWindow) {
      return NextResponse.json({ slots: [], closedReason: "المقر مغلق يوم الجمعة (إجازة أسبوعية)" });
    }

    const dayKey = DAY_KEYS[date.getUTCDay()];
    const weekly = (space.weeklyAvailability as Record<string, WeeklyDayWindow> | null) ?? {};
    const dayWindow = weekly[dayKey];

    if (!dayWindow) {
      return NextResponse.json({ slots: [], closedReason: "المساحة مغلقة هذا اليوم" });
    }

    // الفتحات = تقاطع نافذة دوام المقر مع نافذة توفّر هذه المساحة تحديداً.
    const openMinutes = Math.max(
      riyadhTimeToUtcMinutes(dayWindow.open),
      (venueWindow.openHour - RIYADH_OFFSET_HOURS) * 60
    );
    const closeMinutes = Math.min(
      riyadhTimeToUtcMinutes(dayWindow.close),
      (venueWindow.closeHour - RIYADH_OFFSET_HOURS) * 60
    );

    if (openMinutes >= closeMinutes) {
      return NextResponse.json({ slots: [], closedReason: "المساحة مغلقة هذا اليوم" });
    }

    const dayBookings = await prisma.booking.findMany({
      where: {
        spaceId: space.id,
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        startTime: { lt: addMinutes(date, closeMinutes) },
        endTime: { gt: addMinutes(date, openMinutes) },
      },
      select: { startTime: true, endTime: true },
    });

    const now = Date.now();
    const slots = [];
    // تُعرَض كل الفتحات حتى ساعة الإغلاق (وليس حتى آخر بداية صالحة فقط) لأن
    // منتقي الوقت يحتاجها لفحص تغطية المدة الكاملة للحجز: بداية 9 مساءً بمدة
    // ساعة تحتاج التأكد من توفر 9:00 و9:15 و9:30 و9:45 معاً. الفتحات التي لا
    // تكفي لإتمام المدة المطلوبة قبل الإغلاق يُعطّلها المنتقي نفسه بسبب واضح.
    for (let m = openMinutes; m < closeMinutes; m += granularityMinutes) {
      const slotStart = addMinutes(date, m);
      const slotEnd = addMinutes(date, m + granularityMinutes);
      const isPast = slotStart.getTime() < now;
      const overlapping = dayBookings.filter((b) => b.startTime < slotEnd && b.endTime > slotStart).length;
      const isBooked = overlapping >= space.capacityUnits;

      slots.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        isAvailable: !isPast && !isBooked,
        // سبب واضح لعدم التوفر — يُعرض للعميل بدل رفض صامت: "PAST" (الوقت فات
        // لليوم نفسه) أو "BOOKED" (محجوز بالكامل)؛ null يعني الفتحة متاحة فعلاً.
        reason: isPast ? "PAST" : isBooked ? "BOOKED" : null,
      });
    }

    return NextResponse.json({ slots });
  } catch (error) {
    return handleApiError(error);
  }
}

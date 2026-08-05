import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { addMinutes } from "date-fns";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const RIYADH_OFFSET_HOURS = 3;
const GLOBAL_OPEN_HOUR = 9;
const GLOBAL_CLOSE_HOUR = 23;

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
 * (بتوقيت الرياض المحلي) مقيَّداً أيضاً بساعات العمل العامة 9 صباحاً–11 مساءً
 * (نفس القيد المطبَّق فعلياً عند إنشاء الحجز في `createBookingSchema`)، مقسَّماً
 * لفتحات بحجم `granularityMinutes` (افتراضياً 60، يقبل أي قيمة كـ10 لمنتقي وقت
 * أدق) — كل فتحة تُفحَص مقابل الحجوزات الفعلية المتداخلة لتحديد `isAvailable`.
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

    const dayKey = DAY_KEYS[date.getUTCDay()];
    const weekly = (space.weeklyAvailability as Record<string, WeeklyDayWindow> | null) ?? {};
    const dayWindow = weekly[dayKey];

    if (!dayWindow) {
      return NextResponse.json({ slots: [] });
    }

    const openMinutes = Math.max(riyadhTimeToUtcMinutes(dayWindow.open), GLOBAL_OPEN_HOUR * 60 - RIYADH_OFFSET_HOURS * 60);
    const closeMinutes = Math.min(riyadhTimeToUtcMinutes(dayWindow.close), GLOBAL_CLOSE_HOUR * 60 - RIYADH_OFFSET_HOURS * 60);

    if (openMinutes >= closeMinutes) {
      return NextResponse.json({ slots: [] });
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

    const slots = [];
    for (let m = openMinutes; m < closeMinutes; m += granularityMinutes) {
      const slotStart = addMinutes(date, m);
      const slotEnd = addMinutes(date, m + granularityMinutes);
      const overlapping = dayBookings.filter((b) => b.startTime < slotEnd && b.endTime > slotStart).length;

      slots.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        isAvailable: overlapping < space.capacityUnits,
      });
    }

    return NextResponse.json({ slots });
  } catch (error) {
    return handleApiError(error);
  }
}

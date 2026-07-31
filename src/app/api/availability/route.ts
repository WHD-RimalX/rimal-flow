import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { addHours } from "date-fns";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface WeeklyDayWindow {
  open: string;
  close: string;
}

/**
 * فتحات الوقت المتاحة لمساحة معينة في يوم محدد — عام (لا يتطلب تسجيل دخول)،
 * مطابقاً لـ `GET /api/spaces` في هذا. مبني على `weeklyAvailability` للمساحة
 * مقسَّماً لفتحات بالساعة، وكل فتحة تُفحَص مقابل الحجوزات الفعلية المتداخلة
 * لتحديد `isAvailable` دون تجاوز `capacityUnits`.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spaceId = searchParams.get("spaceId");
    const dateParam = searchParams.get("date");

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

    const [openHour] = dayWindow.open.split(":").map(Number);
    const [closeHour] = dayWindow.close.split(":").map(Number);

    const dayBookings = await prisma.booking.findMany({
      where: {
        spaceId: space.id,
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        startTime: { lt: addHours(date, closeHour) },
        endTime: { gt: addHours(date, openHour) },
      },
      select: { startTime: true, endTime: true },
    });

    const slots = [];
    for (let hour = openHour; hour < closeHour; hour++) {
      const slotStart = addHours(date, hour);
      const slotEnd = addHours(date, hour + 1);
      const overlapping = dayBookings.filter(
        (b) => b.startTime < slotEnd && b.endTime > slotStart
      ).length;

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

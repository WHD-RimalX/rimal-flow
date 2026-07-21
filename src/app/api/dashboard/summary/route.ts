import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { endOfDay, startOfDay, addMinutes } from "date-fns";

/** إحصائيات لحظية للوحة اليوم (Timeline Command Center). */
export async function GET() {
  try {
    await requireStaffSession();

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [
      totalToday,
      currentlyCheckedIn,
      upcomingSoon,
      lateArrivals,
      cancelledOrNoShow,
      checkedOutToday,
      activeSubscribersCount,
    ] = await Promise.all([
      prisma.booking.count({
        where: { startTime: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.booking.count({ where: { status: "CHECKED_IN" } }),
      prisma.booking.count({
        where: {
          status: { in: ["PENDING", "CONFIRMED"] },
          startTime: { gte: now, lte: addMinutes(now, 60) },
        },
      }),
      prisma.booking.count({
        where: {
          status: { in: ["PENDING", "CONFIRMED"] },
          startTime: { lt: addMinutes(now, -30) },
          endTime: { gte: now },
        },
      }),
      prisma.booking.count({
        where: {
          status: { in: ["CANCELLED", "NO_SHOW"] },
          startTime: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.booking.count({
        where: { status: "CHECKED_OUT", startTime: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.booking.count({
        where: {
          bookingType: { in: ["MONTHLY_MORNING", "MONTHLY_EVENING"] },
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
          endTime: { gte: now },
        },
      }),
    ]);

    return NextResponse.json({
      totalToday,
      currentlyCheckedIn,
      upcomingSoon,
      lateArrivals,
      cancelledOrNoShow,
      checkedOutToday,
      activeSubscribersCount,
      generatedAt: now,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

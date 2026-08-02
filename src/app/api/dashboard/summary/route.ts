import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { hasPermission } from "@/lib/rbac";
import { endOfDay, startOfDay, addMinutes } from "date-fns";

/** إحصائيات لحظية للوحة اليوم (Timeline Command Center). */
export async function GET() {
  try {
    const session = await requireStaffSession();

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

    // إيراد اليوم — لمن يملك صلاحية canViewReports فقط (ADMIN/SUPER_ADMIN)؛ يُحذف
    // الحقل تماماً من الاستجابة لغيرهم بدل إعادته صفراً، لتفادي أي تسريب بيانات مالية.
    let revenueToday: string | undefined;
    if (hasPermission(session.user, "canViewReports")) {
      const revenue = await prisma.booking.aggregate({
        where: {
          startTime: { gte: todayStart, lte: todayEnd },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        _sum: { finalPrice: true },
      });
      revenueToday = (revenue._sum.finalPrice ?? 0).toString();
    }

    return NextResponse.json({
      totalToday,
      currentlyCheckedIn,
      upcomingSoon,
      lateArrivals,
      cancelledOrNoShow,
      checkedOutToday,
      activeSubscribersCount,
      ...(revenueToday !== undefined ? { revenueToday } : {}),
      generatedAt: now,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

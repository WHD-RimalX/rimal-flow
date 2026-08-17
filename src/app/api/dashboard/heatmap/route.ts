import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { BUSINESS_WEEK, riyadhDayOfWeek, riyadhHourOfDay } from "@/lib/business-hours";
import { z } from "zod";

const querySchema = z.object({
  /** عدد الأيام الماضية المشمولة في التحليل. */
  days: z.coerce.number().int().min(7).max(180).default(30),
  spaceId: z.string().trim().min(1).optional(),
});

/** الحالات التي تمثّل إشغالاً فعلياً — الملغاة والمرفوضة وعدم الحضور ليست إشغالاً. */
const OCCUPYING_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const;

/**
 * الخريطة الحرارية للإشغال: كثافة الحجوزات لكل (يوم أسبوع × ساعة) عبر نافذة
 * زمنية ماضية.
 *
 * لماذا هكذا: سؤال التشغيل الحقيقي ليس "كم حجزاً هذا الشهر؟" بل "متى يمتلئ
 * المكان ومتى يفرغ؟" — وهذا يظهر فقط بتجميع الحجوزات على شبكة اليوم×الساعة.
 * تُحتسب كل ساعة *يلامسها* الحجز لا ساعة بدايته فقط، فحجز من 9 إلى 12 يظهر
 * إشغالاً في الساعات الثلاث كلها — وإلا بدت الذروة كأنها لحظة واحدة.
 *
 * كل الحسابات بتوقيت الرياض الثابت، ويُستبعَد يوم الجمعة تلقائياً لأنه إجازة
 * (BUSINESS_WEEK هو المرجع، فلو تغيّر الدوام لاحقاً تتبعه الخريطة بلا تعديل).
 */
export async function GET(req: NextRequest) {
  try {
    await requireStaffSession();

    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      days: searchParams.get("days") ?? undefined,
      spaceId: searchParams.get("spaceId") ?? undefined,
    });

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: [...OCCUPYING_STATUSES] },
        startTime: { gte: since },
        ...(query.spaceId ? { spaceId: query.spaceId } : {}),
      },
      select: { startTime: true, endTime: true, bookingType: true, finalPrice: true },
    });

    // أيام الدوام فقط (الجمعة مستبعدة) والساعات ضمن أوسع نافذة دوام في الأسبوع.
    const openDays = BUSINESS_WEEK.map((w, i) => ({ w, i })).filter((d) => d.w !== null);
    const minHour = Math.min(...openDays.map((d) => d.w!.openHour));
    const maxHour = Math.max(...openDays.map((d) => d.w!.closeHour));
    const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);

    // شبكة العدّ: [يوم الأسبوع][الساعة]
    const grid: Record<number, Record<number, number>> = {};
    for (const d of openDays) {
      grid[d.i] = {};
      for (const h of hours) grid[d.i][h] = 0;
    }

    let totalRevenue = 0;
    for (const b of bookings) {
      totalRevenue += Number(b.finalPrice);

      // الاشتراكات الشهرية تمتد 30 يوماً — احتسابها كإشغال متصل يُغرِق الشبكة
      // بالكامل ويخفي أنماط الحجز الفعلية، فتُستبعَد من خريطة الساعات.
      if (b.bookingType === "MONTHLY_MORNING" || b.bookingType === "MONTHLY_EVENING") continue;

      const day = riyadhDayOfWeek(b.startTime);
      if (!grid[day]) continue;

      const startHour = Math.floor(riyadhHourOfDay(b.startTime));
      const endExclusive = Math.ceil(riyadhHourOfDay(b.endTime));
      for (let h = startHour; h < endExclusive; h++) {
        if (grid[day][h] !== undefined) grid[day][h] += 1;
      }
    }

    // أعلى قيمة في الشبكة — تُستخدَم لتدريج الألوان نسبياً في الواجهة.
    let peak = 0;
    let peakCell: { day: number; hour: number } | null = null;
    for (const d of openDays) {
      for (const h of hours) {
        if (grid[d.i][h] > peak) {
          peak = grid[d.i][h];
          peakCell = { day: d.i, hour: h };
        }
      }
    }

    return NextResponse.json({
      days: query.days,
      hours,
      openDays: openDays.map((d) => d.i),
      grid,
      peak,
      peakCell,
      totalBookings: bookings.length,
      totalRevenue,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

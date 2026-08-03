import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireSession } from "@/lib/session";
import { isResumableBookingType } from "@/lib/attendance";
import { serializeBooking } from "@/lib/serialize-booking";

const HOUR_MS = 60 * 60 * 1000;

/**
 * تجديد حجز باقة قصيرة (ساعة/4 ساعات/يومي) بعد تجاوزه وقته المحدد وهو لا يزال
 * حاضراً (CHECKED_IN) — يُحتسب كفاتورة إضافية جديدة، بتقريب وقت التجاوز لأعلى
 * (ceiling) للساعة الكاملة التالية (وليس لأقرب ساعة)، ثم يُعرض الوقت المتبقي
 * الفعلي بعد خصم ما استُهلِك بالفعل من التجاوز من هذه الساعة/الساعات الإضافية.
 * ذاتي الخدمة من حساب العميل نفسه (صاحب الحجز فقط) — الباقات الشهرية القابلة
 * للاستئناف أصلاً لا تحتاج هذا المسار.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" } } },
    });

    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }
    if (booking.userId !== session.user.id) {
      return NextResponse.json({ error: "لا تملك صلاحية تجديد هذا الحجز" }, { status: 403 });
    }
    if (isResumableBookingType(booking.bookingType)) {
      return NextResponse.json({ error: "التجديد غير مطلوب لهذا النوع من الحجوزات" }, { status: 400 });
    }
    if (booking.status !== "CHECKED_IN") {
      return NextResponse.json({ error: "التجديد متاح فقط أثناء الحضور الفعلي" }, { status: 422 });
    }

    const activeLog = booking.checkInLogs.find((l) => l.action === "CHECK_IN" && l.success && l.expectedEndTime);
    if (!activeLog?.expectedEndTime) {
      return NextResponse.json({ error: "تعذّر تحديد جلسة الحضور الحالية" }, { status: 422 });
    }

    const now = new Date();
    const overtimeMs = now.getTime() - activeLog.expectedEndTime.getTime();
    if (overtimeMs <= 0) {
      return NextResponse.json({ error: "لم يتجاوز هذا الحجز وقته المحدد بعد" }, { status: 422 });
    }

    // التقريب لأعلى (Ceiling) وليس لأقرب ساعة — أي دقيقة تجاوز تُحتسب كساعة كاملة إضافية
    const extraHours = Math.max(1, Math.ceil(overtimeMs / HOUR_MS));
    const extraMs = extraHours * HOUR_MS;
    const hourlyRate = booking.space.hourlyPrice ? Number(booking.space.hourlyPrice) : 0;
    const extraCharge = extraHours * hourlyRate;

    const newExpectedEndTime = new Date(activeLog.expectedEndTime.getTime() + extraMs);
    const newEndTime = new Date(booking.endTime.getTime() + extraMs);
    const newRemainingMs = newExpectedEndTime.getTime() - now.getTime();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.checkInLog.update({
        where: { id: activeLog.id },
        data: { expectedEndTime: newExpectedEndTime },
      });

      return tx.booking.update({
        where: { id: booking.id },
        data: {
          endTime: newEndTime,
          basePrice: { increment: extraCharge },
          finalPrice: { increment: extraCharge },
        },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
      });
    });

    return NextResponse.json({
      booking: serializeBooking(updated),
      extraHours,
      extraCharge,
      remainingMs: newRemainingMs,
      message: `تم تجديد الحجز بساعة إضافية${extraHours > 1 ? ` (${extraHours} ساعات)` : ""} — التكلفة الإضافية ${extraCharge} ر.س`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

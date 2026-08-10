import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireSession } from "@/lib/session";
import { isResumableBookingType } from "@/lib/attendance";
import { serializeBooking } from "@/lib/serialize-booking";
import { assertNoBookingConflict, ConflictError } from "@/lib/availability";

const HOUR_MS = 60 * 60 * 1000;

class ExtendStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * تجديد حجز باقة قصيرة (ساعة/4 ساعات/يومي) بعد تجاوزه وقته المحدد وهو لا يزال
 * حاضراً (CHECKED_IN) — يُحتسب كفاتورة إضافية جديدة، بتقريب وقت التجاوز لأعلى
 * (ceiling) للساعة الكاملة التالية (وليس لأقرب ساعة)، ثم يُعرض الوقت المتبقي
 * الفعلي بعد خصم ما استُهلِك بالفعل من التجاوز من هذه الساعة/الساعات الإضافية.
 * ذاتي الخدمة من حساب العميل نفسه (صاحب الحجز فقط) — الباقات الشهرية القابلة
 * للاستئناف أصلاً لا تحتاج هذا المسار.
 *
 * SECURITY-AUDIT.md §1 (FLOW-C04): كانت القراءة (وقت التجاوز الحالي) والكتابة
 * (الرسم والتمديد) منفصلتين بلا قفل — تمديدان متزامنان يحسبان نفس وقت التجاوز
 * فيمدّان لنفس الوقت الجديد لكن كل منهما يزيد السعر مرة، فيُحاسَب العميل مرتين
 * عن تمديد فعلي واحد.
 *
 * SECURITY-AUDIT(V2).md §1 (FLOW-C04): قفل صف "الحجز" وحده كان يمنع ازدواج
 * الرسم على نفس الحجز، لكنه لا يمنع تمديد هذا الحجز إلى فترة تتعارض فعلياً مع
 * حجز آخر موجود لنفس المساحة (لا فحص تعارض إطلاقاً بعد التمديد). الآن يُقفل
 * صف "المساحة" أولاً (نفس ترتيب القفل الموحَّد في كل مسارات الحجز الأخرى)، ثم
 * تُعاد قراءة الحجز طازجة ضمن نفس المعاملة، ثم يُعاد فحص التعارض على الفترة
 * الجديدة الممدَّدة كاملة (بدون هذا الحجز نفسه) قبل الكتابة — تمديدان متزامنان
 * لنفس الحجز يتسلسلان تلقائياً لأن كليهما يقفلان نفس صف المساحة أولاً.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const bookingOwner = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { userId: true, spaceId: true },
    });
    if (!bookingOwner) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }
    if (bookingOwner.userId !== session.user.id) {
      return NextResponse.json({ error: "لا تملك صلاحية تجديد هذا الحجز" }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "spaces" WHERE "id" = ${bookingOwner.spaceId} FOR UPDATE`;

      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: params.id },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" } } },
      });

      if (isResumableBookingType(booking.bookingType)) {
        throw new ExtendStateError("التجديد غير مطلوب لهذا النوع من الحجوزات");
      }
      if (booking.status !== "CHECKED_IN") {
        throw new ExtendStateError("التجديد متاح فقط أثناء الحضور الفعلي");
      }

      const activeLog = booking.checkInLogs.find((l) => l.action === "CHECK_IN" && l.success && l.expectedEndTime);
      if (!activeLog?.expectedEndTime) {
        throw new ExtendStateError("تعذّر تحديد جلسة الحضور الحالية");
      }

      const now = new Date();
      const overtimeMs = now.getTime() - activeLog.expectedEndTime.getTime();
      if (overtimeMs <= 0) {
        throw new ExtendStateError("لم يتجاوز هذا الحجز وقته المحدد بعد");
      }

      // التقريب لأعلى (Ceiling) وليس لأقرب ساعة — أي دقيقة تجاوز تُحتسب كساعة كاملة إضافية
      const extraHours = Math.max(1, Math.ceil(overtimeMs / HOUR_MS));
      const extraMs = extraHours * HOUR_MS;
      const hourlyRate = booking.space.hourlyPrice ? Number(booking.space.hourlyPrice) : 0;
      const extraCharge = extraHours * hourlyRate;

      const newExpectedEndTime = new Date(activeLog.expectedEndTime.getTime() + extraMs);
      const newEndTime = new Date(booking.endTime.getTime() + extraMs);
      const newRemainingMs = newExpectedEndTime.getTime() - now.getTime();

      // إعادة فحص التعارض على الفترة الجديدة الممدَّدة كاملة (باستثناء هذا الحجز
      // نفسه) الآن وصف المساحة مقفول — يمنع تمديد حجز إلى فترة يشغلها حجز آخر.
      await assertNoBookingConflict(booking.space, booking.startTime, newEndTime, booking.id, tx);

      await tx.checkInLog.update({
        where: { id: activeLog.id },
        data: { expectedEndTime: newExpectedEndTime },
      });

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          endTime: newEndTime,
          basePrice: { increment: extraCharge },
          finalPrice: { increment: extraCharge },
        },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
      });

      return { updated, extraHours, extraCharge, newRemainingMs };
    });

    return NextResponse.json({
      booking: serializeBooking(result.updated),
      extraHours: result.extraHours,
      extraCharge: result.extraCharge,
      remainingMs: result.newRemainingMs,
      message: `تم تجديد الحجز بساعة إضافية${result.extraHours > 1 ? ` (${result.extraHours} ساعات)` : ""} — التكلفة الإضافية ${result.extraCharge} ر.س`,
    });
  } catch (error) {
    if (error instanceof ExtendStateError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}

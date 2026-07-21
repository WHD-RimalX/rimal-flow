import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInRequestSchema } from "@/validations/checkin";
import { checkInWindow, DUPLICATE_ACTION_COOLDOWN_MINUTES } from "@/lib/pricing";
import { ARRIVAL_BUFFER_SECONDS } from "@/lib/attendance";
import { handleApiError } from "@/lib/api-response";
import { getAuthSession } from "@/lib/session";
import { differenceInMinutes, addSeconds } from "date-fns";

/**
 * محرك تسجيل الحضور/الانصراف عبر QR — رمال فلو
 *
 * القيود المطبّقة (Anti-fraud & Restrictions):
 * 1) التحقق من صحة رمز QR الخاص بالمقر (رمز ثابت للفرع).
 * 2) منع تسجيل الخروج (CHECK_OUT) بدون تسجيل دخول (CHECK_IN) سابق للحجز.
 * 3) منع تكرار نفس الإجراء خلال نافذة تهدئة زمنية (3 دقائق) لمنع الاحتيال/الضغط المتكرر.
 * 4) التحقق من أن الوقت الحالي ضمن النافذة المسموح بها حول موعد الحجز (±30 دقيقة) لتسجيل الحضور.
 * 5) عند نجاح تسجيل الحضور: تبدأ مهلة وصول 30 ثانية (ARRIVAL_BUFFER_SECONDS)، وبعدها
 *    يبدأ المؤقت التنازلي الفعلي لمدة الحجز المدفوعة — يُخزَّنان في CheckInLog.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await req.json();
    const data = checkInRequestSchema.parse(body);

    const venueQrCode = process.env.NEXT_PUBLIC_VENUE_QR_CODE ?? "RIMALX-HQ-MAIN-BRANCH-0001";
    if (data.qrCode !== venueQrCode) {
      return NextResponse.json(
        { error: "رمز QR غير صالح — يرجى المسح من نقطة الاستقبال المعتمدة" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { bookingCode: data.bookingCode },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الكود" }, { status: 404 });
    }

    if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
      return NextResponse.json(
        { error: "هذا الحجز ملغى أو مسجَّل كعدم حضور — لا يمكن تنفيذ الإجراء" },
        { status: 422 }
      );
    }

    const now = new Date();
    const lastLogOfSameAction = booking.checkInLogs.find((log) => log.action === data.action);

    // (3) نافذة التهدئة الزمنية لمنع تكرار نفس الإجراء (احتيال/ضغط متكرر على الزر)
    if (lastLogOfSameAction) {
      const minutesSinceLast = differenceInMinutes(now, lastLogOfSameAction.timestamp);
      if (minutesSinceLast < DUPLICATE_ACTION_COOLDOWN_MINUTES) {
        await logFailedAttempt(
          booking.id,
          data.action,
          session?.user?.id,
          `محاولة تكرار الإجراء خلال أقل من ${DUPLICATE_ACTION_COOLDOWN_MINUTES} دقائق`
        );
        return NextResponse.json(
          {
            error: `تم تنفيذ هذا الإجراء مؤخراً — يرجى الانتظار ${
              DUPLICATE_ACTION_COOLDOWN_MINUTES - minutesSinceLast
            } دقيقة قبل إعادة المحاولة`,
          },
          { status: 429 }
        );
      }
    }

    if (data.action === "CHECK_IN") {
      // منع تسجيل الدخول إن كان الحجز مسجَّل حضور بالفعل ولم يُسجَّل انصراف بعد
      if (booking.status === "CHECKED_IN") {
        await logFailedAttempt(booking.id, data.action, session?.user?.id, "تسجيل حضور مكرر لحجز نشط بالفعل");
        return NextResponse.json({ error: "تم تسجيل الحضور مسبقاً لهذا الحجز" }, { status: 409 });
      }

      if (booking.status === "CHECKED_OUT") {
        await logFailedAttempt(booking.id, data.action, session?.user?.id, "محاولة تسجيل حضور بعد انتهاء الحجز");
        return NextResponse.json({ error: "تم إغلاق هذا الحجز بالفعل بعد تسجيل الانصراف" }, { status: 409 });
      }

      // (4) التحقق من نافذة الوصول المسموح بها حول وقت بداية الحجز (±30 دقيقة)
      const { windowStart, windowEnd } = checkInWindow(booking.startTime);
      if (now < windowStart || now > windowEnd) {
        await logFailedAttempt(
          booking.id,
          data.action,
          session?.user?.id,
          "خارج النافذة الزمنية المسموح بها لتسجيل الحضور"
        );
        return NextResponse.json(
          {
            error:
              "لا يمكن تسجيل الحضور الآن — يُسمح بالوصول قبل موعد الحجز أو بعده بـ 30 دقيقة فقط",
          },
          { status: 422 }
        );
      }

      // (5) مهلة الوصول (30 ثانية) ثم بدء المؤقت التنازلي الفعلي لمدة الحجز المدفوعة
      const bufferEndsAt = addSeconds(now, ARRIVAL_BUFFER_SECONDS);
      const bookingDurationMs = booking.endTime.getTime() - booking.startTime.getTime();
      const actualStartTime = bufferEndsAt;
      const expectedEndTime = new Date(actualStartTime.getTime() + bookingDurationMs);

      const [, updatedBooking] = await prisma.$transaction([
        prisma.checkInLog.create({
          data: {
            bookingId: booking.id,
            action: "CHECK_IN",
            performedById: session?.user?.id,
            success: true,
            bufferEndsAt,
            actualStartTime,
            expectedEndTime,
          },
        }),
        prisma.booking.update({
          where: { id: booking.id },
          data: { status: "CHECKED_IN" },
          include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 5 } },
        }),
      ]);

      return NextResponse.json({
        booking: updatedBooking,
        message: `تم تسجيل الحضور بنجاح — مهلة الوصول للمقعد ${ARRIVAL_BUFFER_SECONDS} ثانية قبل بدء احتساب الوقت`,
      });
    }

    // action === CHECK_OUT
    // (2) منع تسجيل الخروج بدون تسجيل دخول سابق
    if (booking.status !== "CHECKED_IN") {
      await logFailedAttempt(
        booking.id,
        data.action,
        session?.user?.id,
        "محاولة تسجيل انصراف بدون تسجيل حضور مسبق"
      );
      return NextResponse.json(
        { error: "لا يمكن تسجيل الانصراف قبل تسجيل الحضور أولاً" },
        { status: 409 }
      );
    }

    const [, updatedBooking] = await prisma.$transaction([
      prisma.checkInLog.create({
        data: {
          bookingId: booking.id,
          action: "CHECK_OUT",
          performedById: session?.user?.id,
          success: true,
        },
      }),
      prisma.booking.update({
        where: { id: booking.id },
        data: { status: "CHECKED_OUT" },
        include: { space: true },
      }),
    ]);

    return NextResponse.json({ booking: updatedBooking, message: "تم تسجيل الانصراف بنجاح" });
  } catch (error) {
    return handleApiError(error);
  }
}

async function logFailedAttempt(
  bookingId: string,
  action: "CHECK_IN" | "CHECK_OUT",
  performedById: string | undefined,
  reason: string
) {
  await prisma.checkInLog.create({
    data: {
      bookingId,
      action,
      performedById,
      success: false,
      failureReason: reason,
    },
  });
}

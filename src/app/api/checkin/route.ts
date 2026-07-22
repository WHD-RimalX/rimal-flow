import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInRequestSchema } from "@/validations/checkin";
import { checkInWindow, DUPLICATE_ACTION_COOLDOWN_MINUTES } from "@/lib/pricing";
import { ARRIVAL_BUFFER_SECONDS, computeRemainingBudgetMs } from "@/lib/attendance";
import { handleApiError } from "@/lib/api-response";
import { getAuthSession } from "@/lib/session";
import { differenceInMinutes, addSeconds } from "date-fns";

/**
 * محرك تسجيل الحضور/الانصراف عبر QR — رمال فلو
 *
 * القيود المطبّقة (Anti-fraud & Restrictions):
 * 1) التحقق من صحة رمز QR الخاص بالمقر (رمز ثابت للفرع).
 * 2) منع تسجيل الخروج (CHECK_OUT) بدون تسجيل دخول (CHECK_IN) سابق للحجز.
 * 3) منع تكرار نفس الإجراء مباشرة تلو الآخر خلال نافذة تهدئة زمنية (3 دقائق) —
 *    تُقارَن فقط بآخر سجل فعلي بصرف النظر عن نوعه: إن كان آخر سجل هو الإجراء
 *    المعاكس (مثال: انصرف ثم يريد الدخول مجدداً) لا يوجد أي انتظار إطلاقاً.
 * 4) نافذة الوصول (±30 دقيقة حول موعد بداية الحجز) تُطبَّق فقط على أول تسجيل
 *    دخول للحجز؛ أي عودة لاحقة (بعد انصراف سابق) مسموحة في أي وقت طالما لم
 *    تنتهِ صلاحية الحجز الإجمالية (endTime) ولا يزال هناك رصيد وقت متبقٍ.
 * 5) الحجز لا "ينتهي" بمجرد الانصراف — الانصراف يوقف استهلاك الوقت مؤقتاً فقط.
 *    عند كل تسجيل دخول (أول مرة أو استئناف)، يبدأ مهلة وصول 30 ثانية، ثم يُستكمَل
 *    العدّاد من الرصيد المتبقي الفعلي (المدة الكاملة ناقص كل الجلسات السابقة).
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
    // (3) التهدئة تُقارَن فقط بآخر سجل فعلي (بصرف النظر عن نوعه)، وتُطبَّق فقط
    // إن كان مطابقاً لنفس الإجراء المطلوب الآن — تكرار سريع لنفس الزر تحديداً.
    const lastLog = booking.checkInLogs[0];

    if (lastLog && lastLog.action === data.action) {
      const minutesSinceLast = differenceInMinutes(now, lastLog.timestamp);
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

      const isFirstEverCheckIn = !booking.checkInLogs.some((l) => l.action === "CHECK_IN" && l.success);

      if (isFirstEverCheckIn) {
        // (4) نافذة الوصول (±30 دقيقة) تُطبَّق فقط على أول تسجيل دخول للحجز
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
      } else if (now > booking.endTime) {
        // عودة بعد انصراف سابق، لكن انتهت صلاحية الحجز الإجمالية
        await logFailedAttempt(booking.id, data.action, session?.user?.id, "انتهت صلاحية الحجز الزمنية");
        return NextResponse.json({ error: "انتهت صلاحية هذا الحجز — لا يمكن تسجيل الحضور مجدداً" }, { status: 422 });
      }

      // (5) الرصيد المتبقي من وقت الحجز المدفوع (يُستأنف من حيث توقّف عند أي عودة)
      const remainingBudgetMs = computeRemainingBudgetMs(booking);
      if (remainingBudgetMs <= 0) {
        await logFailedAttempt(booking.id, data.action, session?.user?.id, "تم استهلاك كامل وقت الحجز");
        return NextResponse.json({ error: "تم استهلاك كامل الوقت المدفوع لهذا الحجز" }, { status: 422 });
      }

      const bufferEndsAt = addSeconds(now, ARRIVAL_BUFFER_SECONDS);
      const actualStartTime = bufferEndsAt;
      const expectedEndTime = new Date(actualStartTime.getTime() + remainingBudgetMs);

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
          include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
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
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
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

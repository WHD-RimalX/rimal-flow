import { prisma } from "@/lib/prisma";
import { checkInWindow, DUPLICATE_ACTION_COOLDOWN_MINUTES } from "@/lib/pricing";
import { ARRIVAL_BUFFER_SECONDS, computeRemainingBudgetMs } from "@/lib/attendance";
import { serializeBooking } from "@/lib/serialize-booking";
import { differenceInMinutes, addSeconds } from "date-fns";
import type { Booking, CheckInLog, Space } from "@prisma/client";

type BookingWithLogs = Booking & { checkInLogs: CheckInLog[]; space: Space };

export interface CheckInResult {
  status: number;
  body: Record<string, unknown>;
}

async function logFailedAttempt(
  bookingId: string,
  action: "CHECK_IN" | "CHECK_OUT",
  performedById: string | undefined,
  reason: string
) {
  await prisma.checkInLog.create({
    data: { bookingId, action, performedById, success: false, failureReason: reason },
  });
}

/**
 * المحرك المشترك لتسجيل الحضور/الانصراف — يستخدمه كل من `/api/checkin` (مسار
 * الماسح الذاتي عبر QR للعملاء) و`/api/bookings/:id/check-in` (المسار الرسمي
 * حسب عقد التكامل §10، يدعم `idempotencyKey` لمنع إعادة معالجة نفس الحدث عند
 * إعادة الإرسال). القيود الأمنية (التهدئة/نافذة الوصول/الرصيد المتبقي) واحدة
 * في الحالتين — الفرق الوحيد بينهما هو شكل تحديد الحجز (bookingCode+qrCode
 * مقابل معرّف الحجز في الـ URL) وحقل idempotencyKey الإضافي.
 */
export async function runCheckInAction(params: {
  booking: BookingWithLogs;
  action: "CHECK_IN" | "CHECK_OUT";
  performedById?: string;
  idempotencyKey?: string;
}): Promise<CheckInResult> {
  const { booking, action, performedById, idempotencyKey } = params;

  // (0) مفتاح التكرار: إن أُرسِل وسبق استخدامه فعلاً، هذا استدعاء مكرر (Replay) —
  // يُرفض كتعارض دون إعادة معالجة الإجراء أو إنشاء سجل جديد.
  if (idempotencyKey) {
    const existing = await prisma.checkInLog.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        status: 409,
        body: { error: "تم استلام حدث تسجيل الحضور/الانصراف هذا مسبقاً — لن تتم إعادة معالجته" },
      };
    }
  }

  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
    return {
      status: 422,
      body: { error: "هذا الحجز ملغى أو مسجَّل كعدم حضور — لا يمكن تنفيذ الإجراء" },
    };
  }

  const now = new Date();
  const lastLog = booking.checkInLogs[0];

  if (lastLog && lastLog.action === action) {
    const minutesSinceLast = differenceInMinutes(now, lastLog.timestamp);
    if (minutesSinceLast < DUPLICATE_ACTION_COOLDOWN_MINUTES) {
      await logFailedAttempt(
        booking.id,
        action,
        performedById,
        `محاولة تكرار الإجراء خلال أقل من ${DUPLICATE_ACTION_COOLDOWN_MINUTES} دقائق`
      );
      return {
        status: 429,
        body: {
          error: `تم تنفيذ هذا الإجراء مؤخراً — يرجى الانتظار ${
            DUPLICATE_ACTION_COOLDOWN_MINUTES - minutesSinceLast
          } دقيقة قبل إعادة المحاولة`,
        },
      };
    }
  }

  if (action === "CHECK_IN") {
    if (booking.status === "CHECKED_IN") {
      await logFailedAttempt(booking.id, action, performedById, "تسجيل حضور مكرر لحجز نشط بالفعل");
      return { status: 409, body: { error: "تم تسجيل الحضور مسبقاً لهذا الحجز" } };
    }

    const isFirstEverCheckIn = !booking.checkInLogs.some((l) => l.action === "CHECK_IN" && l.success);

    if (isFirstEverCheckIn) {
      const { windowStart, windowEnd } = checkInWindow(booking.startTime);
      if (now < windowStart || now > windowEnd) {
        await logFailedAttempt(
          booking.id,
          action,
          performedById,
          "خارج النافذة الزمنية المسموح بها لتسجيل الحضور"
        );
        return {
          status: 422,
          body: { error: "لا يمكن تسجيل الحضور الآن — يُسمح بالوصول قبل موعد الحجز أو بعده بـ 30 دقيقة فقط" },
        };
      }
    } else if (now > booking.endTime) {
      await logFailedAttempt(booking.id, action, performedById, "انتهت صلاحية الحجز الزمنية");
      return { status: 422, body: { error: "انتهت صلاحية هذا الحجز — لا يمكن تسجيل الحضور مجدداً" } };
    }

    const remainingBudgetMs = computeRemainingBudgetMs(booking);
    if (remainingBudgetMs <= 0) {
      await logFailedAttempt(booking.id, action, performedById, "تم استهلاك كامل وقت الحجز");
      return { status: 422, body: { error: "تم استهلاك كامل الوقت المدفوع لهذا الحجز" } };
    }

    const bufferEndsAt = addSeconds(now, ARRIVAL_BUFFER_SECONDS);
    const actualStartTime = bufferEndsAt;
    const expectedEndTime = new Date(actualStartTime.getTime() + remainingBudgetMs);

    const [, updatedBooking] = await prisma.$transaction([
      prisma.checkInLog.create({
        data: {
          bookingId: booking.id,
          action: "CHECK_IN",
          performedById,
          success: true,
          bufferEndsAt,
          actualStartTime,
          expectedEndTime,
          idempotencyKey,
        },
      }),
      prisma.booking.update({
        where: { id: booking.id },
        data: { status: "CHECKED_IN" },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
      }),
    ]);

    return {
      status: 200,
      body: {
        booking: serializeBooking(updatedBooking),
        message: `تم تسجيل الحضور بنجاح — مهلة الوصول للمقعد ${ARRIVAL_BUFFER_SECONDS} ثانية قبل بدء احتساب الوقت`,
      },
    };
  }

  // action === CHECK_OUT
  if (booking.status !== "CHECKED_IN") {
    await logFailedAttempt(booking.id, action, performedById, "محاولة تسجيل انصراف بدون تسجيل حضور مسبق");
    return { status: 409, body: { error: "لا يمكن تسجيل الانصراف قبل تسجيل الحضور أولاً" } };
  }

  const [, updatedBooking] = await prisma.$transaction([
    prisma.checkInLog.create({
      data: { bookingId: booking.id, action: "CHECK_OUT", performedById, success: true, idempotencyKey },
    }),
    prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CHECKED_OUT" },
      include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
    }),
  ]);

  return { status: 200, body: { booking: serializeBooking(updatedBooking), message: "تم تسجيل الانصراف بنجاح" } };
}

import { prisma } from "@/lib/prisma";
import { checkInWindow, DUPLICATE_ACTION_COOLDOWN_MINUTES } from "@/lib/pricing";
import { ARRIVAL_BUFFER_SECONDS, computeRemainingBudgetMs, isResumableBookingType } from "@/lib/attendance";
import { serializeBooking } from "@/lib/serialize-booking";
import { getSeatCountForSpace } from "@/lib/floor-map-config";
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

    // الباقات القصيرة (ساعة/4 ساعات/يومي) غير قابلة للاستئناف — بمجرد تسجيل
    // الانصراف مرة واحدة يُغلَق الحجز نهائياً (يُؤرشَف)، على عكس الباقات الشهرية
    // التي يمكن العودة إليها عبر جلسات متعددة حتى نفاد الرصيد الكلي.
    if (booking.status === "CHECKED_OUT" && !isResumableBookingType(booking.bookingType)) {
      await logFailedAttempt(booking.id, action, performedById, "الحجز مغلق نهائياً بعد الانصراف (باقة قصيرة غير قابلة للاستئناف)");
      return {
        status: 422,
        body: { error: "انتهت هذه الجلسة بتسجيل الانصراف — هذا النوع من الحجوزات لا يُستأنف بعد الانصراف" },
      };
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

    const updatedBooking = await prisma.$transaction(async (tx) => {
      // تسكين تلقائي فوري على الخريطة عند تسجيل الحضور — بدون أي تدخل يدوي من
      // الريسبشن ودون أي تأخير: يتم داخل نفس معاملة تسجيل الحضور مباشرة، فيظهر
      // المقعد مشغولاً فور نجاح العملية. يُطبَّق فقط على المساحات متعددة المقاعد
      // (مساحة العمل المشتركة/الثنائية) وفقط إن لم يكن الحجز مخصَّصاً لمقعد أصلاً.
      let seatIndex = booking.seatIndex;
      if (seatIndex === null) {
        const totalSeats = getSeatCountForSpace(booking.space.slug);
        if (totalSeats !== null) {
          const takenBookings = await tx.booking.findMany({
            where: {
              spaceId: booking.spaceId,
              id: { not: booking.id },
              seatIndex: { not: null },
              status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
              startTime: { lt: booking.endTime },
              endTime: { gt: booking.startTime },
            },
            select: { seatIndex: true },
          });
          const taken = new Set(takenBookings.map((b) => b.seatIndex));
          for (let i = 0; i < totalSeats; i++) {
            if (!taken.has(i)) {
              seatIndex = i;
              break;
            }
          }
        }
      }

      await tx.checkInLog.create({
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
      });

      return tx.booking.update({
        where: { id: booking.id },
        data: { status: "CHECKED_IN", ...(seatIndex !== booking.seatIndex ? { seatIndex } : {}) },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
      });
    });

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

  // الباقات القصيرة تُغلَق نهائياً عند الانصراف — يتحرر مقعدها تلقائياً على
  // الخريطة فوراً بما إنها لن تُستأنف أبداً. الباقات الشهرية تبقي مقعدها محجوزاً
  // بين الجلسات (الموظف يقدر يحرره يدوياً من لوحة إدارة المقعد إن احتاج).
  const shouldFreeSeat = !isResumableBookingType(booking.bookingType) && booking.seatIndex !== null;

  const [, updatedBooking] = await prisma.$transaction([
    prisma.checkInLog.create({
      data: { bookingId: booking.id, action: "CHECK_OUT", performedById, success: true, idempotencyKey },
    }),
    prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CHECKED_OUT", ...(shouldFreeSeat ? { seatIndex: null } : {}) },
      include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
    }),
  ]);

  return { status: 200, body: { booking: serializeBooking(updatedBooking), message: "تم تسجيل الانصراف بنجاح" } };
}

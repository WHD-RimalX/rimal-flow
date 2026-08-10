import { prisma } from "@/lib/prisma";
import { checkInWindow } from "@/lib/pricing";
import { ARRIVAL_BUFFER_SECONDS, computeRemainingBudgetMs, isResumableBookingType } from "@/lib/attendance";
import { serializeBooking } from "@/lib/serialize-booking";
import { getSeatCountForSpace } from "@/lib/floor-map-config";
import { recordStatusTransition } from "@/lib/booking-state-machine";
import { addSeconds } from "date-fns";
import type { Booking, CheckInLog, Prisma, Space } from "@prisma/client";

type BookingWithLogs = Booking & { checkInLogs: CheckInLog[]; space: Space };
type Tx = Prisma.TransactionClient;

export interface CheckInResult {
  status: number;
  body: Record<string, unknown>;
}

interface RunParams {
  booking: BookingWithLogs;
  action: "CHECK_IN" | "CHECK_OUT";
  performedById?: string;
  performedByLabel?: string;
  idempotencyKey?: string;
}

async function logFailedAttempt(
  tx: Tx,
  bookingId: string,
  action: "CHECK_IN" | "CHECK_OUT",
  performedById: string | undefined,
  reason: string
) {
  await tx.checkInLog.create({
    data: { bookingId, action, performedById, success: false, failureReason: reason },
  });
}

/** استثناء داخلي فقط: يُرمى ويُلتقَط عند فشل compare-and-swap — ليس جزءاً من واجهة الخطأ العامة. */
class StaleStateError extends Error {}

/**
 * المحرك المشترك لتسجيل الحضور/الانصراف — يستخدمه كل من `/api/checkin` (مسار
 * الماسح الذاتي عبر QR للعملاء) و`/api/bookings/:id/check-in` (المسار الرسمي
 * حسب عقد التكامل §10، يدعم `idempotencyKey` لمنع إعادة معالجة نفس الحدث عند
 * إعادة الإرسال) و`/api/integrations/attendance-events` (محول الربط الموقَّع).
 * القيود الأمنية (نافذة الوصول/الرصيد المتبقي/حالة الحجز) واحدة في كل الحالات.
 *
 * تصحيح أمني (SECURITY-AUDIT.md §2/§3، FLOW-X01/FLOW-C03): كانت الكتابة النهائية
 * `update` غير مشروطة بمعرّف الحجز فقط، فخمس طلبات CHECK_IN متزامنة كلها تنجح
 * وتُنشئ خمسة سجلات حضور ناجحة رغم أن الحالة النهائية للحجز واحدة فقط. الآن كل
 * كتابة حالة هي `updateMany` بشرط الحالة المتوقَّعة (compare-and-swap) — إن غيّر
 * طلب متزامن آخر الحالة بين قراءتنا وكتابتنا، count يكون 0 ونرفض صراحة كتعارض
 * بدل "التحديث الأخير يفوز" بصمت. كذلك أُضيف تحقق صريح من حالة المصدر (CHECK_IN
 * لا يُقبل إلا من CONFIRMED، أو من CHECKED_OUT فقط للباقات القابلة للاستئناف) —
 * سابقاً PENDING أو REJECTED كانا يمرّان لو نجح فحص النافذة الزمنية فقط.
 *
 * SECURITY-AUDIT(V2).md §1 (FLOW-C04): التسكين التلقائي للمقعد كان يفحص المقاعد
 * المشغولة بلا قفل صف المساحة — تسجيلا حضور متزامنان لحجزين مختلفين بلا مقعد
 * محدَّد سلفاً يقدران يختاران نفس المقعد الفارغ معاً. الآن يُقفل صف المساحة أولاً
 * (`FOR UPDATE`) في بداية كل معاملة — نفس ترتيب القفل المستخدَم في كل مسارات
 * الحجز الأخرى (المساحة أولاً، ثم الحجز) — قبل أي فحص أو كتابة.
 *
 * SECURITY-AUDIT(V2).md §4 (FLOW-C09): محرك الحضور كان يفتح معاملته الخاصة
 * دائماً، فتعذّر على مسار التكامل ضم "مطالبة الحدث + المعالجة + حفظ النتيجة" في
 * معاملة واحدة ذرية. `performCheckInAction` أدناه تفترض معاملة مفتوحة سلفاً
 * (لا تفتح واحدة بنفسها)؛ `runCheckInAction` (الواجهة العامة الحالية) تفتح
 * معاملتها الخاصة كما كانت، و`runCheckInActionInTx` الجديدة تشارك معاملة الطرف
 * المستدعي — يستخدمها مسار /api/integrations/attendance-events حصراً.
 */
async function performCheckInAction(tx: Tx, params: RunParams): Promise<CheckInResult> {
  const { booking, action, performedById, performedByLabel, idempotencyKey } = params;

  // قفل صف المساحة أولاً — ترتيب قفل موحَّد (مساحة ثم حجز) عبر كل مسارات الحجز
  // والحضور، لتفادي التعارض والـ deadlock بين مسارات مختلفة تقفل بترتيب مختلف.
  await tx.$queryRaw`SELECT "id" FROM "spaces" WHERE "id" = ${booking.spaceId} FOR UPDATE`;

  // (0) مفتاح التكرار: إن أُرسِل وسبق استخدامه فعلاً، هذا استدعاء مكرر (Replay) —
  // يُرفض كتعارض دون إعادة معالجة الإجراء أو إنشاء سجل جديد.
  if (idempotencyKey) {
    const existing = await tx.checkInLog.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        status: 409,
        body: { error: "تم استلام حدث تسجيل الحضور/الانصراف هذا مسبقاً — لن تتم إعادة معالجته" },
      };
    }
  }

  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW" || booking.status === "REJECTED") {
    return {
      status: 422,
      body: { error: "هذا الحجز ملغى أو مرفوض أو مسجَّل كعدم حضور — لا يمكن تنفيذ الإجراء" },
    };
  }

  const now = new Date();
  const resumable = isResumableBookingType(booking.bookingType);

  // ملاحظة: أُزيلت مهلة التهدئة (كانت 3 دقائق) بين تكرار نفس الإجراء عمداً —
  // بطلب صريح لأغراض العرض التوضيحي (السماح بمسح نفس الحساب أكثر من مرة متتالية
  // بلا انتظار). القيود الأخرى (نافذة الوصول، الرصيد المتبقي، حالة الحجز) تبقى فعّالة.

  if (action === "CHECK_IN") {
    if (booking.status === "CHECKED_IN") {
      await logFailedAttempt(tx, booking.id, action, performedById, "تسجيل حضور مكرر لحجز نشط بالفعل");
      return { status: 409, body: { error: "تم تسجيل الحضور مسبقاً لهذا الحجز" } };
    }

    // حالات المصدر المسموحة لتسجيل الحضور: CONFIRMED (أول حضور)، أو CHECKED_OUT
    // فقط للباقات القابلة للاستئناف (عودة لجلسة لاحقة ضمن اشتراك شهري). PENDING
    // (لم يُؤكَّد بعد) وREJECTED مرفوضان صراحة الآن.
    const validOrigin = booking.status === "CONFIRMED" || (booking.status === "CHECKED_OUT" && resumable);
    if (!validOrigin) {
      await logFailedAttempt(tx, booking.id, action, performedById, `محاولة تسجيل حضور من حالة غير صالحة: ${booking.status}`);
      return {
        status: 422,
        body: { error: "لا يمكن تسجيل الحضور — الحجز يجب أن يكون مؤكَّداً أولاً (أو منصرفاً لباقة شهرية قابلة للاستئناف)" },
      };
    }

    const isFirstEverCheckIn = !booking.checkInLogs.some((l) => l.action === "CHECK_IN" && l.success);

    if (isFirstEverCheckIn) {
      const { windowStart, windowEnd } = checkInWindow(booking.startTime);
      if (now < windowStart || now > windowEnd) {
        await logFailedAttempt(tx, booking.id, action, performedById, "خارج النافذة الزمنية المسموح بها لتسجيل الحضور");
        return {
          status: 422,
          body: { error: "لا يمكن تسجيل الحضور الآن — يُسمح بالوصول قبل موعد الحجز أو بعده بـ 30 دقيقة فقط" },
        };
      }
    } else if (now > booking.endTime) {
      await logFailedAttempt(tx, booking.id, action, performedById, "انتهت صلاحية الحجز الزمنية");
      return { status: 422, body: { error: "انتهت صلاحية هذا الحجز — لا يمكن تسجيل الحضور مجدداً" } };
    }

    const remainingBudgetMs = computeRemainingBudgetMs(booking);
    if (remainingBudgetMs <= 0) {
      await logFailedAttempt(tx, booking.id, action, performedById, "تم استهلاك كامل وقت الحجز");
      return { status: 422, body: { error: "تم استهلاك كامل الوقت المدفوع لهذا الحجز" } };
    }

    const bufferEndsAt = addSeconds(now, ARRIVAL_BUFFER_SECONDS);
    const actualStartTime = bufferEndsAt;
    const expectedEndTime = new Date(actualStartTime.getTime() + remainingBudgetMs);

    try {
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

      // كتابة الحالة الذرية: compare-and-swap بشرط أن تكون الحالة الحالية لا تزال
      // كما رأيناها (booking.status) — يمنع نجاح طلبات متزامنة متعددة معاً.
      const moved = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: { status: "CHECKED_IN", ...(seatIndex !== booking.seatIndex ? { seatIndex } : {}) },
      });
      if (moved.count !== 1) {
        throw new StaleStateError();
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

      await recordStatusTransition({
        tx,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "CHECKED_IN",
        actorId: performedById,
        actorLabel: performedByLabel ?? (performedById ? undefined : "SELF_SERVICE_QR"),
      });

      const updatedBooking = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
      });

      return {
        status: 200,
        body: {
          booking: serializeBooking(updatedBooking),
          message: `تم تسجيل الحضور بنجاح — مهلة الوصول للمقعد ${ARRIVAL_BUFFER_SECONDS} ثانية قبل بدء احتساب الوقت`,
        },
      };
    } catch (error) {
      if (error instanceof StaleStateError) {
        await logFailedAttempt(tx, booking.id, action, performedById, "تعارض تزامن: تغيّرت حالة الحجز أثناء المعالجة");
        return { status: 409, body: { error: "تعارض: تغيّرت حالة الحجز أثناء المعالجة — أعد المحاولة" } };
      }
      throw error;
    }
  }

  // action === CHECK_OUT
  if (booking.status !== "CHECKED_IN") {
    await logFailedAttempt(tx, booking.id, action, performedById, "محاولة تسجيل انصراف بدون تسجيل حضور مسبق");
    return { status: 409, body: { error: "لا يمكن تسجيل الانصراف قبل تسجيل الحضور أولاً" } };
  }

  // الباقات القصيرة تُغلَق نهائياً عند الانصراف — يتحرر مقعدها تلقائياً على
  // الخريطة فوراً بما إنها لن تُستأنف أبداً. الباقات الشهرية تبقي مقعدها محجوزاً
  // بين الجلسات (الموظف يقدر يحرره يدوياً من لوحة إدارة المقعد إن احتاج).
  const shouldFreeSeat = !resumable && booking.seatIndex !== null;

  try {
    const moved = await tx.booking.updateMany({
      where: { id: booking.id, status: "CHECKED_IN" },
      data: { status: "CHECKED_OUT", ...(shouldFreeSeat ? { seatIndex: null } : {}) },
    });
    if (moved.count !== 1) {
      throw new StaleStateError();
    }

    await tx.checkInLog.create({
      data: { bookingId: booking.id, action: "CHECK_OUT", performedById, success: true, idempotencyKey },
    });

    await recordStatusTransition({
      tx,
      bookingId: booking.id,
      fromStatus: "CHECKED_IN",
      toStatus: "CHECKED_OUT",
      actorId: performedById,
      actorLabel: performedByLabel ?? (performedById ? undefined : "SELF_SERVICE_QR"),
    });

    const updatedBooking = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { space: true, checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 } },
    });

    return { status: 200, body: { booking: serializeBooking(updatedBooking), message: "تم تسجيل الانصراف بنجاح" } };
  } catch (error) {
    if (error instanceof StaleStateError) {
      await logFailedAttempt(tx, booking.id, action, performedById, "تعارض تزامن: تغيّرت حالة الحجز أثناء المعالجة");
      return { status: 409, body: { error: "تعارض: تغيّرت حالة الحجز أثناء المعالجة — أعد المحاولة" } };
    }
    throw error;
  }
}

/** الواجهة العامة القائمة — تفتح معاملتها الخاصة. تستخدمها /api/checkin و/api/bookings/:id/check-in. */
export async function runCheckInAction(params: RunParams): Promise<CheckInResult> {
  return prisma.$transaction((tx) => performCheckInAction(tx, params));
}

/**
 * تشارك معاملة الطرف المستدعي بدل فتح واحدة جديدة — يستخدمها حصراً
 * /api/integrations/attendance-events حتى تصبح "مطالبة الحدث + المعالجة + حفظ
 * النتيجة" ذرية بالكامل (SECURITY-AUDIT(V2).md §4، FLOW-C09).
 */
export async function runCheckInActionInTx(tx: Tx, params: RunParams): Promise<CheckInResult> {
  return performCheckInAction(tx, params);
}

/**
 * انصراف تلقائي نظامي لحجز نُسي انصرافه (المصالحة الكسولة — booking-lifecycle.ts).
 * ليست ضمن ALLOWED_ADMIN_TRANSITIONS (CHECKED_IN → CHECKED_OUT ممنوعة عمداً على
 * المسار الإداري العام) لأنها تحتاج بالضبط ما تفعله هذه الدالة: سجل CheckInLog
 * مرافق وتحرير المقعد — نفس ما يفعله محرك الحضور التفاعلي، لكن بدون فحوصات
 * نافذة الوصول/الرصيد (غير منطقية لحدث نظامي بأثر رجعي على حجز من يوم سابق).
 * best-effort: تُعيد بصمت إن كان الحجز تغيّر مسبقاً (سباق مع تحويل آخر) — ستُعاد
 * محاولته في المرة القادمة التي تُستدعى فيها المصالحة إن كان لا يزال مؤهَّلاً.
 */
export async function applySystemCheckout(bookingId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.status !== "CHECKED_IN") return;

    const resumable = isResumableBookingType(booking.bookingType);
    const shouldFreeSeat = !resumable && booking.seatIndex !== null;

    const moved = await tx.booking.updateMany({
      where: { id: bookingId, status: "CHECKED_IN" },
      data: { status: "CHECKED_OUT", ...(shouldFreeSeat ? { seatIndex: null } : {}) },
    });
    if (moved.count !== 1) return;

    await tx.checkInLog.create({
      data: { bookingId, action: "CHECK_OUT", success: true },
    });

    await recordStatusTransition({
      tx,
      bookingId,
      fromStatus: "CHECKED_IN",
      toStatus: "CHECKED_OUT",
      actorLabel: "SYSTEM_LIFECYCLE",
      reason: "انصراف تلقائي: لم يُسجَّل انصراف العميل يدوياً، والحجز من يوم سابق",
    });
  });
}

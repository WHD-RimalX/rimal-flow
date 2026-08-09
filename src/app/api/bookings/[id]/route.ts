import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateSeatAssignmentSchema } from "@/validations/booking";
import { handleApiError } from "@/lib/api-response";
import { requireSession, requireStaffSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { serializeBooking } from "@/lib/serialize-booking";
import { reconcileExpiredBookings } from "@/lib/booking-lifecycle";
import { assertValidAdminTransition, recordStatusTransition, InvalidTransitionError } from "@/lib/booking-state-machine";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    await reconcileExpiredBookings();

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: {
        space: true,
        user: { select: { id: true, name: true, phone: true, email: true } },
        checkInLogs: { orderBy: { timestamp: "desc" } },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    const isOwner = booking.userId === session.user.id;
    const staff = session.user.role !== "USER";
    if (!isOwner && !staff) {
      return NextResponse.json({ error: "لا تملك صلاحية عرض هذا الحجز" }, { status: 403 });
    }

    return NextResponse.json(serializeBooking(booking));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * تعيين/إلغاء تعيين مقعد مرئي على الخريطة (seatIndex) فقط — لموظفي رمال فلو فقط.
 * تحويلات حالة الحجز (status) انتقلت بالكامل إلى PATCH /api/admin/bookings/:id
 * (عقد التكامل §10) — أي محاولة لتغيير status من هنا تُرفض صراحةً، حتى لو كان
 * المستدعي موظفاً، لتفادي أي لبس بين المسارين.
 *
 * SECURITY-AUDIT.md §1 (FLOW-C04): فحص إشغال المقعد كان `findFirst → update`
 * منفصلَين (TOCTOU) — الآن مقفول ضمن معاملة تقفل صف المساحة أولاً (نفس نمط
 * POST /api/bookings) فيصبح الفحص والكتابة ذريَّين معاً.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireStaffSession();
    const body = await req.json();

    if (body && typeof body === "object" && "status" in body) {
      throw new ForbiddenError(
        "تغيير حالة الحجز غير مسموح من هذا المسار — استخدم PATCH /api/admin/bookings/:id"
      );
    }

    const data = updateSeatAssignmentSchema.parse({ ...body, bookingId: params.id });

    const booking = await prisma.booking.findUnique({ where: { id: params.id } });
    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // إن كان هذا تخصيصاً لمقعد مرئي (غير null)، تحقّق أنه غير مشغول بحجز آخر
      // متداخل زمنياً — مقفول بصف المساحة أولاً لمنع سباق تزامن بين طلبَي تخصيص.
      if (data.seatIndex !== null) {
        await tx.$queryRaw`SELECT "id" FROM "spaces" WHERE "id" = ${booking.spaceId} FOR UPDATE`;

        const seatTaken = await tx.booking.findFirst({
          where: {
            id: { not: booking.id },
            spaceId: booking.spaceId,
            seatIndex: data.seatIndex,
            status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
            startTime: { lt: booking.endTime },
            endTime: { gt: booking.startTime },
          },
        });
        if (seatTaken) {
          throw new SeatTakenError();
        }
      }

      return tx.booking.update({
        where: { id: params.id },
        data: { seatIndex: data.seatIndex },
        include: { space: true },
      });
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    if (error instanceof SeatTakenError) {
      return NextResponse.json({ error: "هذا المقعد مشغول بالفعل بحجز آخر في هذا التوقيت" }, { status: 409 });
    }
    return handleApiError(error);
  }
}

class SeatTakenError extends Error {}

/**
 * إلغاء ذاتي: صاحب الحجز يلغي حجزه الخاص فقط — لا يتطلب صلاحية canCancelBooking
 * الإدارية (تلك محجوزة لإلغاء أي حجز عبر DELETE /api/admin/bookings/:id). محاولة
 * إلغاء حجز لا يملكه المستدعي تُرفض بـ403 بصرف النظر عن هوية الحجز (لا كشف IDOR).
 *
 * SECURITY-AUDIT.md §3 (FLOW-C03): كان الفحص الوحيد "ليس ملغى بالفعل" — حجز
 * منصرف (CHECKED_OUT) أو لم يحضر (NO_SHOW) أو مرفوض (REJECTED) كان يقبل الإلغاء
 * الذاتي رغم كونه في حالة نهائية. الآن يمر عبر نفس خريطة الانتقالات المركزية
 * (CANCELLED غير قابل للوصول إلا من PENDING/CONFIRMED/CHECKED_IN) بكتابة ذرية
 * مشروطة بالحالة المتوقَّعة.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const booking = await prisma.booking.findUnique({ where: { id: params.id } });
    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    const isOwner = booking.userId === session.user.id;
    if (!isOwner) {
      return NextResponse.json({ error: "لا تملك صلاحية إلغاء هذا الحجز" }, { status: 403 });
    }

    assertValidAdminTransition(booking.status, "CANCELLED");

    const updated = await prisma.$transaction(async (tx) => {
      const moved = await tx.booking.updateMany({
        where: { id: params.id, status: booking.status },
        data: { status: "CANCELLED" },
      });
      if (moved.count !== 1) {
        throw new InvalidTransitionError(booking.status, "CANCELLED");
      }

      await recordStatusTransition({
        tx,
        bookingId: params.id,
        fromStatus: booking.status,
        toStatus: "CANCELLED",
        actorId: session.user.id,
        reason: "إلغاء ذاتي من العميل",
      });

      return tx.booking.findUniqueOrThrow({ where: { id: params.id }, include: { space: true } });
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

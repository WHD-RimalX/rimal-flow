import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateSeatAssignmentSchema } from "@/validations/booking";
import { handleApiError } from "@/lib/api-response";
import { requireSession, requireStaffSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { serializeBooking } from "@/lib/serialize-booking";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

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

    // إن كان هذا تخصيصاً لمقعد مرئي (غير null)، تحقّق أنه غير مشغول بحجز آخر متداخل زمنياً
    if (data.seatIndex !== null) {
      const seatTaken = await prisma.booking.findFirst({
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
        return NextResponse.json({ error: "هذا المقعد مشغول بالفعل بحجز آخر في هذا التوقيت" }, { status: 409 });
      }
    }

    const updated = await prisma.booking.update({
      where: { id: params.id },
      data: { seatIndex: data.seatIndex },
      include: { space: true },
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * إلغاء ذاتي: صاحب الحجز يلغي حجزه الخاص فقط — لا يتطلب صلاحية canCancelBooking
 * الإدارية (تلك محجوزة لإلغاء أي حجز عبر DELETE /api/admin/bookings/:id). محاولة
 * إلغاء حجز لا يملكه المستدعي تُرفض بـ403 بصرف النظر عن هوية الحجز (لا كشف IDOR).
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

    if (booking.status === "CANCELLED") {
      return NextResponse.json({ error: "هذا الحجز ملغى بالفعل" }, { status: 409 });
    }

    const updated = await prisma.booking.update({
      where: { id: params.id },
      data: { status: "CANCELLED" },
      include: { space: true },
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

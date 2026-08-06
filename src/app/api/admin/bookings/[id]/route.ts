import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateBookingStatusSchema } from "@/validations/booking";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { assertPermission } from "@/lib/rbac";
import { serializeBooking } from "@/lib/serialize-booking";

/**
 * تحويل حالة الحجز (تأكيد/عدم حضور/انصراف/إلغاء) و/أو تخصيص مقعده — لموظفي رمال
 * فلو فقط (عقد التكامل §10: هذا هو المسار الإداري المنفصل عن PATCH /api/bookings/:id
 * العام الذي يقتصر الآن على تخصيص المقعد فقط دون تغيير الحالة).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireStaffSession();
    const body = await req.json();
    const data = updateBookingStatusSchema.parse({ ...body, bookingId: params.id });

    const booking = await prisma.booking.findUnique({ where: { id: params.id } });
    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    if (data.status === "CANCELLED" || data.status === "REJECTED") {
      assertPermission(session.user, "canCancelBooking");
    }

    if (data.seatIndex !== undefined && data.seatIndex !== null) {
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
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.seatIndex !== undefined ? { seatIndex: data.seatIndex } : {}),
        notes:
          data.reason && data.status
            ? `${booking.notes ?? ""}\n[${data.status}] ${data.reason}`.trim()
            : booking.notes,
      },
      include: { space: true },
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * إلغاء أي حجز بصرف النظر عن مالكه — يتطلب صلاحية canCancelBooking إدارية
 * (ADMIN/SUPER_ADMIN فقط، وليست RECEPTION) بجانب كون المستدعي موظفاً أصلاً.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireStaffSession();
    assertPermission(session.user, "canCancelBooking");

    const booking = await prisma.booking.findUnique({ where: { id: params.id } });
    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
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

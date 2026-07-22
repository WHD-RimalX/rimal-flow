import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateBookingStatusSchema } from "@/validations/booking";
import { handleApiError } from "@/lib/api-response";
import { requireSession, requireStaffSession } from "@/lib/session";
import { assertPermission } from "@/lib/rbac";

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

    return NextResponse.json({ booking });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * تحديث حجز — إما حالته (تأكيد، إلغاء، تسجيل عدم حضور...) و/أو تخصيص مقعده
 * المرئي على الخريطة (seatIndex). لموظفي رمال فلو فقط.
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

    if (data.status === "CANCELLED") {
      assertPermission(session.user, "canCancelBooking");
    }

    // إن كان هذا تخصيصاً لمقعد مرئي (غير null)، تحقّق أنه غير مشغول بحجز آخر متداخل زمنياً
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

    return NextResponse.json({ booking: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

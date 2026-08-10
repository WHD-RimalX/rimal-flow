import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateBookingStatusSchema } from "@/validations/booking";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { assertPermission } from "@/lib/rbac";
import { serializeBooking } from "@/lib/serialize-booking";
import { applyAdminTransition } from "@/lib/booking-state-machine";

class SeatTakenError extends Error {}

/**
 * تحويل حالة الحجز (تأكيد/عدم حضور/انصراف/إلغاء) و/أو تخصيص مقعده — لموظفي رمال
 * فلو فقط (عقد التكامل §10: هذا هو المسار الإداري المنفصل عن PATCH /api/bookings/:id
 * العام الذي يقتصر الآن على تخصيص المقعد فقط دون تغيير الحالة).
 *
 * SECURITY-AUDIT.md §3 (FLOW-C03): كان أي موظف يقدر يضبط أي status بصرف النظر
 * عن الحالة الحالية (PENDING → CHECKED_OUT مباشرة بلا حضور فعلي، أو إحياء حجز
 * منتهٍ CANCELLED/NO_SHOW/REJECTED → CONFIRMED). كل تحويل الآن يمر عبر آلة الحالة
 * المركزية (src/lib/booking-state-machine.ts): يتحقق من صحة الانتقال، يطبّقه
 * بكتابة ذرية مشروطة بالحالة المتوقَّعة، ويسجّله في سجل تدقيق ثابت. CHECKED_IN/
 * CHECKED_OUT مُستبعَدان عمداً من هذا المسار — يمران فقط عبر محرك الحضور
 * (checkin-core.ts) الذي يُنشئ سجلات CheckInLog المرافقة الضرورية.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireStaffSession();
    const body = await req.json();
    const data = updateBookingStatusSchema.parse({ ...body, bookingId: params.id });

    if (data.status === "CHECKED_IN" || data.status === "CHECKED_OUT") {
      return NextResponse.json(
        { error: "لا يمكن ضبط هذه الحالة مباشرة — استخدم محرك تسجيل الحضور (/api/checkin)" },
        { status: 400 }
      );
    }

    if (data.status === "CANCELLED" || data.status === "REJECTED") {
      assertPermission(session.user, "canCancelBooking");
    }

    let updated = await prisma.booking.findUnique({ where: { id: params.id }, include: { space: true } });
    if (!updated) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    if (data.status) {
      updated = await applyAdminTransition({
        bookingId: params.id,
        toStatus: data.status,
        actorId: session.user.id,
        actorLabel: session.user.name ?? session.user.email ?? undefined,
        reason: data.reason,
      });
    }

    if (data.seatIndex !== undefined) {
      const seatIndex = data.seatIndex;
      updated = await prisma.$transaction(async (tx) => {
        // SECURITY-AUDIT(V2).md §1 (FLOW-C04): كان الفحص "findFirst" والكتابة
        // "update" عمليتين منفصلتين بلا قفل هنا تحديداً (بخلاف مسار PATCH
        // /api/bookings/:id العام الذي كان مقفولاً بالفعل) — إداريان متزامنان
        // يقدران يخصّصان نفس المقعد معاً. نفس نمط قفل صف المساحة أولاً قبل
        // الفحص والكتابة، ضمن نفس المعاملة، لتوحيد ترتيب القفل عبر كل المسارات.
        if (seatIndex !== null) {
          await tx.$queryRaw`SELECT "id" FROM "spaces" WHERE "id" = ${updated!.spaceId} FOR UPDATE`;

          const seatTaken = await tx.booking.findFirst({
            where: {
              id: { not: updated!.id },
              spaceId: updated!.spaceId,
              seatIndex,
              status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
              startTime: { lt: updated!.endTime },
              endTime: { gt: updated!.startTime },
            },
          });
          if (seatTaken) {
            throw new SeatTakenError();
          }
        }

        return tx.booking.update({
          where: { id: params.id },
          data: { seatIndex },
          include: { space: true },
        });
      });
    }

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    if (error instanceof SeatTakenError) {
      return NextResponse.json({ error: "هذا المقعد مشغول بالفعل بحجز آخر في هذا التوقيت" }, { status: 409 });
    }
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

    const updated = await applyAdminTransition({
      bookingId: params.id,
      toStatus: "CANCELLED",
      actorId: session.user.id,
      actorLabel: session.user.name ?? session.user.email ?? undefined,
    });

    return NextResponse.json(serializeBooking(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

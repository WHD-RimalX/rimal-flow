import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { serializeBooking } from "@/lib/serialize-booking";
import { z } from "zod";

const lookupSchema = z
  .object({
    qrToken: z.string().trim().min(1).optional(),
    bookingCode: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.qrToken || data.bookingCode), {
    message: "يجب توفير رمز QR الخاص بالحجز أو كود الحجز",
  });

/**
 * بحث للاستقبال فقط عن حجز (عبر رمز QR الخاص به أو كوده) لعرض تفاصيله قبل
 * تنفيذ إجراء الحضور/الانصراف الفعلي — قراءة فقط، لا يُغيّر أي حالة.
 */
export async function POST(req: NextRequest) {
  try {
    await requireStaffSession();
    const body = await req.json();
    const data = lookupSchema.parse(body);

    const booking = await prisma.booking.findUnique({
      where: data.qrToken ? { qrToken: data.qrToken } : { bookingCode: data.bookingCode! },
      include: {
        space: true,
        user: { select: { id: true, name: true, phone: true, email: true } },
        checkInLogs: { orderBy: { timestamp: "desc" }, take: 10 },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الرمز" }, { status: 404 });
    }

    return NextResponse.json({ booking: serializeBooking(booking) });
  } catch (error) {
    return handleApiError(error);
  }
}

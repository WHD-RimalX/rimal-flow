import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { serializeBooking } from "@/lib/serialize-booking";
import { reconcileExpiredBookings } from "@/lib/booking-lifecycle";
import { z } from "zod";

/**
 * بحث قراءة فقط عن حجز — يقبل رمز QR الخاص بالحجز أو كوده أو رقم جوال العميل.
 * لا يغيّر أي حالة ولا يستهلك أي رمز، فهو مجرّد معاينة يعرضها الاستقبال قبل
 * تنفيذ إجراء الحضور/الانصراف الفعلي عبر POST /api/checkin.
 */
const lookupSchema = z
  .object({
    qrToken: z.string().trim().min(1, "تعذّرت قراءة رمز QR — قرّب الكاميرا وأعد المسح").optional(),
    bookingCode: z.string().trim().min(1, "كود الحجز مطلوب").optional(),
    // بحث برقم الجوال — لضيوف walk-in بلا حساب ولا رمز QR (لم يُثبَّت التطبيق لديهم).
    // يُعيد أنسب حجز نشط مطابق لهذا الرقم (حجز العميل المسجَّل أو حجز الضيف).
    phone: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.qrToken || data.bookingCode || data.phone), {
    message: "يجب مسح رمز QR الخاص بالحجز أو إدخال كود الحجز أو رقم الجوال",
  });

const bookingInclude = {
  space: true,
  user: { select: { id: true, name: true, phone: true, email: true } },
  checkInLogs: { orderBy: { timestamp: "desc" as const }, take: 10 },
};

/**
 * بحث للاستقبال فقط عن حجز (عبر رمز QR الخاص به أو كوده أو رقم جوال العميل/الضيف)
 * لعرض تفاصيله قبل تنفيذ إجراء الحضور/الانصراف الفعلي — قراءة فقط، لا يُغيّر أي حالة.
 */
export async function POST(req: NextRequest) {
  try {
    await requireStaffSession();
    await reconcileExpiredBookings();
    const body = await req.json();
    const data = lookupSchema.parse(body);

    if (data.phone) {
      const phoneQuery = data.phone.replace(/[\s-]/g, "");
      const candidates = await prisma.booking.findMany({
        where: {
          status: { in: ["CHECKED_IN", "CONFIRMED", "PENDING"] },
          OR: [{ guestPhone: phoneQuery }, { user: { phone: phoneQuery } }],
        },
        include: bookingInclude,
        orderBy: { startTime: "desc" },
      });

      if (candidates.length === 0) {
        return NextResponse.json({ error: "لم يتم العثور على حجز نشط بهذا الرقم" }, { status: 404 });
      }
      // أنسب حجز عند تعدد المطابقات: نُفضّل الحاضر الآن، ثم المؤكد، ثم بانتظار
      // التأكيد — والأحدث زمنياً عند تعادل الحالة (مرتَّب مسبقاً من الاستعلام).
      const priority: Record<string, number> = { CHECKED_IN: 0, CONFIRMED: 1, PENDING: 2 };
      const booking = candidates.sort((a, b) => priority[a.status] - priority[b.status])[0];
      return NextResponse.json({ booking: serializeBooking(booking) });
    }

    const booking = await prisma.booking.findUnique({
      where: data.qrToken ? { qrToken: data.qrToken } : { bookingCode: data.bookingCode! },
      include: bookingInclude,
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الرمز" }, { status: 404 });
    }

    return NextResponse.json({ booking: serializeBooking(booking) });
  } catch (error) {
    return handleApiError(error);
  }
}

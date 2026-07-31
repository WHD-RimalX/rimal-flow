import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInRequestSchema } from "@/validations/checkin";
import { runCheckInAction } from "@/lib/checkin-core";
import { handleApiError } from "@/lib/api-response";
import { getAuthSession } from "@/lib/session";

/**
 * محرك تسجيل الحضور/الانصراف عبر QR — رمال فلو (مسار الماسح الذاتي للعملاء).
 * القيود الأمنية الفعلية (تهدئة/نافذة وصول/رصيد متبقٍ) موثَّقة ومطبَّقة في
 * `src/lib/checkin-core.ts` المشترك مع `/api/bookings/:id/check-in`. هذا المسار
 * يضيف فوقها تحقّق رمز QR الخاص بالمقر (غير مطلوب من المسار الرسمي البديل).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await req.json();
    const data = checkInRequestSchema.parse(body);

    const venueQrCode = process.env.NEXT_PUBLIC_VENUE_QR_CODE ?? "RIMALX-HQ-MAIN-BRANCH-0001";
    if (data.qrCode !== venueQrCode) {
      return NextResponse.json(
        { error: "رمز QR غير صالح — يرجى المسح من نقطة الاستقبال المعتمدة" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { bookingCode: data.bookingCode },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الكود" }, { status: 404 });
    }

    const result = await runCheckInAction({
      booking,
      action: data.action,
      performedById: session?.user?.id,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
}

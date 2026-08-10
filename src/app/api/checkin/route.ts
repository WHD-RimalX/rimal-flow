import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInRequestSchema } from "@/validations/checkin";
import { runCheckInAction } from "@/lib/checkin-core";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { assertPermission } from "@/lib/rbac";

/**
 * محرك تسجيل الحضور/الانصراف — رمال فلو (مسار ماسح الاستقبال، لموظفي رمال فلو
 * فقط الآن). كل حجز له رمز QR خاص به (`qrToken`) يصل إليه العميل من حسابه؛
 * الماسح يبحث عن الحجز بهذا الرمز مباشرة (أو بكود الحجز يدوياً إن تعطّلت
 * الكاميرا). القيود الأمنية الفعلية (تهدئة/نافذة وصول/رصيد متبقٍ) موثَّقة
 * ومطبَّقة في `src/lib/checkin-core.ts` المشترك مع `/api/bookings/:id/check-in`.
 *
 * SECURITY-AUDIT.md §5 (FLOW-C07/C08): كان requireStaffSession وحده كافياً —
 * موظف مُهيَّأ صراحةً بـ`canCheckIn:false` (تخصيص فردي فوق دوره الافتراضي) كان
 * يقدر يسجّل حضوراً/انصرافاً رغم ذلك. الآن يُفرض canCheckIn/canCheckOut فعلياً.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireStaffSession();
    const body = await req.json();
    const data = checkInRequestSchema.parse(body);

    assertPermission(session.user, data.action === "CHECK_IN" ? "canCheckIn" : "canCheckOut");

    const booking = await prisma.booking.findUnique({
      where: data.qrToken ? { qrToken: data.qrToken } : { bookingCode: data.bookingCode! },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الرمز" }, { status: 404 });
    }

    const result = await runCheckInAction({
      booking,
      action: data.action,
      performedById: session.user.id,
      performedByLabel: session.user.name ?? session.user.email ?? undefined,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
}

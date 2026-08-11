import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireSession } from "@/lib/session";
import { isStaff } from "@/lib/rbac";
import { isBookingQrUsable } from "@/lib/attendance";
import { issueScanToken, SCAN_TOKEN_TTL_SECONDS } from "@/lib/scan-token";

/**
 * يُصدر رمز مسح مؤقت (Rotating QR) لهذا الحجز — SECURITY-AUDIT.V2.md §2.
 *
 * صاحب الحجز فقط (أو موظف) يقدر يطلبه، وشاشة العميل تُحدّثه تلقائياً قبل انتهاء
 * صلاحيته بقليل. كل إصدار يُبطل الإصدار السابق فوراً، والرمز يُستهلَك عند أول
 * مسح ناجح — فلا قيمة لأي لقطة شاشة بعد ثوانٍ.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, status: true, bookingType: true, startTime: true, endTime: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "الحجز غير موجود" }, { status: 404 });
    }

    // العميل يطلب رمز حجزه هو فقط — الموظفون مستثنون لأنهم قد يحتاجون توليده
    // نيابةً عن ضيف بلا تطبيق على شاشة الاستقبال نفسها.
    if (!isStaff(session.user.role) && booking.userId !== session.user.id) {
      return NextResponse.json({ error: "لا تملك صلاحية طلب رمز لهذا الحجز" }, { status: 403 });
    }

    // نفس شرط ظهور الرمز في الواجهة — لا نُصدر رمزاً لحجز ملغى أو مرفوض أو
    // انتهى يومه، حتى لا يوجد رمز صالح لحجز لن يُقبل مسحه أصلاً.
    if (!isBookingQrUsable(booking)) {
      return NextResponse.json(
        { error: "لا يمكن إصدار رمز مسح لهذا الحجز — انتهى أو أُلغي" },
        { status: 422 }
      );
    }

    const { token, expiresAt } = await issueScanToken(booking.id);

    return NextResponse.json({
      scanToken: token,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: SCAN_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInRequestSchema } from "@/validations/checkin";
import { runCheckInAction } from "@/lib/checkin-core";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";
import { assertPermission } from "@/lib/rbac";
import { consumeScanToken, ScanTokenError } from "@/lib/scan-token";
import { deriveNextCheckAction } from "@/lib/attendance";

/**
 * محرك تسجيل الحضور/الانصراف — مسار ماسح الاستقبال (لموظفي رمال فلو فقط).
 *
 * مسار المسح (scanToken): الرمز مؤقت ومتجدد في شاشة العميل، يُستهلَك ذرياً عند
 * أول مسح، و**الإجراء يُستنتَج من حالة الحجز على الخادم** لا من جسم الطلب:
 * أول مسح للجلسة = تسجيل دخول، والمسح التالي = تسجيل خروج (أو إيقاف مؤقت
 * للعدّاد في الباقات الشهرية القابلة للاستئناف). بهذا يستحيل على أي طرف أن
 * يفرض ترتيباً مخالفاً أو يكرر نفس الإجراء.
 *
 * مسار الإدخال اليدوي (bookingCode): للحالات التي لا كاميرا فيها أو ضيف بلا
 * تطبيق — الموظف يتحقق من الهوية شخصياً ويحدد الإجراء صراحةً.
 *
 * SECURITY-AUDIT.md §5 (FLOW-C07/C08): يُفرض canCheckIn/canCheckOut فعلياً على
 * الإجراء الناتج مهما كان مصدره.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireStaffSession();
    const body = await req.json();
    const data = checkInRequestSchema.parse(body);

    let bookingId: string;
    let action: "CHECK_IN" | "CHECK_OUT";

    if (data.scanToken || data.qrToken) {
      if (data.scanToken) {
        // رمز مؤقت: يُستهلَك ذرياً — أي إعادة إرسال بعد هذه اللحظة تُرفض.
        bookingId = await consumeScanToken(data.scanToken);
      } else {
        // رمز الحجز الثابت — أُعيد قبوله بطلب صريح لضمان عمل العرض التقديمي.
        // لا يُستهلَك، فيبقى صالحاً لكل مسح لاحق (دخول ثم خروج) وأيضاً لأي
        // لقطة شاشة منه — وهو الأثر الأمني المعروف والمقبول مؤقتاً هنا.
        const found = await prisma.booking.findUnique({
          where: { qrToken: data.qrToken! },
          select: { id: true },
        });
        if (!found) {
          return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الرمز" }, { status: 404 });
        }
        bookingId = found.id;
      }

      const current = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true, bookingType: true },
      });

      // الإجراء يبقى مستنتَجاً من حالة الحجز على الخادم في الحالتين: أول مسح
      // دخول، والتالي خروج — فلا يمكن لأي طرف فرض ترتيب مخالف.
      const nextAction = deriveNextCheckAction(current);
      if (!nextAction) {
        return NextResponse.json(
          { error: "لا يوجد إجراء متاح لهذا الحجز في حالته الحالية" },
          { status: 422 }
        );
      }
      action = nextAction;
    } else {
      const found = await prisma.booking.findUnique({
        where: { bookingCode: data.bookingCode! },
        select: { id: true },
      });
      if (!found) {
        return NextResponse.json({ error: "لم يتم العثور على حجز بهذا الكود" }, { status: 404 });
      }
      bookingId = found.id;
      action = data.action!;
    }

    assertPermission(session.user, action === "CHECK_IN" ? "canCheckIn" : "canCheckOut");

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    const result = await runCheckInAction({
      booking,
      action,
      performedById: session.user.id,
      performedByLabel: session.user.name ?? session.user.email ?? undefined,
    });

    return NextResponse.json({ ...result.body, action }, { status: result.status });
  } catch (error) {
    if (error instanceof ScanTokenError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return handleApiError(error);
  }
}

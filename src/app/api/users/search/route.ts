import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";

// يمنع محاولة توليد هذا المسار بشكل ثابت أثناء البناء
export const dynamic = "force-dynamic";

/**
 * بحث فوري عن العملاء المسجَّلين بالاسم أو رقم الجوال — لموظفي رمال فلو فقط.
 * يُستخدم في تخصيص الحجز اليدوي من خريطة المقر (اختيار عميل حقيقي بدل إدخال يدوي).
 *
 * البحث غير حساس لحالة الأحرف (mode: insensitive) ولا للمسافات/الشرطات داخل رقم
 * الجوال (يُطبَّع الاستعلام بإزالتها قبل المطابقة، لأن أرقام الجوال في قاعدة
 * البيانات مخزَّنة دوماً بدون فواصل — انظر تحقق regex في validations/auth.ts).
 */
export async function GET(req: NextRequest) {
  try {
    await requireStaffSession();

    const rawQuery = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (rawQuery.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // تطبيع للاسم: ضغط المسافات المتكررة إلى مسافة واحدة
    const nameQuery = rawQuery.replace(/\s+/g, " ");
    // تطبيع لرقم الجوال: إزالة كل المسافات والشرطات
    const phoneQuery = rawQuery.replace(/[\s-]/g, "");

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: nameQuery, mode: "insensitive" } },
          ...(phoneQuery ? [{ phone: { contains: phoneQuery, mode: "insensitive" as const } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, email: true, isStudent: true, role: true },
      take: 8,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}

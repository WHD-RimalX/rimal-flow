import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { requireStaffSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * قائمة العملاء المسجَّلين بحساب حقيقي (role=USER فقط — لا تشمل الموظفين) —
 * للموظفين فقط، تُستخدم في صفحة "العملاء المسجَّلون" الإدارية. تدعم بحثاً
 * اختيارياً بالاسم/الجوال/البريد بنفس منطق /api/users/search.
 */
export async function GET(req: NextRequest) {
  try {
    await requireStaffSession();

    const rawQuery = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const nameQuery = rawQuery.replace(/\s+/g, " ");
    const phoneQuery = rawQuery.replace(/[\s-]/g, "");

    const customers = await prisma.user.findMany({
      where: {
        role: "USER",
        ...(rawQuery
          ? {
              OR: [
                { name: { contains: nameQuery, mode: "insensitive" } },
                { phone: { contains: phoneQuery, mode: "insensitive" } },
                { email: { contains: rawQuery, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, phone: true, email: true, isStudent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ customers });
  } catch (error) {
    return handleApiError(error);
  }
}

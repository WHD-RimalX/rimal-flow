import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";

// يمنع Next من محاولة توليد هذا المسار بشكل ثابت أثناء البناء (يتطلب اتصالاً حياً بقاعدة البيانات)
export const dynamic = "force-dynamic";

/** قائمة عامة بكل المساحات المتاحة وأسعارها — تُستخدم في صفحة الحجز العامة. */
export async function GET() {
  try {
    const spaces = await prisma.space.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ spaces });
  } catch (error) {
    return handleApiError(error);
  }
}

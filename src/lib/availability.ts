import { prisma } from "@/lib/prisma";
import { Prisma, Space } from "@prisma/client";

export class ConflictError extends Error {}

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"] as const;

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

/**
 * يتحقق من كشف التعارض بين الحجوزات: مساحة بها N وحدة (capacityUnits) يمكن أن
 * تستوعب حتى N حجز متداخل زمنياً في آنٍ واحد. عندما يتجاوز عدد الحجوزات
 * المتداخلة النشطة سعة المساحة، يُرفض الحجز الجديد لمنع الحجز المزدوج.
 *
 * معامل `db` الاختياري (SECURITY-AUDIT.md §1، FLOW-C04): يجب تمرير عميل معاملة
 * (`tx`) بعد قفل صف المساحة بـ `SELECT ... FOR UPDATE` حتى يصبح هذا الفحص جزءاً
 * ذرياً من عملية الحجز نفسها بدل قراءة منفصلة عرضة لسباق تزامن (TOCTOU) — استدعاؤه
 * بلا `db` (العميل العام غير المقفل) يبقى مفيداً فقط لعروض توافر تقريبية للقراءة.
 */
export async function assertNoBookingConflict(
  space: Space,
  startTime: Date,
  endTime: Date,
  excludeBookingId?: string,
  db: PrismaClientOrTx = prisma
) {
  const overlappingCount = await db.booking.count({
    where: {
      spaceId: space.id,
      status: { in: [...ACTIVE_STATUSES] },
      id: excludeBookingId ? { not: excludeBookingId } : undefined,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
  });

  if (overlappingCount >= space.capacityUnits) {
    throw new ConflictError(
      `لا تتوفر مساحة "${space.name}" في هذا التوقيت — تم حجز كامل الطاقة الاستيعابية (${space.capacityUnits}).`
    );
  }
}

import { prisma } from "@/lib/prisma";
import { Space } from "@prisma/client";

export class ConflictError extends Error {}

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"] as const;

/**
 * يتحقق من كشف التعارض بين الحجوزات: مساحة بها N وحدة (capacityUnits) يمكن أن
 * تستوعب حتى N حجز متداخل زمنياً في آنٍ واحد. عندما يتجاوز عدد الحجوزات
 * المتداخلة النشطة سعة المساحة، يُرفض الحجز الجديد لمنع الحجز المزدوج.
 */
export async function assertNoBookingConflict(
  space: Space,
  startTime: Date,
  endTime: Date,
  excludeBookingId?: string
) {
  const overlappingCount = await prisma.booking.count({
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

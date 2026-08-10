import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALLOWED_ADMIN_TRANSITIONS } from "@/lib/booking-transitions";

/**
 * آلة حالة الحجز المركزية — SECURITY-AUDIT.md §3 (FLOW-C03).
 * قبل هذا الملف، كان أي مسار يقدر يضبط `status` لأي قيمة بصرف النظر عن الحالة
 * الحالية (PENDING → CHECKED_OUT مباشرة بلا تسجيل حضور، أو إحياء حجز منتهٍ من
 * CANCELLED/NO_SHOW/REJECTED). كل الانتقالات الآن تمر من هنا حصراً. خريطة
 * الانتقالات المسموحة نفسها في src/lib/booking-transitions.ts (بلا اعتماديات
 * خادم) لتستخدمها الواجهة أيضاً كمصدر حقيقة واحد لتعطيل/إخفاء إجراءات غير صالحة.
 *
 * CHECKED_IN/CHECKED_OUT مُستبعَدة عمداً من هذه الخريطة — لا يجوز ضبطها عبر
 * مسار عام؛ يجب أن تمر حصراً من محرك الحضور (checkin-core.ts) الذي يُنشئ سجل
 * CheckInLog المرافق (بدونه تفسد سجلات الحضور، تماماً كما وثّق التدقيق).
 */
export { ALLOWED_ADMIN_TRANSITIONS };

export class InvalidTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`لا يمكن تحويل الحجز من الحالة "${from}" إلى "${to}" — هذا الانتقال غير مسموح`);
    this.name = "InvalidTransitionError";
  }
}

export function assertValidAdminTransition(from: BookingStatus, to: BookingStatus) {
  if (!ALLOWED_ADMIN_TRANSITIONS[from]?.has(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

interface RecordTransitionParams {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorId?: string | null;
  actorLabel?: string;
  reason?: string | null;
}

/** يسجّل صفاً ثابتاً (immutable) في سجل تدقيق انتقالات الحالة — يُستدعى داخل نفس معاملة التحويل دائماً. */
export async function recordStatusTransition({
  tx,
  bookingId,
  fromStatus,
  toStatus,
  actorId,
  actorLabel,
  reason,
}: RecordTransitionParams) {
  await tx.bookingStatusHistory.create({
    data: {
      bookingId,
      fromStatus: fromStatus ?? undefined,
      toStatus,
      actorId: actorId ?? undefined,
      actorLabel,
      reason: reason ?? undefined,
    },
  });
}

/**
 * ينفّذ تحويل حالة إداري واحد بشكل ذري: يتحقق من صحة الانتقال، يطبّقه بمُسنِد
 * حالة متوقَّعة (updateMany بشرط status=from) بدل update غير المشروط — فإذا
 * غيّر طلب متزامن آخر الحالة بين القراءة والكتابة، count سيكون 0 ونرفض بوضوح
 * بدل الكتابة فوق تحديث لم نتوقّعه (نفس عيب "التحديث الأخير يفوز" الموثَّق في
 * التدقيق). يسجّل الانتقال في سجل التدقيق ضمن نفس المعاملة.
 */
export async function applyAdminTransition(params: {
  bookingId: string;
  toStatus: BookingStatus;
  actorId?: string | null;
  actorLabel?: string;
  reason?: string | null;
}) {
  const { bookingId, toStatus, actorId, actorLabel, reason } = params;

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new BookingNotFoundError();
    }

    assertValidAdminTransition(booking.status, toStatus);

    const result = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: {
        status: toStatus,
        notes: reason ? `${booking.notes ?? ""}\n[${toStatus}] ${reason}`.trim() : booking.notes,
      },
    });

    if (result.count !== 1) {
      // حالة سباق: طلب متزامن آخر غيّر الحالة بين القراءة والكتابة أعلاه.
      throw new InvalidTransitionError(booking.status, toStatus);
    }

    await recordStatusTransition({
      tx,
      bookingId,
      fromStatus: booking.status,
      toStatus,
      actorId,
      actorLabel,
      reason,
    });

    return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { space: true } });
  });
}

export class BookingNotFoundError extends Error {
  constructor() {
    super("الحجز غير موجود");
    this.name = "BookingNotFoundError";
  }
}

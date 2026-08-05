import { prisma } from "@/lib/prisma";
import { startOfDay } from "date-fns";

const SHORT_TYPES = ["HOURLY", "FOUR_HOUR", "DAILY"] as const;

/** مهلة السماح للتأكيد قبل الإلغاء التلقائي للحجز المعلَّق (بالدقائق). */
const PENDING_CONFIRM_GRACE_MINUTES = 5;

/**
 * تسوية كسولة (Lazy Reconciliation) لحالات الحجوزات المنتهية صلاحيتها — لا يوجد
 * Cron في المشروع، فبدلاً منه تُستدعى هذه الدالة في بداية كل مسار قراءة رئيسي
 * للحجوزات (GET /api/bookings، GET /api/bookings/:id، checkin/lookup،
 * dashboard/summary) فتُحدَّث أي حجوزات مستحقة قبل إعادة القراءة مباشرة.
 *
 * ثلاث قواعد:
 * 1) حجز PENDING بلا تأكيد خلال 5 دقائق من إنشائه → CANCELLED (كل الأنواع).
 * 2) باقة قصيرة (ساعة/4 ساعات/يومي) انتهت نافذتها الزمنية ولم يُسجَّل حضور
 *    فيها إطلاقاً → NO_SHOW (بدل بقائها معلَّقة للأبد).
 * 3) باقة قصيرة لا تزال CHECKED_IN لكن من يوم سابق (لم يُسجَّل انصرافها قط،
 *    والعميل غادر فعلياً دون تسجيل خروج) → انصراف ضمني تلقائي (CHECKED_OUT)
 *    مع تحرير مقعدها — بدل عدّاد تجاوز يستمر للأبد في حساب العميل.
 */
export async function reconcileExpiredBookings(): Promise<void> {
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_CONFIRM_GRACE_MINUTES * 60 * 1000);
  const todayStart = startOfDay(now);

  await Promise.all([
    prisma.booking.updateMany({
      where: { status: "PENDING", createdAt: { lt: pendingCutoff } },
      data: { status: "CANCELLED" },
    }),
    prisma.booking.updateMany({
      where: {
        status: { in: ["PENDING", "CONFIRMED"] },
        bookingType: { in: [...SHORT_TYPES] },
        endTime: { lt: now },
      },
      data: { status: "NO_SHOW" },
    }),
    prisma.booking.updateMany({
      where: {
        status: "CHECKED_IN",
        bookingType: { in: [...SHORT_TYPES] },
        startTime: { lt: todayStart },
      },
      data: { status: "CHECKED_OUT", seatIndex: null },
    }),
  ]);
}

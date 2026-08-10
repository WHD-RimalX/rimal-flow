import { prisma } from "@/lib/prisma";
import { startOfDay } from "date-fns";
import { AUTO_CANCEL_NOTE_MARKER } from "@/lib/attendance";
import { applyAdminTransition } from "@/lib/booking-state-machine";
import { applySystemCheckout } from "@/lib/checkin-core";

const SHORT_TYPES = ["HOURLY", "FOUR_HOUR", "DAILY"] as const;
const SYSTEM_ACTOR_LABEL = "SYSTEM_LIFECYCLE";

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
 * 2) باقة قصيرة (ساعة/4 ساعات/يومي) *مؤكَّدة* انتهت نافذتها الزمنية ولم يُسجَّل
 *    حضور فيها إطلاقاً → NO_SHOW (بدل بقائها معلَّقة للأبد).
 * 3) باقة قصيرة لا تزال CHECKED_IN لكن من يوم سابق (لم يُسجَّل انصرافها قط،
 *    والعميل غادر فعلياً دون تسجيل خروج) → انصراف ضمني تلقائي (CHECKED_OUT)
 *    مع تحرير مقعدها — بدل عدّاد تجاوز يستمر للأبد في حساب العميل.
 *
 * SECURITY-AUDIT(V2).md §3 (FLOW-C03): كانت القواعد الثلاث updateMany مباشرة
 * على prisma تتجاوز آلة الحالة المركزية تماماً — بلا تسجيل BookingStatusHistory،
 * وبلا CheckInLog للانصراف التلقائي (رقم 3)، وقاعدة رقم 2 كانت تشمل PENDING
 * أيضاً (`status: {in:["PENDING","CONFIRMED"]}`) وهو انتقال (PENDING→NO_SHOW)
 * غير موجود أصلاً في ALLOWED_ADMIN_TRANSITIONS، وكان يتسابق مع القاعدة الأولى
 * على نفس الصفوف (حجز PENDING قديم انتهى وقته يطابق الشرطين معاً، والعمليتان
 * تُنفَّذان بلا ترتيب مضمون عبر Promise.all فتُنتِج حالة نهائية غير حتمية).
 * الحل: قاعدة 2 مقتصرة على CONFIRMED فقط (الانتقال الوحيد المُعرَّف أصلاً في
 * الخريطة لـ NO_SHOW)، فتصبح مجموعتا القاعدتين 1 و2 متنافيتين بحكم الحالة نفسها
 * (لا تداخل ممكن)، وكل انتقال يمر الآن عبر applyAdminTransition/applySystemCheckout
 * (نفس آلة الحالة المستخدَمة في كل المسارات الأخرى) — تحقّق من صحة الانتقال،
 * كتابة ذرية مشروطة بالحالة المتوقَّعة، وتسجيل في booking_status_history ضمن
 * نفس المعاملة، لكل حجز على حدة (actorId=null، actorLabel="SYSTEM_LIFECYCLE").
 */
export async function reconcileExpiredBookings(): Promise<void> {
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_CONFIRM_GRACE_MINUTES * 60 * 1000);
  const todayStart = startOfDay(now);

  const [stalePending, missedConfirmed, forgottenCheckedIn] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "PENDING", createdAt: { lt: pendingCutoff } },
      select: { id: true },
    }),
    prisma.booking.findMany({
      where: { status: "CONFIRMED", bookingType: { in: [...SHORT_TYPES] }, endTime: { lt: now } },
      select: { id: true },
    }),
    prisma.booking.findMany({
      where: { status: "CHECKED_IN", bookingType: { in: [...SHORT_TYPES] }, startTime: { lt: todayStart } },
      select: { id: true },
    }),
  ]);

  for (const { id } of stalePending) {
    await applyAdminTransition({
      bookingId: id,
      toStatus: "CANCELLED",
      actorId: null,
      actorLabel: SYSTEM_ACTOR_LABEL,
      reason: `${AUTO_CANCEL_NOTE_MARKER} أُلغي تلقائياً لعدم تأكيد الحجز خلال ${PENDING_CONFIRM_GRACE_MINUTES} دقائق من إنشائه`,
    }).catch((error) => {
      // سباق مع تحويل آخر (متزامن أو حدث بين الفحص والتنفيذ) — تُعاد المحاولة
      // تلقائياً في المرة القادمة التي تُستدعى فيها المصالحة إن كان لا يزال مؤهَّلاً.
      console.error("[reconcileExpiredBookings] فشل إلغاء تلقائي لحجز", id, error);
    });
  }

  for (const { id } of missedConfirmed) {
    await applyAdminTransition({
      bookingId: id,
      toStatus: "NO_SHOW",
      actorId: null,
      actorLabel: SYSTEM_ACTOR_LABEL,
    }).catch((error) => {
      console.error("[reconcileExpiredBookings] فشل ضبط عدم حضور تلقائي لحجز", id, error);
    });
  }

  for (const { id } of forgottenCheckedIn) {
    await applySystemCheckout(id).catch((error) => {
      console.error("[reconcileExpiredBookings] فشل انصراف تلقائي لحجز", id, error);
    });
  }
}

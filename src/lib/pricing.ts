import { BookingType, Space } from "@prisma/client";
import { addDays, addHours, addMinutes } from "date-fns";
import { businessWindowFor, riyadhDayName, riyadhHourOnSameDay } from "@/lib/business-hours";

/**
 * محرك حساب الأسعار — يعمل حصراً على السيرفر.
 * لا يُقبل أي سعر أو خصم قادم من الـ Client إطلاقاً؛ يُعاد احتسابه هنا من بيانات
 * المساحة المخزّنة في قاعدة البيانات في كل مرة.
 */

export class PricingError extends Error {}

export interface PriceBreakdown {
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  studentDiscountRate: number;
}

/** نافذة الدوام الصباحي/المسائي للاشتراكات الشهرية (بالساعة 24): 8ص–3م و3م–10م. */
export const MONTHLY_MORNING_WINDOW = { startHour: 8, endHour: 15 };
export const MONTHLY_EVENING_WINDOW = { startHour: 15, endHour: 22 };

/** ساعات الوصول المسموحة قبل/بعد وقت الحجز عند تسجيل الحضور (بالدقائق). */
export const CHECK_IN_GRACE_MINUTES_BEFORE = 30;
export const CHECK_IN_GRACE_MINUTES_AFTER = 30;

function unitPriceFor(space: Space, bookingType: BookingType): number | null {
  switch (bookingType) {
    case "HOURLY":
      return space.hourlyPrice ? Number(space.hourlyPrice) : null;
    case "FOUR_HOUR":
      return space.fourHourPrice ? Number(space.fourHourPrice) : null;
    case "DAILY":
      return space.dailyPrice ? Number(space.dailyPrice) : null;
    case "MONTHLY_MORNING":
      return space.monthlyMorningPrice ? Number(space.monthlyMorningPrice) : null;
    case "MONTHLY_EVENING":
      return space.monthlyEveningPrice ? Number(space.monthlyEveningPrice) : null;
    default:
      return null;
  }
}

/** يحسب وقت الانتهاء بناءً على نوع الحجز ووقت البدء. `durationHours` يُستخدَم فقط مع HOURLY. */
export function computeEndTime(bookingType: BookingType, startTime: Date, durationHours?: number): Date {
  switch (bookingType) {
    case "HOURLY":
      return addHours(startTime, durationHours ?? 1);
    case "FOUR_HOUR":
      return addHours(startTime, 4);
    case "DAILY": {
      // الباقة اليومية = يوم دوام كامل من الافتتاح حتى الإغلاق، وليست مدة ثابتة:
      // 14 ساعة (8ص–10م) الأحد–الخميس، و13 ساعة (9ص–10م) السبت. تنتهي دائماً عند
      // ساعة إغلاق نفس اليوم مهما كانت ساعة البداية المسجَّلة.
      const window = businessWindowFor(startTime);
      if (!window) {
        throw new PricingError(`المقر مغلق يوم ${riyadhDayName(startTime)} — لا يمكن حجز باقة يومية فيه`);
      }
      return riyadhHourOnSameDay(startTime, window.closeHour);
    }
    case "MONTHLY_MORNING":
    case "MONTHLY_EVENING":
      return addDays(startTime, 30);
    default:
      throw new PricingError("نوع حجز غير مدعوم");
  }
}


/**
 * يتحقق من أن سعر الباقة المطلوبة متاح فعلياً لهذه المساحة، ويحسب السعر
 * النهائي بعد تطبيق خصم الطالب إن وُجد.
 */
export function calculatePrice(
  space: Space,
  bookingType: BookingType,
  isStudent: boolean,
  durationHours?: number
): PriceBreakdown {
  if (!space.isActive) {
    throw new PricingError("هذه المساحة غير متاحة للحجز حالياً");
  }

  const unitPrice = unitPriceFor(space, bookingType);
  if (unitPrice === null) {
    throw new PricingError("باقة السعر المطلوبة غير متاحة لهذه المساحة");
  }
  // مضاعفة السعر بعدد الساعات تنطبق فقط على باقة الساعة (HOURLY 1-3 ساعات)؛
  // بقية الباقات لها سعر ثابت بصرف النظر عن durationHours.
  const basePrice = bookingType === "HOURLY" ? unitPrice * (durationHours ?? 1) : unitPrice;

  const studentDiscountRate = isStudent ? Number(space.studentDiscount) : 0;
  const discountAmount = Math.round(basePrice * studentDiscountRate * 100) / 100;
  const finalPrice = Math.round((basePrice - discountAmount) * 100) / 100;

  return {
    basePrice,
    discountAmount,
    finalPrice,
    studentDiscountRate,
  };
}

/** نافذة السماح لتسجيل الحضور حول وقت بداية الحجز. */
export function checkInWindow(startTime: Date) {
  return {
    windowStart: addMinutes(startTime, -CHECK_IN_GRACE_MINUTES_BEFORE),
    windowEnd: addMinutes(startTime, CHECK_IN_GRACE_MINUTES_AFTER),
  };
}

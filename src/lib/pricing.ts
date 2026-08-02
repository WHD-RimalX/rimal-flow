import { BookingType, Space } from "@prisma/client";
import { addDays, addHours, addMinutes } from "date-fns";

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

/** نافذة الدوام الصباحي/المسائي للاشتراكات الشهرية (بالساعة 24). */
export const MONTHLY_MORNING_WINDOW = { startHour: 8, endHour: 16 };
export const MONTHLY_EVENING_WINDOW = { startHour: 16, endHour: 23 };

/** ساعات الوصول المسموحة قبل/بعد وقت الحجز عند تسجيل الحضور (بالدقائق). */
export const CHECK_IN_GRACE_MINUTES_BEFORE = 30;
export const CHECK_IN_GRACE_MINUTES_AFTER = 30;

/** حظر تكرار إجراء تسجيل الحضور/الانصراف خلال هذه المدة (مكافحة الاحتيال). */
export const DUPLICATE_ACTION_COOLDOWN_MINUTES = 3;

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

/** يحسب وقت الانتهاء بناءً على نوع الحجز ووقت البدء. */
export function computeEndTime(bookingType: BookingType, startTime: Date): Date {
  switch (bookingType) {
    case "HOURLY":
      return addHours(startTime, 1);
    case "FOUR_HOUR":
      return addHours(startTime, 4);
    case "DAILY":
      // الباقة اليومية 10 ساعات ضمن نفس اليوم — وليست 24 ساعة كاملة.
      return addHours(startTime, 10);
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
  isStudent: boolean
): PriceBreakdown {
  if (!space.isActive) {
    throw new PricingError("هذه المساحة غير متاحة للحجز حالياً");
  }

  const basePrice = unitPriceFor(space, bookingType);
  if (basePrice === null) {
    throw new PricingError("باقة السعر المطلوبة غير متاحة لهذه المساحة");
  }

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

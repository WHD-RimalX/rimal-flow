import type { BookingType, SpaceDTO } from "@/types";
import { businessWindowForDateKey, workingDayHoursForDateKey } from "@/lib/business-hours";

/**
 * الساعة الثابتة (بتوقيت الرياض) لبدء الحجوزات التي لا تحتاج اختيار وقت دقيق.
 * الباقة اليومية ليست هنا: بدايتها = ساعة افتتاح ذلك اليوم تحديداً (8ص أيام
 * الأسبوع، 9ص السبت) وتُحسب في `fixedStartHourForDate` أدناه.
 */
export const FIXED_START_HOUR: Partial<Record<BookingType, number>> = {
  MONTHLY_MORNING: 8,
  MONTHLY_EVENING: 15,
};

/** ساعة البداية الفعلية لنوع حجز لا يحتاج اختيار وقت، في يوم تقويمي معيّن. */
export function fixedStartHourForDate(bookingType: BookingType, dateKey: string): number | null {
  if (bookingType === "DAILY") {
    // الباقة اليومية = يوم دوام كامل، فتبدأ دائماً عند افتتاح ذلك اليوم.
    return businessWindowForDateKey(dateKey)?.openHour ?? null;
  }
  return FIXED_START_HOUR[bookingType] ?? null;
}

export function priceForType(space: SpaceDTO, type: BookingType): number | null {
  const map: Record<BookingType, string | null> = {
    HOURLY: space.hourlyPrice,
    FOUR_HOUR: space.fourHourPrice,
    DAILY: space.dailyPrice,
    MONTHLY_MORNING: space.monthlyMorningPrice,
    MONTHLY_EVENING: space.monthlyEveningPrice,
  };
  const value = map[type];
  return value ? Number(value) : null;
}

export function spaceImageUrl(space: SpaceDTO): string {
  return `/spaces/${space.slug}.jpg`;
}

/**
 * أقصى عدد ساعات يمكن اختياره لباقة الساعة — طول أطول يوم دوام (14 ساعة،
 * الأحد–الخميس 8ص–10م). السقف الفعلي لكل يوم يُشتق من ساعات دوامه في
 * `maxHourlyDurationForDate` أدناه، ويُعاد فرضه على الخادم في createBookingSchema.
 */
export const MAX_HOURLY_DURATION = 14;

/** أقصى مدة قابلة للحجز في يوم تقويمي معيّن (14 أيام الأسبوع، 13 السبت، 0 الجمعة). */
export function maxHourlyDurationForDate(dateKey: string): number {
  return workingDayHoursForDateKey(dateKey);
}

export function hourLabel(hours: number): string {
  if (hours === 1) return "ساعة";
  if (hours === 2) return "ساعتين";
  return `${hours} ساعات`;
}

export function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** يبني لحظة UTC من تاريخ (يوم فقط) وساعة بتوقيت الرياض الثابت (UTC+3، بلا توقيت صيفي). */
export function riyadhDateToIso(dateStr: string, riyadhHour: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, riyadhHour - 3, 0, 0)).toISOString();
}

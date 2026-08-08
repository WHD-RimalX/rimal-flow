import type { BookingType, SpaceDTO } from "@/types";

/** الساعة الثابتة (بتوقيت الرياض) لبدء الحجوزات التي لا تحتاج اختيار وقت دقيق (يومي/شهري). */
export const FIXED_START_HOUR: Partial<Record<BookingType, number>> = {
  DAILY: 9,
  MONTHLY_MORNING: 8,
  MONTHLY_EVENING: 16,
};

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

/** أقصى عدد ساعات يمكن اختياره لباقة الساعة — يطابق الحد الأقصى في createBookingSchema. */
export const MAX_HOURLY_DURATION = 10;

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

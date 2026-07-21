import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const arabicNumberFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

export function formatSAR(amount: number): string {
  return arabicNumberFormatter.format(amount);
}

const arabicDateTimeFormatter = new Intl.DateTimeFormat("ar-SA", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatArabicDateTime(date: Date | string): string {
  return arabicDateTimeFormatter.format(new Date(date));
}

export const BOOKING_TYPE_LABELS: Record<string, string> = {
  HOURLY: "ساعة",
  FOUR_HOUR: "4 ساعات",
  DAILY: "يومي",
  MONTHLY_MORNING: "شهري صباحي",
  MONTHLY_EVENING: "شهري مسائي",
};

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING: "بانتظار التأكيد",
  CONFIRMED: "مؤكد",
  CHECKED_IN: "حاضر الآن",
  CHECKED_OUT: "غادر",
  CANCELLED: "ملغى",
  NO_SHOW: "لم يحضر",
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-300",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-300",
  CHECKED_IN: "bg-emerald-100 text-emerald-800 border-emerald-300",
  CHECKED_OUT: "bg-gray-100 text-gray-600 border-gray-300",
  CANCELLED: "bg-red-100 text-red-700 border-red-300",
  NO_SHOW: "bg-rose-100 text-rose-800 border-rose-300",
};

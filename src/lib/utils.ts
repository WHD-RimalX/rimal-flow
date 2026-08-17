import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const arabicNumberFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatSAR(amount: number): string {
  return arabicNumberFormatter.format(amount);
}

/**
 * صيغة التاريخ الموحَّدة في كل التطبيق: dd/mm/yyyy ميلادي بأرقام لاتينية.
 *
 * سابقاً كان يُستخدَم `ar-SA` مع dateStyle، وهو يُخرِج التاريخ بالتقويم *الهجري*
 * وبترتيب مختلف عن المتوقَّع — فيظهر نفس الحجز بصيغ متباينة بين الشاشات. تثبيت
 * `en-GB` + `gregory` يضمن dd/mm/yyyy ميلادي واحد في كل مكان، والوقت يبقى عربياً
 * (ص/م). المنطقة الزمنية مثبَّتة على الرياض حتى لا يختلف العرض باختلاف جهاز العميل.
 */
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  calendar: "gregory",
  timeZone: "Asia/Riyadh",
});

// `-u-nu-latn` يفرض الأرقام اللاتينية مع إبقاء "ص/م" بالعربية — بدونه يخرج
// الوقت بأرقام هندية (٠٩:٠٠) بجانب تاريخ بأرقام لاتينية (09/09) في نفس السطر.
const timeFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Riyadh",
});

/** تاريخ فقط: 12/08/2026 */
export function formatDate(date: Date | string): string {
  return dateFormatter.format(new Date(date));
}

/** وقت فقط: 9:30 ص */
export function formatTime(date: Date | string): string {
  return timeFormatter.format(new Date(date));
}

/** تاريخ ووقت: 12/08/2026 — 9:30 ص */
export function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  return `${dateFormatter.format(d)} — ${timeFormatter.format(d)}`;
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
  REJECTED: "مرفوض",
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-300",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-300",
  CHECKED_IN: "bg-emerald-100 text-emerald-800 border-emerald-300",
  CHECKED_OUT: "bg-gray-100 text-gray-600 border-gray-300",
  CANCELLED: "bg-red-100 text-red-700 border-red-300",
  NO_SHOW: "bg-rose-100 text-rose-800 border-rose-300",
  REJECTED: "bg-red-200 text-red-800 border-red-400",
};

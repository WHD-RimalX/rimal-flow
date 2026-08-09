import type { BookingStatus } from "@/types";

/**
 * آلة حالة الحجز — خريطة الانتقالات المسموحة فقط (بلا أي اعتماديات خادم)، حتى
 * تُستخدَم من الواجهة أيضاً (تعطيل/إخفاء إجراءات غير صالحة) بنفس مصدر الحقيقة
 * المستخدَم فعلياً في src/lib/booking-state-machine.ts على الخادم. راجع هناك
 * تعليق SECURITY-AUDIT.md §3 (FLOW-C03) الكامل لسبب كل استبعاد.
 */
export const ALLOWED_ADMIN_TRANSITIONS: Record<BookingStatus, ReadonlySet<BookingStatus>> = {
  PENDING: new Set(["CONFIRMED", "REJECTED", "CANCELLED"]),
  CONFIRMED: new Set(["CANCELLED", "NO_SHOW"]),
  CHECKED_IN: new Set(["CANCELLED"]),
  CHECKED_OUT: new Set([]),
  CANCELLED: new Set([]),
  NO_SHOW: new Set([]),
  REJECTED: new Set([]),
};

export function isValidAdminTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_ADMIN_TRANSITIONS[from]?.has(to) === true;
}

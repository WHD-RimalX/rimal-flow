/**
 * يضيف الأسماء القياسية `startDate`/`endDate` (عقد التكامل §10) كحقلين إضافيين
 * بجانب `startTime`/`endTime` الداخليين الحاليين — دون حذفهما، حفاظاً على عمل كل
 * مكونات لوحة التحكم الحالية (BookingsTable، الخريطة التفاعلية، التقويم...) التي
 * ما زالت تقرأ `startTime`/`endTime` دون أي تعديل عليها.
 */
export function serializeBooking<T extends { startTime: Date | string; endTime: Date | string }>(
  booking: T
): T & { startDate: string; endDate: string } {
  const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
  return {
    ...booking,
    startDate: toIso(booking.startTime),
    endDate: toIso(booking.endTime),
  };
}

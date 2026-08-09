/**
 * يضيف الأسماء القياسية `startDate`/`endDate` (عقد التكامل §10) كحقلين إضافيين
 * بجانب `startTime`/`endTime` الداخليين الحاليين — دون حذفهما، حفاظاً على عمل كل
 * مكونات لوحة التحكم الحالية (BookingsTable، الخريطة التفاعلية، التقويم...) التي
 * ما زالت تقرأ `startTime`/`endTime` دون أي تعديل عليها.
 *
 * `omitQrToken` (SECURITY-AUDIT.md §5، FLOW-C07/C08): القوائم الجماعية للحجوزات
 * كانت تُعيد qrToken الدائم لكل حجز لكل موظف بصرف النظر عن دوره — موظف استقبال
 * يشاهد قائمة اليوم يقدر ينسخ رمز عميل لم يحضر بعد ويستخدمه هو بدلاً منه دون
 * حضور العميل فعلياً. الرمز ضروري فقط لمن يعرضه فعلياً (العميل نفسه) أو عند
 * البحث عن حجز واحد بعينه للتحقق منه — لا في قوائم جماعية.
 */
export function serializeBooking<T extends { startTime: Date | string; endTime: Date | string; qrToken?: string }>(
  booking: T,
  options?: { omitQrToken?: boolean }
): T & { startDate: string; endDate: string } {
  const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
  const base = {
    ...booking,
    startDate: toIso(booking.startTime),
    endDate: toIso(booking.endTime),
  };
  if (options?.omitQrToken) {
    return { ...base, qrToken: undefined };
  }
  return base;
}

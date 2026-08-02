import { z } from "zod";

export const checkActionEnum = z.enum(["CHECK_IN", "CHECK_OUT"]);

/**
 * كل حجز له رمز QR خاص به (`Booking.qrToken`) يُنشَأ تلقائياً ويصل إليه العميل
 * من حسابه — يحل محل رمز QR الثابت الواحد الذي كان يُستخدَم لكل العملاء سابقاً.
 * مسح رمز حجز فعلي يُرسِل `qrToken`؛ إدخال يدوي من الاستقبال (بدون كاميرا) يُرسِل
 * `bookingCode` مباشرة دون الحاجة لأي QR (الموظف يتحقق من الهوية شخصياً).
 */
export const checkInRequestSchema = z
  .object({
    qrToken: z.string().trim().min(1).optional(),
    bookingCode: z.string().trim().min(1).optional(),
    action: checkActionEnum,
  })
  .refine((data) => Boolean(data.qrToken || data.bookingCode), {
    message: "يجب توفير رمز QR الخاص بالحجز أو كود الحجز يدوياً",
    path: ["qrToken"],
  });

export type CheckInRequestInput = z.infer<typeof checkInRequestSchema>;

/**
 * جسم الطلب لمسار التكامل الرسمي `POST /api/bookings/:id/check-in` (عقد
 * التكامل §10) — يقبل `eventType` كاسم قياسي مرادف لـ `action`، بالإضافة إلى
 * `idempotencyKey` اختياري لمنع إعادة معالجة نفس حدث الحضور/الانصراف. لا يتطلب
 * qrCode (ذاك خاص بمسار المسح الذاتي `/api/checkin` فقط).
 */
export const bookingCheckInRequestSchema = z
  .object({
    eventType: checkActionEnum.optional(),
    action: checkActionEnum.optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .refine((data) => Boolean(data.eventType ?? data.action), {
    message: "يجب تحديد eventType أو action",
    path: ["eventType"],
  })
  .transform((data) => ({
    action: (data.eventType ?? data.action) as z.infer<typeof checkActionEnum>,
    idempotencyKey: data.idempotencyKey,
  }));

export type BookingCheckInRequestInput = z.infer<typeof bookingCheckInRequestSchema>;

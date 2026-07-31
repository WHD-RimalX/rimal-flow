import { z } from "zod";

export const checkActionEnum = z.enum(["CHECK_IN", "CHECK_OUT"]);

export const checkInRequestSchema = z.object({
  bookingCode: z.string().trim().min(1, "كود الحجز مطلوب"),
  action: checkActionEnum,
  qrCode: z.string().trim().min(1, "رمز QR غير صالح"),
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

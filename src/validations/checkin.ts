import { z } from "zod";

export const checkActionEnum = z.enum(["CHECK_IN", "CHECK_OUT"]);

export const checkInRequestSchema = z.object({
  bookingCode: z.string().trim().min(1, "كود الحجز مطلوب"),
  action: checkActionEnum,
  qrCode: z.string().trim().min(1, "رمز QR غير صالح"),
});

export type CheckInRequestInput = z.infer<typeof checkInRequestSchema>;

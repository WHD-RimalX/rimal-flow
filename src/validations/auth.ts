import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "الاسم قصير جداً").max(100),
  email: z.string().trim().email("بريد إلكتروني غير صالح — مثال صحيح: name@example.com"),
  phone: z
    .string()
    .trim()
    .regex(
      /^(05\d{8}|\+9665\d{8})$/,
      "رقم جوال غير صالح — مثال صحيح: 0512345678 أو +966512345678"
    ),
  password: z
    .string()
    .min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف")
    .regex(/[A-Za-z]/, "يجب أن تحتوي كلمة المرور على حرف واحد على الأقل")
    .regex(/[0-9]/, "يجب أن تحتوي كلمة المرور على رقم واحد على الأقل"),
  isStudent: z.boolean().default(false),
  studentIdNumber: z.string().trim().max(50).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

export type LoginInput = z.infer<typeof loginSchema>;

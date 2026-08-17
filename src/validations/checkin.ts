import { z } from "zod";

export const checkActionEnum = z.enum(["CHECK_IN", "CHECK_OUT"]);

/**
 * مساران لتسجيل الحضور/الانصراف من شاشة الاستقبال:
 *
 * 1) مسح رمز QR المتجدد (`scanToken`) — الطريق الافتراضي. الرمز مؤقت (ثوانٍ)،
 *    يُستهلَك عند أول مسح، و**الإجراء لا يُرسَل من العميل إطلاقاً**: الخادم هو من
 *    يستنتجه من حالة الحجز الحالية (أول مسح = دخول، والمسح التالي = خروج). هذا
 *    يمنع أي تلاعب بترتيب الجلسة من طرف المستدعي.
 * 2) إدخال يدوي بكود الحجز (`bookingCode`) عند تعطّل الكاميرا أو لضيف بلا تطبيق —
 *    هنا يُحدَّد الإجراء صراحةً لأن الموظف يتحقق من الهوية شخصياً.
 *
 * رمز `qrToken` الثابت لم يعد مقبولاً لتسجيل الحضور (كان صالحاً للأبد فينتحل به
 * أي شخص يملك لقطة شاشة قديمة) — راجع src/lib/scan-token.ts.
 */
export const checkInRequestSchema = z
  .object({
    // رسائل عربية صريحة على كل قاعدة: بدونها تُعيد Zod نصها الإنجليزي الافتراضي
    // ("String must contain at least 1 character(s)") وهو ما كان يظهر لموظف
    // الاستقبال حين تفشل قراءة رمز QR فيلتقط الماسح نصاً فارغاً.
    scanToken: z
      .string()
      .trim()
      .min(1, "تعذّرت قراءة رمز QR — قرّب الكاميرا وأعد المسح، أو أدخل كود الحجز يدوياً")
      .optional(),
    // رمز الحجز الثابت — أُعيد قبوله بطلب صريح لضمان عمل المسح في العرض
    // التقديمي (راجع التعليق في src/components/booking/RotatingQr.tsx).
    qrToken: z
      .string()
      .trim()
      .min(1, "تعذّرت قراءة رمز QR — قرّب الكاميرا وأعد المسح، أو أدخل كود الحجز يدوياً")
      .optional(),
    bookingCode: z.string().trim().min(1, "كود الحجز مطلوب").optional(),
    // مطلوب فقط مع المسار اليدوي؛ يُتجاهَل تماماً مع scanToken.
    action: checkActionEnum.optional(),
  })
  .refine((data) => Boolean(data.scanToken || data.qrToken || data.bookingCode), {
    message: "يجب مسح رمز QR الخاص بالحجز أو إدخال كود الحجز يدوياً",
    path: ["scanToken"],
  })
  .refine((data) => Boolean(data.scanToken || data.qrToken) || Boolean(data.action), {
    message: "يجب تحديد الإجراء (دخول/خروج) عند الإدخال اليدوي",
    path: ["action"],
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

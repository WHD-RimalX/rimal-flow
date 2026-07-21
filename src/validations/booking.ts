import { z } from "zod";

export const bookingTypeEnum = z.enum([
  "HOURLY",
  "FOUR_HOUR",
  "DAILY",
  "MONTHLY_MORNING",
  "MONTHLY_EVENING",
]);

export const bookingStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
]);

export type BookingStatusValue = z.infer<typeof bookingStatusEnum>;

/**
 * مخطط إنشاء حجز جديد.
 * ملاحظة أمنية هامة: لا يحتوي هذا المخطط على أي حقل للسعر — الأسعار تُحسب
 * حصراً على السيرفر عبر `calculatePrice()` ولا يُسمح للعميل بإرسالها.
 */
export const createBookingSchema = z
  .object({
    spaceId: z.string().min(1, "يجب اختيار المساحة"),
    bookingType: bookingTypeEnum,
    startTime: z.coerce.date({ errorMap: () => ({ message: "وقت بداية الحجز غير صالح" }) }),
    isStudent: z.boolean().default(false),
    studentIdNumber: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(500).optional(),

    // عميل مسجّل مُختار من نتائج البحث (يُستخدم عندما يحجز موظف الاستقبال لصالح
    // عميل موجود بالنظام من خريطة المقر أو لوحة التحكم)
    customerUserId: z.string().trim().min(1).optional(),

    // رقم المقعد المرئي (0-based) — يُملأ فقط عند التخصيص اليدوي من خريطة المقر؛
    // إشغال الخريطة يدوي بالكامل وليس مشتقاً تلقائياً من حالة الحجز.
    seatIndex: z.coerce.number().int().min(0).optional(),

    // بيانات حجز الضيف (اختيارية إن كان المستخدم مسجلاً دخوله أو تم اختيار customerUserId)
    guestName: z.string().trim().min(2, "الاسم قصير جداً").max(100).optional(),
    guestPhone: z
      .string()
      .trim()
      .regex(/^(05\d{8}|\+9665\d{8})$/, "رقم جوال غير صالح — مثال صحيح: 0512345678 أو +966512345678")
      .optional(),
    guestEmail: z.string().trim().email("بريد إلكتروني غير صالح — مثال صحيح: name@example.com").optional(),
  })
  .refine((data) => data.startTime.getTime() > Date.now() - 5 * 60 * 1000, {
    message: "لا يمكن إنشاء حجز في وقت ماضٍ",
    path: ["startTime"],
  })
  .refine(
    (data) =>
      !data.isStudent ||
      Boolean(data.customerUserId) ||
      (data.studentIdNumber && data.studentIdNumber.length > 0),
    {
      message: "يرجى إدخال الرقم الجامعي لتفعيل خصم الطلاب",
      path: ["studentIdNumber"],
    }
  );

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const guestContactRequiredSchema = z.object({
  guestName: z.string().trim().min(2, "الاسم قصير جداً"),
  guestPhone: z.string().trim().regex(/^(05\d{8}|\+9665\d{8})$/, "رقم جوال سعودي غير صالح"),
  guestEmail: z.string().trim().email("بريد إلكتروني غير صالح").optional(),
});

export const updateBookingStatusSchema = z.object({
  bookingId: z.string().min(1),
  status: bookingStatusEnum,
  reason: z.string().trim().max(500).optional(),
});

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

export const listBookingsQuerySchema = z.object({
  date: z.coerce.date().optional(),
  // قيمة واحدة أو عدة حالات مفصولة بفاصلة (مثال: "CHECKED_IN,CHECKED_OUT") — تُحلَّل عبر parseStatusFilter
  status: z.string().optional(),
  spaceId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // اختياريان — عند تمريرهما فقط تُطبَّق الصفحات؛ إن لم يُمرَّرا تُعاد كل النتائج
  // المطابقة كما هو معتاد (للتوافق مع التقويم والخريطة التفاعلية وغيرهما).
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

/** يحلّل باراميتر status (قيمة أو عدة قيم مفصولة بفاصلة) إلى مصفوفة حالات صالحة فقط. */
export function parseStatusFilter(raw: string | null | undefined): BookingStatusValue[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BookingStatusValue => bookingStatusEnum.options.includes(s as BookingStatusValue));
  return values.length ? values : undefined;
}

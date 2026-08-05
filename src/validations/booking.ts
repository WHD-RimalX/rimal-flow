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

/** أعلى عدد ضيوف معقول ضمن حجز واحد — بوابة تحقق أولية قبل أي فحص سعة خاص بالمساحة. */
const MAX_GUESTS_PER_BOOKING = 50;

/**
 * مخطط إنشاء حجز جديد.
 * ملاحظة أمنية هامة: لا يحتوي هذا المخطط على أي حقل للسعر — الأسعار تُحسب
 * حصراً على السيرفر عبر `calculatePrice()` ولا يُسمح للعميل بإرسالها.
 *
 * توافق مع عقد التكامل الرسمي (`API_CONTRACT.md` §10): يقبل `startDate` (الاسم
 * القياسي الخارجي) مع الإبقاء على قبول `startTime` كمرادف داخلي قديم عندما لا
 * يُرسَل `startDate` — تفادياً لكسر أي طرف نداء لم يُحدَّث بعد. حقلا `startTime`/
 * `endTime` بصيغة "HH:MM" (إن أُرسِلا مع `startDate`/`endDate` الكاملين) يُتجاهَلان
 * عمداً لأن `startDate`/`endDate` يحملان الدقة الزمنية الكاملة أصلاً. `bookingType`
 * يُقبَل بأي حالة أحرف (hourly/HOURLY) ويُطبَّع داخلياً لأحرف كبيرة.
 */
export const createBookingSchema = z
  .preprocess((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const normalized: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (normalized.startDate === undefined && normalized.startTime !== undefined) {
      normalized.startDate = normalized.startTime;
    }
    if (typeof normalized.bookingType === "string") {
      normalized.bookingType = normalized.bookingType.toUpperCase();
    }
    return normalized;
  }, z.object({
    spaceId: z.string().min(1, "يجب اختيار المساحة"),
    bookingType: bookingTypeEnum,
    startDate: z.coerce.date({ errorMap: () => ({ message: "وقت بداية الحجز غير صالح" }) }),
    // اختياري: للتحقق من صحة النطاق الزمني المُرسَل فقط (endDate > startDate) —
    // لا يُستخدم لحساب مدة الحجز الفعلية أو السعر؛ تلك تبقى محسوبة سيرفرياً من
    // bookingType حصراً حتى لو أرسل العميل نطاقاً زمنياً مختلفاً (دفاع في العمق).
    endDate: z.coerce.date({ errorMap: () => ({ message: "وقت نهاية الحجز غير صالح" }) }).optional(),
    guests: z.coerce.number().int().min(1).max(MAX_GUESTS_PER_BOOKING, "عدد الضيوف أكبر من الحد المسموح").optional(),
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
  }))
  .refine((data) => data.startDate.getTime() > Date.now() - 5 * 60 * 1000, {
    message: "لا يمكن إنشاء حجز في وقت ماضٍ",
    path: ["startDate"],
  })
  .refine(
    (data) => {
      // الاشتراكات الشهرية مستثناة — نافذتها الصباحية تبدأ 8 صباحاً (قبل حد
      // 9 صباحاً العام)، وهي أصلاً مقيَّدة بنافذتها الخاصة (8ص–4م / 4م–11م)
      // لا بساعات الدوام العامة المخصَّصة لحجوزات الوصول المباشر (الساعة/4
      // ساعات/يومي).
      if (data.bookingType === "MONTHLY_MORNING" || data.bookingType === "MONTHLY_EVENING") return true;
      // الرياض بتوقيت UTC+3 ثابت (بلا توقيت صيفي) — نحسب الساعة المحلية يدوياً
      // بدل الاعتماد على منطقة زمنية السيرفر (Vercel يشغّل UTC عادة).
      const riyadhHour = (data.startDate.getUTCHours() + 3) % 24;
      return riyadhHour >= 9 && riyadhHour < 23;
    },
    {
      message: "الحجز متاح فقط من الساعة 9 صباحاً حتى 11 مساءً بتوقيت الرياض",
      path: ["startDate"],
    }
  )
  .refine((data) => !data.endDate || data.endDate.getTime() > data.startDate.getTime(), {
    message: "وقت النهاية يجب أن يكون بعد وقت البداية",
    path: ["endDate"],
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

export const updateBookingStatusSchema = z
  .object({
    bookingId: z.string().min(1),
    status: bookingStatusEnum.optional(),
    reason: z.string().trim().max(500).optional(),
    // تعيين/إلغاء تعيين مقعد مرئي على الخريطة — منفصل عن حالة الحجز نفسها.
    // null تعني "أزل التخصيص عن الخريطة" دون التأثير على حالة الحجز.
    // ملاحظة مهمة: لا نستخدم z.coerce هنا عمداً — z.coerce.number() يحوّل
    // Number(null) إلى 0 بدل رفضه، مما كان يمنع إلغاء التخصيص فعلياً (يُسجَّل
    // seatIndex=0 خطأً بدل إزالته). القيمة تصل دائماً كرقم JS حقيقي أو null.
    seatIndex: z.union([z.number().int().min(0), z.null()]).optional(),
  })
  .refine((data) => data.status !== undefined || data.seatIndex !== undefined, {
    message: "يجب تمرير status أو seatIndex على الأقل",
  });

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

/**
 * تعيين/إلغاء تعيين المقعد المرئي فقط — تُستخدم في `PATCH /api/bookings/:id`
 * (المسار العام، للموظفين فقط أيضاً) بعد أن أصبحت تحويلات الحالة (status) حصراً
 * عبر `PATCH /api/admin/bookings/:id` توافقاً مع عقد التكامل §10.
 */
export const updateSeatAssignmentSchema = z.object({
  bookingId: z.string().min(1),
  seatIndex: z.union([z.number().int().min(0), z.null()]),
});

export type UpdateSeatAssignmentInput = z.infer<typeof updateSeatAssignmentSchema>;

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

/**
 * أنواع بيانات الواجهة — تعكس شكل الاستجابة القادمة من الـ API بعد تسلسل JSON
 * (حقول Decimal في Prisma تُسلسَل كنصوص، لذا نستخدم string | null هنا).
 */

export type BookingType =
  | "HOURLY"
  | "FOUR_HOUR"
  | "DAILY"
  | "MONTHLY_MORNING"
  | "MONTHLY_EVENING";

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "CANCELLED"
  | "NO_SHOW";

export interface SpaceDTO {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  capacityUnits: number;
  hourlyPrice: string | null;
  fourHourPrice: string | null;
  dailyPrice: string | null;
  monthlyMorningPrice: string | null;
  monthlyEveningPrice: string | null;
  studentDiscount: string;
  isActive: boolean;
}

export interface CheckInLogDTO {
  id: string;
  action: "CHECK_IN" | "CHECK_OUT";
  timestamp: string;
  success: boolean;
  failureReason: string | null;
  // مهلة الوصول (30 ثانية) والمؤقت الفعلي — تُملأ فقط لسجلات CHECK_IN الناجحة
  bufferEndsAt: string | null;
  actualStartTime: string | null;
  expectedEndTime: string | null;
}

export interface BookingDTO {
  id: string;
  bookingCode: string;
  /** رمز QR فريد خاص بهذا الحجز — يُعرض للعميل من حسابه ويُمسَح عند الاستقبال. */
  qrToken: string;
  userId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  spaceId: string;
  space: SpaceDTO;
  /** رقم المقعد المرئي (0-based) عند التخصيص اليدوي من خريطة المقر — null إن لم يُخصَّص لمقعد بعينه. */
  seatIndex: number | null;
  bookingType: BookingType;
  startTime: string;
  endTime: string;
  /** مرادف startTime بالاسم القياسي حسب عقد التكامل §10 — نفس اللحظة الزمنية بالضبط. */
  startDate?: string;
  /** مرادف endTime بالاسم القياسي حسب عقد التكامل §10 — نفس اللحظة الزمنية بالضبط. */
  endDate?: string;
  isStudent: boolean;
  basePrice: string;
  discountAmount: string;
  finalPrice: string;
  status: BookingStatus;
  notes: string | null;
  user?: { id: string; name: string; phone: string | null; email: string | null } | null;
  checkInLogs?: CheckInLogDTO[];
  createdAt: string;
}

export interface UserSearchResultDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isStudent: boolean;
  role: "USER" | "RECEPTION" | "ADMIN" | "SUPER_ADMIN";
}

export interface DashboardSummaryDTO {
  totalToday: number;
  currentlyCheckedIn: number;
  upcomingSoon: number;
  lateArrivals: number;
  cancelledOrNoShow: number;
  checkedOutToday: number;
  activeSubscribersCount: number;
  /** إجمالي إيراد اليوم — يظهر فقط لمن يملك صلاحية canViewReports (ADMIN/SUPER_ADMIN)؛ غائب تماماً عن الاستجابة لغيرهم. */
  revenueToday?: string;
  generatedAt: string;
}

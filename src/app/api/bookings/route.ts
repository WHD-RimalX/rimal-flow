import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBookingSchema, listBookingsQuerySchema, parseStatusFilter } from "@/validations/booking";
import { calculatePrice, computeEndTime } from "@/lib/pricing";
import { assertNoBookingConflict } from "@/lib/availability";
import { generateBookingCode } from "@/lib/booking-code";
import { handleApiError } from "@/lib/api-response";
import { getAuthSession } from "@/lib/session";
import { isStaff } from "@/lib/rbac";
import { endOfDay, startOfDay } from "date-fns";

/**
 * إنشاء حجز جديد.
 * الأمان: السعر يُحسب بالكامل هنا اعتماداً على بيانات المساحة في قاعدة البيانات؛
 * أي حقل سعر قد يُرسله العميل يُتجاهل تماماً (createBookingSchema لا يحتوي عليه أصلاً).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await req.json();
    const data = createBookingSchema.parse(body);

    const staffCaller = Boolean(session?.user && isStaff(session.user.role));
    const bookForExistingCustomer = Boolean(data.customerUserId);
    const bookAsGuest = Boolean(data.guestName && data.guestPhone);

    if (!session?.user && !bookAsGuest) {
      return NextResponse.json(
        { error: "يرجى تسجيل الدخول أو إدخال الاسم ورقم الجوال لإتمام الحجز كضيف" },
        { status: 400 }
      );
    }

    // لا يجوز لموظف استقبال/مدير إنشاء حجز "مجرّد" منسوب لحسابه هو — يجب دائماً
    // تحديد المستفيد الفعلي: إما عميل مسجَّل بالنظام (customerUserId) أو بيانات ضيف كاملة.
    if (staffCaller && !bookForExistingCustomer && !bookAsGuest) {
      return NextResponse.json(
        { error: "يجب تحديد العميل المستفيد من الحجز — اختر عميلاً مسجلاً أو أدخل بيانات الضيف" },
        { status: 400 }
      );
    }

    let targetCustomerId: string | null = null;
    let targetCustomerIsStudent = false;
    if (bookForExistingCustomer) {
      const targetUser = await prisma.user.findUnique({ where: { id: data.customerUserId } });
      if (!targetUser) {
        return NextResponse.json({ error: "العميل المحدد غير موجود" }, { status: 404 });
      }
      targetCustomerId = targetUser.id;
      targetCustomerIsStudent = targetUser.isStudent;
    }

    const space = await prisma.space.findUnique({ where: { id: data.spaceId } });
    if (!space || !space.isActive) {
      return NextResponse.json({ error: "المساحة المطلوبة غير موجودة أو غير متاحة" }, { status: 404 });
    }

    const endTime = computeEndTime(data.bookingType, data.startTime);

    await assertNoBookingConflict(space, data.startTime, endTime);

    // إن كان هذا تخصيصاً يدوياً لمقعد محدَّد من الخريطة، تأكد أن هذا المقعد بالذات
    // غير مشغول فعلياً بحجز آخر متداخل زمنياً (منفصل عن سعة المساحة الإجمالية أعلاه).
    if (data.seatIndex !== undefined) {
      const seatTaken = await prisma.booking.findFirst({
        where: {
          spaceId: space.id,
          seatIndex: data.seatIndex,
          status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          startTime: { lt: endTime },
          endTime: { gt: data.startTime },
        },
      });
      if (seatTaken) {
        return NextResponse.json({ error: "هذا المقعد مشغول بالفعل بحجز آخر في هذا التوقيت" }, { status: 409 });
      }
    }

    // خصم الطلاب يُطبَّق فقط إن كانت المساحة تدعمه؛ وإلا يُتجاهل حتى لو طلبه العميل.
    // عند التخصيص لعميل مسجَّل، يُعتمد على حقل isStudent الموثّق في حسابه بدل تصريح الموظف اليدوي.
    const requestedStudent = targetCustomerId ? targetCustomerIsStudent : data.isStudent;
    const isStudent = requestedStudent && Number(space.studentDiscount) > 0;
    const { basePrice, discountAmount, finalPrice } = calculatePrice(
      space,
      data.bookingType,
      isStudent
    );

    const booking = await prisma.booking.create({
      data: {
        bookingCode: generateBookingCode(),
        userId: targetCustomerId ?? (bookAsGuest ? null : session?.user?.id ?? null),
        guestName: targetCustomerId ? null : bookAsGuest ? data.guestName : null,
        guestPhone: targetCustomerId ? null : bookAsGuest ? data.guestPhone : null,
        guestEmail: targetCustomerId ? null : bookAsGuest ? data.guestEmail ?? null : null,
        spaceId: space.id,
        seatIndex: data.seatIndex ?? null,
        bookingType: data.bookingType,
        startTime: data.startTime,
        endTime,
        isStudent,
        basePrice,
        discountAmount,
        finalPrice,
        notes: data.notes,
        status: "CONFIRMED",
      },
      include: { space: true },
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * قائمة الحجوزات:
 * - الموظفون (RECEPTION/ADMIN/SUPER_ADMIN) يرون كل الحجوزات مع دعم الفلاتر — تُستخدم في لوحة رمال فلو.
 * - العميل العادي يرى حجوزاته الخاصة فقط.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = listBookingsQuerySchema.parse({
      date: searchParams.get("date") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      spaceId: searchParams.get("spaceId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const staff = isStaff(session.user.role);

    const where: Record<string, unknown> = {};
    if (!staff) {
      where.userId = session.user.id;
    }
    const statusFilter = parseStatusFilter(query.status);
    if (statusFilter) where.status = statusFilter.length === 1 ? statusFilter[0] : { in: statusFilter };
    if (query.spaceId) where.spaceId = query.spaceId;
    if (query.date) {
      where.startTime = { gte: startOfDay(query.date), lte: endOfDay(query.date) };
    } else if (query.from || query.to) {
      where.startTime = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    // الصفحات اختيارية: تُطبَّق فقط عند تمرير page و/أو pageSize صراحةً، حفاظاً على
    // التوافق مع المستهلكين الآخرين لهذا المسار (التقويم، الخريطة التفاعلية، لوحة الحاضرين)
    // الذين يحتاجون كل النتائج المطابقة دفعة واحدة.
    const paginate = query.page !== undefined || query.pageSize !== undefined;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        include: {
          space: true,
          user: { select: { id: true, name: true, phone: true, email: true } },
          checkInLogs: { orderBy: { timestamp: "desc" }, take: 5 },
        },
        orderBy: { startTime: "asc" },
        ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
    ]);

    return NextResponse.json({ bookings, total, page, pageSize });
  } catch (error) {
    return handleApiError(error);
  }
}

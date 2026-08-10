import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBookingSchema, listBookingsQuerySchema, parseStatusFilter } from "@/validations/booking";
import { calculatePrice, computeEndTime } from "@/lib/pricing";
import { assertNoBookingConflict } from "@/lib/availability";
import { generateBookingCode } from "@/lib/booking-code";
import { handleApiError } from "@/lib/api-response";
import { getAuthSession, UnauthorizedError } from "@/lib/session";
import { isStaff } from "@/lib/rbac";
import { serializeBooking } from "@/lib/serialize-booking";
import { reconcileExpiredBookings } from "@/lib/booking-lifecycle";
import { recordStatusTransition } from "@/lib/booking-state-machine";
import { endOfDay, startOfDay } from "date-fns";

/**
 * إنشاء حجز جديد.
 * الأمان: السعر يُحسب بالكامل هنا اعتماداً على بيانات المساحة في قاعدة البيانات؛
 * أي حقل سعر قد يُرسله العميل يُتجاهل تماماً (createBookingSchema لا يحتوي عليه أصلاً).
 *
 * توافقاً مع عقد التكامل §10: الحجز يتطلب جلسة موثَّقة دائماً (401 لغير المسجّلين
 * دخولهم بلا استثناء) — لم يعد هناك "حجز ضيف مجهول تماماً" بلا أي جلسة؛ الموظف ما
 * زال يقدر يحجز لصالح ضيف عبر guestName/guestPhone لكن تحت جلسته هو دائماً.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      throw new UnauthorizedError("يرجى تسجيل الدخول أولاً لإتمام الحجز");
    }

    const body = await req.json();
    const data = createBookingSchema.parse(body);

    const staffCaller = isStaff(session.user.role);
    const bookForExistingCustomer = Boolean(data.customerUserId);
    const bookAsGuest = Boolean(data.guestName && data.guestPhone);

    // SECURITY-AUDIT.md §5 (FLOW-C07/C08): customerUserId يقدر ينسب الحجز لأي
    // مستخدم آخر معروف المعرّف — يجب أن يبقى حصراً بيد الموظفين، وإلا يقدر أي
    // عميل عادي يحجز باسم عميل آخر يعرف معرّفه فقط.
    if (bookForExistingCustomer && !staffCaller) {
      return NextResponse.json(
        { error: "تحديد عميل آخر (customerUserId) متاح للموظفين فقط" },
        { status: 403 }
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

    const spaceLookup = await prisma.space.findUnique({ where: { id: data.spaceId } });
    if (!spaceLookup || !spaceLookup.isActive) {
      return NextResponse.json({ error: "المساحة المطلوبة غير موجودة أو غير متاحة" }, { status: 404 });
    }

    const endTime = computeEndTime(data.bookingType, data.startDate, data.durationHours);

    // خصم الطلاب يُطبَّق فقط إن كانت المساحة تدعمه؛ وإلا يُتجاهل حتى لو طلبه العميل.
    // عند التخصيص لعميل مسجَّل، يُعتمد على حقل isStudent الموثّق في حسابه بدل تصريح الموظف اليدوي.
    const requestedStudent = targetCustomerId ? targetCustomerIsStudent : data.isStudent;
    const isStudent = requestedStudent && Number(spaceLookup.studentDiscount) > 0;
    const { basePrice, discountAmount, finalPrice } = calculatePrice(
      spaceLookup,
      data.bookingType,
      isStudent,
      data.durationHours
    );

    // SECURITY-AUDIT.md §1 (FLOW-C04): فحص التعارض والإدراج كانا عمليتين منفصلتين
    // غير ذريتين (TOCTOU) — طلبان متزامنان لنفس المساحة يقرآن "لا تعارض" معاً قبل
    // أن يُدرج أي منهما، فينجح كلاهما معاً ويتجاوز عدد الحجوزات النشطة السعة. الحل
    // الأدنى المُوصى به في التدقيق (بانتظار إعادة تصميم كاملة بوحدات مساحة منفصلة
    // وقيد EXCLUDE في قاعدة البيانات): تسلسل كل الكتابات على نفس صف المساحة بقفل
    // SELECT ... FOR UPDATE ضمن معاملة، وإعادة فحص التعارض *داخل* تلك المعاملة —
    // فيصبح "فحص ثم إدراج" ذرياً فعلياً بالنسبة لأي طلب آخر لنفس المساحة.
    const booking = await prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "spaces" WHERE "id" = ${spaceLookup.id} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new Error("SPACE_VANISHED");
        }

        await assertNoBookingConflict(spaceLookup, data.startDate, endTime, undefined, tx);

        // إن كان هذا تخصيصاً يدوياً لمقعد محدَّد من الخريطة، تأكد أن هذا المقعد بالذات
        // غير مشغول فعلياً بحجز آخر متداخل زمنياً (منفصل عن سعة المساحة الإجمالية أعلاه).
        if (data.seatIndex !== undefined) {
          const seatTaken = await tx.booking.findFirst({
            where: {
              spaceId: spaceLookup.id,
              seatIndex: data.seatIndex,
              status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
              startTime: { lt: endTime },
              endTime: { gt: data.startDate },
            },
          });
          if (seatTaken) {
            throw new SeatTakenError();
          }
        }

        const created = await tx.booking.create({
          data: {
            bookingCode: generateBookingCode(),
            userId: targetCustomerId ?? (bookAsGuest ? null : session.user.id),
            guestName: targetCustomerId ? null : bookAsGuest ? data.guestName : null,
            guestPhone: targetCustomerId ? null : bookAsGuest ? data.guestPhone : null,
            guestEmail: targetCustomerId ? null : bookAsGuest ? data.guestEmail ?? null : null,
            spaceId: spaceLookup.id,
            seatIndex: data.seatIndex ?? null,
            bookingType: data.bookingType,
            startTime: data.startDate,
            endTime,
            isStudent,
            basePrice,
            discountAmount,
            finalPrice,
            notes: data.notes,
            // يبدأ كل حجز جديد بحالة PENDING (توافقاً مع عقد التكامل §10) ويحتاج
            // تأكيداً يدوياً صريحاً من موظف عبر PATCH /api/admin/bookings/:id —
            // لم يعد يُنشأ مؤكَّداً تلقائياً كما كان سابقاً.
            status: "PENDING",
          },
          include: { space: true },
        });

        await recordStatusTransition({
          tx,
          bookingId: created.id,
          fromStatus: null,
          toStatus: "PENDING",
          actorId: session.user.id,
          actorLabel: session.user.name ?? session.user.email ?? undefined,
        });

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    return NextResponse.json(serializeBooking(booking), { status: 201 });
  } catch (error) {
    if (error instanceof SeatTakenError) {
      return NextResponse.json({ error: "هذا المقعد مشغول بالفعل بحجز آخر في هذا التوقيت" }, { status: 409 });
    }
    return handleApiError(error);
  }
}

/** استثناء داخلي فقط: يُرمى ويُلتقَط ضمن نفس الملف لترجمته لاستجابة 409 خارج المعاملة. */
class SeatTakenError extends Error {}

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

    await reconcileExpiredBookings();

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

    // SECURITY-AUDIT.md §5 (FLOW-C07/C08): قوائم الحجوزات الجماعية كانت تُعيد
    // qrToken الدائم لكل حجز لكل موظف — موظف استقبال يتصفّح قائمة اليوم يقدر
    // ينسخ رمز عميل لم يحضر بعد ويستخدمه بنفسه. نحجب الرمز من القوائم الجماعية
    // لدور RECEPTION تحديداً (ADMIN/SUPER_ADMIN يبقيان لأغراض الإشراف والتدقيق،
    // والعميل نفسه يرى رمزه الخاص دائماً لأن هذا المسار يعرض حجوزاته هو فقط).
    //
    // SECURITY-AUDIT(V2).md §5 (FLOW-C07/C08): حجب الحقل بعد الجلب (JS) كان كافياً
    // لمنع تسربه في الاستجابة، لكن التدقيق يطلب صراحةً ألا يُجلَب من قاعدة البيانات
    // أصلاً لهذا الدور — دفاع بعمق إضافي. الآن `select` صريح بدل `include` الشامل،
    // فحقل qrToken لا يدخل حتى ذاكرة السيرفر لدور RECEPTION.
    const omitQrToken = staff && session.user.role === "RECEPTION";

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        select: {
          id: true,
          bookingCode: true,
          ...(omitQrToken ? {} : { qrToken: true }),
          userId: true,
          guestName: true,
          guestPhone: true,
          guestEmail: true,
          spaceId: true,
          seatIndex: true,
          bookingType: true,
          startTime: true,
          endTime: true,
          isStudent: true,
          basePrice: true,
          discountAmount: true,
          finalPrice: true,
          status: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          space: true,
          user: { select: { id: true, name: true, phone: true, email: true } },
          checkInLogs: { orderBy: { timestamp: "desc" }, take: 5 },
        },
        orderBy: { startTime: "asc" },
        ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
    ]);

    return NextResponse.json({
      bookings: bookings.map((b) => serializeBooking(b, { omitQrToken })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bookingCheckInRequestSchema } from "@/validations/checkin";
import { runCheckInAction } from "@/lib/checkin-core";
import { handleApiError } from "@/lib/api-response";
import { requireSession } from "@/lib/session";
import { assertPermission, isStaff } from "@/lib/rbac";

/**
 * مسار تسجيل الحضور/الانصراف الرسمي حسب عقد التكامل §10 — بديل عن
 * `/api/checkin` (الذي يبقى كما هو لمسار المسح الذاتي عبر QR في تطبيقنا).
 * يحدَّد الحجز عبر معرّفه في الـ URL مباشرة (لا bookingCode ولا qrCode)، ويدعم
 * `idempotencyKey` لمنع إعادة معالجة نفس الحدث عند إعادة الإرسال (Replay).
 *
 * ملاحظة أمنية (SECURITY-AUDIT.md §4، FLOW-C09): هذا المسار موثَّق في
 * API_CONTRACT.md وتختبره مجموعة Postman الرسمية بجلسة مستخدم عادي — إبقاؤه
 * يقبل جلسة مستخدم (بدل قفله بمصادقة تكامل خارجي فقط) قرار مقصود للحفاظ على
 * توافق العقد الموثَّق. لكن الثغرة الفعلية التي رصدها التدقيق (أي عميل مسجَّل
 * يعرف معرّف حجز غيره يقدر يسجّل حضوره/انصرافه) مُصلَحة هنا صراحةً: عميل عادي
 * (USER) يقدر ينفّذ هذا فقط على حجزه هو؛ الموظفون فقط يقدرون على أي حجز — تماماً
 * كما يعمل مسار /api/bookings/:id/extend الموازي له أصلاً. لأي نظام ربط خارجي
 * حقيقي (بلا جلسة مستخدم على الإطلاق)، استخدم المسار الجديد المخصَّص والموقَّع
 * تشفيرياً: POST /api/integrations/attendance-events.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const data = bookingCheckInRequestSchema.parse(body);

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "لم يتم العثور على حجز بهذا المعرّف" }, { status: 404 });
    }

    const staffCaller = isStaff(session.user.role);
    if (!staffCaller && booking.userId !== session.user.id) {
      return NextResponse.json({ error: "لا تملك صلاحية تنفيذ هذا الإجراء على حجز غيرك" }, { status: 403 });
    }
    // الصلاحية الدقيقة (canCheckIn/canCheckOut) تُفرَض على الموظفين فقط — الحضور
    // الذاتي للعميل على حجزه هو ليس "إجراء موظف" ولا يخضع لصلاحيات الدور الموظفي.
    if (staffCaller) {
      assertPermission(session.user, data.action === "CHECK_IN" ? "canCheckIn" : "canCheckOut");
    }

    const result = await runCheckInAction({
      booking,
      action: data.action,
      performedById: session.user.id,
      performedByLabel: session.user.name ?? session.user.email ?? undefined,
      idempotencyKey: data.idempotencyKey,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
}

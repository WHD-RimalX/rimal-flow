import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { hashPayload, verifyIntegrationRequest, InboundEventConflictError } from "@/lib/integration-auth";
import { runCheckInActionInTx } from "@/lib/checkin-core";

/**
 * محول ربط خارجي حقيقي — SECURITY-AUDIT.md §4 (FLOW-C09) بديل مخصَّص وآمن عن
 * الاعتماد على جلسة متصفح مستخدم عادي. مصادقة بتوقيع HMAC-SHA256 (راجع
 * src/lib/integration-auth.ts) + طابع زمني (نافذة 5 دقائق) + سجل استلام أحداث
 * (`InboundEvent`) يفرض idempotency حقيقياً على مستوى (sourceId, externalEventId):
 * - نفس المعرّف بنفس الحمولة → تُعاد النتيجة المخزَّنة سابقاً دون إعادة التنفيذ.
 * - نفس المعرّف بحمولة مختلفة → 409 (تعارض idempotency صريح).
 * - معرّف جديد → يُنفَّذ الحدث فعلياً عبر محرك الحضور المشترك.
 *
 * هذا مسار إضافي لا يستبدل `/api/bookings/:id/check-in` (يبقى كما هو — موثَّق
 * في API_CONTRACT.md §10 وتختبره مجموعة Postman الرسمية بجلسة مستخدم)، فقط
 * أُصلِح فيه ثغرة انتحال حجز الغير (راجع تعليق FLOW-C09 هناك). هذا المسار هو
 * الوجهة الصحيحة لأي نظام ربط خارجي فعلي (بوابة دخول، جهاز بصمة، إلخ).
 *
 * SECURITY-AUDIT(V2).md §4 (FLOW-C09): "مطالبة" الحدث (إدراج InboundEvent)،
 * تنفيذ الفعل (runCheckInAction)، وحفظ النتيجة كانت ثلاث عمليات منفصلة غير
 * ذرية — لو تعطّل السيرفر بين المطالبة والحفظ، يبقى الحدث "مُطالَباً" للأبد بلا
 * نتيجة محفوظة، فتُرفض كل إعادة إرسال لاحقة بصمت (idempotency key مسموم دائماً)
 * رغم أن الحدث ربما لم يُنفَّذ فعلياً قط. الآن الثلاث عمليات (الإدراج، التنفيذ عبر
 * runCheckInActionInTx بنفس معاملة الاستدعاء، وحفظ النتيجة) داخل معاملة Prisma
 * واحدة — إما تُنفَّذ كلها معاً وتُثبَّت (commit)، أو تتراجع كلها معاً (rollback)
 * عند أي فشل غير متوقَّع، فلا يوجد أبداً "حدث مُطالَب بلا نتيجة" مستقر في القاعدة.
 * كذلك: كان الـ catch حول محاولة الإدراج يعامل أي فشل قاعدة بيانات (اتصال، مهلة،
 * إلخ) كـ"حدث مكرر" خطأً — الآن يُلتقَط فقط خطأ Prisma P2002 (خرق قيد التفرّد
 * الفعلي)، وأي فشل آخر يتصاعد ليُرفض الطلب بوضوح (500) بدل تجاهله كتكرار.
 */
const bodySchema = z.object({
  sourceId: z.string().trim().min(1),
  externalEventId: z.string().trim().min(1),
  bookingId: z.string().trim().min(1),
  eventType: z.enum(["CHECK_IN", "CHECK_OUT"]),
});

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    verifyIntegrationRequest(rawBody, req.headers.get("x-timestamp"), req.headers.get("x-signature"));

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "جسم الطلب ليس JSON صالحاً" }, { status: 400 });
    }
    const data = bodySchema.parse(parsedJson);
    const payloadHash = hashPayload(rawBody);
    const eventKey = { sourceId_externalEventId: { sourceId: data.sourceId, externalEventId: data.externalEventId } };

    const outcome = await prisma.$transaction(async (tx) => {
      // خطوة 1: محاولة "المطالبة" بالحدث ذرياً عبر قيد التفرّد (sourceId, externalEventId).
      // فشل الإدراج بخرق القيد (P2002) يعني حدثاً سبق استلامه — لا تنفيذ مزدوج
      // مهما تزامنت الطلبات. أي فشل آخر (اتصال، مهلة...) يتصاعد ويُلغي المعاملة.
      //
      // ملاحظة تقنية (اكتُشفت أثناء الاختبار): خطأ من استعلام واحد داخل معاملة
      // Postgres تفاعلية "يُسمِّم" المعاملة بالكامل على مستوى القاعدة نفسها
      // (25P02: current transaction is aborted) حتى لو التُقِط الخطأ في JS —
      // أي استعلام لاحق ضمن نفس المعاملة يُرفض فوراً. SAVEPOINT/ROLLBACK TO
      // SAVEPOINT حول محاولة الإدراج فقط يعزل فشلها المتوقَّع (تكرار المفتاح)
      // فتستمر بقية المعاملة بشكل طبيعي.
      let claimed = false;
      await tx.$executeRawUnsafe("SAVEPOINT claim_attempt");
      try {
        await tx.inboundEvent.create({
          data: {
            sourceId: data.sourceId,
            externalEventId: data.externalEventId,
            externalBookingId: data.bookingId,
            eventType: data.eventType,
            payloadHash,
          },
        });
        claimed = true;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT claim_attempt");
        claimed = false;
      }

      if (!claimed) {
        const existing = await tx.inboundEvent.findUnique({ where: eventKey });
        if (!existing) {
          // من الناحية النظرية غير قابل للحدوث: خرق قيد التفرّد يعني وجود صف
          // ملتزَم (committed) بهذا المفتاح مسبقاً، وقراءتنا هنا ضمن نفس المعاملة
          // (READ COMMITTED) تراه حتماً — نرفض بوضوح إن حدث هذا رغم ذلك.
          throw new InboundEventConflictError("تعارض غير متوقَّع في معالجة الحدث — أعد المحاولة");
        }
        if (existing.payloadHash !== payloadHash) {
          throw new InboundEventConflictError();
        }
        // نفس الحدث تماماً (إعادة إرسال مشروعة) — أعد نفس النتيجة ورمز الحالة
        // المخزَّنَين من أول معالجة فعلية، دون تنفيذ جديد. لا نفترض 200 دائماً —
        // حدث انتهى برفض (409/422) يجب أن يُعاد بنفس رمز الرفض عند إعادة إرساله.
        const stored = existing.result as { status?: number; body?: unknown } | null;
        if (stored?.body !== undefined) {
          return { status: stored.status ?? 200, body: stored.body as Record<string, unknown> };
        }
        return { status: 200, body: { message: "تمت معالجة هذا الحدث مسبقاً" } };
      }

      // خطوة 2: الحدث مملوك لنا حصراً ضمن هذه المعاملة — نفّذ الإجراء الفعلي عبر
      // المحرك المشترك بنفس معاملة الإدراج والحفظ (runCheckInActionInTx لا يفتح
      // معاملة جديدة، يشارك `tx` هذه تحديداً).
      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
      });

      let resultBody: Record<string, unknown>;
      let resultStatus: number;
      if (!booking) {
        resultStatus = 404;
        resultBody = { error: "الحجز غير موجود" };
      } else {
        const result = await runCheckInActionInTx(tx, {
          booking,
          action: data.eventType,
          idempotencyKey: `integration:${data.sourceId}:${data.externalEventId}`,
        });
        resultStatus = result.status;
        resultBody = result.body;
      }

      // خطوة 3: خزّن النتيجة (بجسمها ورمز حالتها معاً) ضمن نفس المعاملة — أي
      // إعادة إرسال لاحقة بنفس المعرّف والحمولة تُعيد هذه النتيجة بالضبط، بنفس
      // رمز الحالة الأصلي، بدل إعادة التنفيذ أو افتراض النجاح دائماً. لو تعطّل
      // السيرفر قبل الوصول هنا، المعاملة كاملة تتراجع (لا حدث "مُطالَب" يتيم).
      await tx.inboundEvent.update({
        where: eventKey,
        data: { result: { status: resultStatus, body: resultBody } as Prisma.InputJsonValue },
      });

      return { status: resultStatus, body: resultBody };
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-response";
import { hashPayload, verifyIntegrationRequest } from "@/lib/integration-auth";
import { runCheckInAction } from "@/lib/checkin-core";

/**
 * محول ربط خارجي حقيقي — SECURITY-AUDIT.md §4 (FLOW-C09) بديل مخصَّص وآمن عن
 * الاعتماد على جلسة متصفح مستخدم عادي. مصادقة بتوقيع HMAC-SHA256 (راجع
 * src/lib/integration-auth.ts) + طابع زمني (نافذة 5 دقائق) + سجل استلام أحداث
 * (`InboundEvent`) يفرض idempotency حقيقياً على مستوى (sourceId, externalEventId):
 * - نفس المعرّف بنفس الحمولة → تُعاد النتيجة المخزَّنة سابقاً دون إعادة التنفيذ.
 * - نفس المعرّف بحمولة مختلفة → 409 (تعارض idempotency صريح).
 * - معرّف جديد → يُنفَّذ الحدث فعلياً عبر محرك الحضور المشترك (runCheckInAction).
 *
 * هذا مسار إضافي لا يستبدل `/api/bookings/:id/check-in` (يبقى كما هو — موثَّق
 * في API_CONTRACT.md §10 وتختبره مجموعة Postman الرسمية بجلسة مستخدم)، فقط
 * أُصلِح فيه ثغرة انتحال حجز الغير (راجع تعليق FLOW-C09 هناك). هذا المسار هو
 * الوجهة الصحيحة لأي نظام ربط خارجي فعلي (بوابة دخول، جهاز بصمة، إلخ).
 */
const bodySchema = z.object({
  sourceId: z.string().trim().min(1),
  externalEventId: z.string().trim().min(1),
  bookingId: z.string().trim().min(1),
  eventType: z.enum(["CHECK_IN", "CHECK_OUT"]),
});

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

    // خطوة 1: محاولة "المطالبة" بالحدث ذرياً عبر قيد التفرّد (sourceId, externalEventId).
    // فشل الإدراج (تعارض) يعني حدثاً سبق استلامه — لا تنفيذ مزدوج مهما تزامنت الطلبات.
    let claimed = false;
    try {
      await prisma.inboundEvent.create({
        data: {
          sourceId: data.sourceId,
          externalEventId: data.externalEventId,
          externalBookingId: data.bookingId,
          eventType: data.eventType,
          payloadHash,
        },
      });
      claimed = true;
    } catch {
      claimed = false;
    }

    if (!claimed) {
      const existing = await prisma.inboundEvent.findUnique({
        where: { sourceId_externalEventId: { sourceId: data.sourceId, externalEventId: data.externalEventId } },
      });
      if (!existing) {
        // سباق نادر: أُنشئ الصف بين محاولة الإدراج وقراءته — أعد المحاولة مرة واحدة.
        return NextResponse.json({ error: "تعارض مؤقت في معالجة الحدث — أعد المحاولة" }, { status: 409 });
      }
      if (existing.payloadHash !== payloadHash) {
        return NextResponse.json(
          { error: "تم استلام حدث بنفس المعرّف مسبقاً بحمولة مختلفة" },
          { status: 409 }
        );
      }
      // نفس الحدث تماماً (إعادة إرسال مشروعة) — أعد نفس النتيجة ورمز الحالة
      // المخزَّنَين من أول معالجة فعلية، دون تنفيذ جديد. لا نفترض 200 دائماً —
      // حدث انتهى برفض (409/422) يجب أن يُعاد بنفس رمز الرفض عند إعادة إرساله.
      const stored = existing.result as { status?: number; body?: unknown } | null;
      if (stored?.body !== undefined) {
        return NextResponse.json(stored.body, { status: stored.status ?? 200 });
      }
      return NextResponse.json({ message: "تمت معالجة هذا الحدث مسبقاً" }, { status: 200 });
    }

    // خطوة 2: الحدث مملوك لنا الآن حصراً — نفّذ الإجراء الفعلي عبر المحرك المشترك.
    const booking = await prisma.booking.findUnique({
      where: { id: data.bookingId },
      include: { checkInLogs: { orderBy: { timestamp: "desc" } }, space: true },
    });

    let resultBody: Record<string, unknown>;
    let resultStatus: number;
    if (!booking) {
      resultStatus = 404;
      resultBody = { error: "الحجز غير موجود" };
    } else {
      const outcome = await runCheckInAction({
        booking,
        action: data.eventType,
        idempotencyKey: `integration:${data.sourceId}:${data.externalEventId}`,
      });
      resultStatus = outcome.status;
      resultBody = outcome.body;
    }

    // خطوة 3: خزّن النتيجة (بجسمها ورمز حالتها معاً) على سجل الحدث المُطالَب به —
    // أي إعادة إرسال لاحقة بنفس المعرّف والحمولة تُعيد هذه النتيجة بالضبط، بنفس
    // رمز الحالة الأصلي، بدل إعادة التنفيذ أو افتراض النجاح دائماً.
    await prisma.inboundEvent.update({
      where: { sourceId_externalEventId: { sourceId: data.sourceId, externalEventId: data.externalEventId } },
      data: { result: { status: resultStatus, body: resultBody } as Prisma.InputJsonValue },
    });

    return NextResponse.json(resultBody, { status: resultStatus });
  } catch (error) {
    return handleApiError(error);
  }
}

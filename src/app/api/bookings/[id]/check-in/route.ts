import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bookingCheckInRequestSchema } from "@/validations/checkin";
import { runCheckInAction } from "@/lib/checkin-core";
import { handleApiError } from "@/lib/api-response";
import { requireSession } from "@/lib/session";

/**
 * مسار تسجيل الحضور/الانصراف الرسمي حسب عقد التكامل §10 — بديل عن
 * `/api/checkin` (الذي يبقى كما هو لمسار المسح الذاتي عبر QR في تطبيقنا).
 * يحدَّد الحجز عبر معرّفه في الـ URL مباشرة (لا bookingCode ولا qrCode)، ويدعم
 * `idempotencyKey` لمنع إعادة معالجة نفس الحدث عند إعادة الإرسال (Replay).
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

    const result = await runCheckInAction({
      booking,
      action: data.action,
      performedById: session.user.id,
      idempotencyKey: data.idempotencyKey,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
}

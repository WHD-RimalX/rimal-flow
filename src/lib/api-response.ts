import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { PricingError } from "@/lib/pricing";
import { ConflictError } from "@/lib/availability";
import { BookingNotFoundError, InvalidTransitionError } from "@/lib/booking-state-machine";
import { InboundEventConflictError, InvalidSignatureError } from "@/lib/integration-auth";

/** يحوّل أي خطأ متوقع إلى استجابة HTTP موحدة مع رمز الحالة المناسب. */
export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "بيانات غير صالحة", issues: error.flatten() },
      { status: 400 }
    );
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof PricingError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof BookingNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof InvalidTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof InboundEventConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof InvalidSignatureError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof Error) {
    console.error("[API_ERROR]", error);
    // لا نعيد error.message الخام دائماً — رسائل الأخطاء المتوقَّعة أعلاه فقط
    // آمنة للعرض؛ أي استثناء غير متوقَّع آخر (خطأ قاعدة بيانات، استثناء داخلي)
    // قد يحمل تفاصيل تنفيذية لا يجب كشفها للعميل (SECURITY-AUDIT.md §4).
    return NextResponse.json({ error: "حدث خطأ غير متوقع" }, { status: 500 });
  }
  console.error("[API_ERROR_UNKNOWN]", error);
  return NextResponse.json({ error: "حدث خطأ غير متوقع" }, { status: 500 });
}

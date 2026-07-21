import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { PricingError } from "@/lib/pricing";
import { ConflictError } from "@/lib/availability";

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
  if (error instanceof Error) {
    console.error("[API_ERROR]", error);
    return NextResponse.json({ error: error.message || "حدث خطأ غير متوقع" }, { status: 400 });
  }
  console.error("[API_ERROR_UNKNOWN]", error);
  return NextResponse.json({ error: "حدث خطأ غير متوقع" }, { status: 500 });
}

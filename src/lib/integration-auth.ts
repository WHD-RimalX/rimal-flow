import crypto from "crypto";

/**
 * مصادقة محول الربط الخارجي — SECURITY-AUDIT.md §4 (FLOW-C09).
 * توقيع HMAC-SHA256 على `${timestamp}.${rawBody}` بسر مشترك، مقارن بزمن ثابت
 * (constant-time) لمنع هجمات التوقيت. مبسَّط عمداً لسر واحد لكل البيئة (بدل
 * سجل عملاء ربط متعدد بأسرار منفصلة لكل مصدر) — كافٍ للنطاق الحالي؛ توسيعه
 * لعدة مصادر بأسرار مستقلة يحتاج جدول IntegrationClient منفصل لاحقاً.
 */
export class InvalidSignatureError extends Error {
  constructor(message = "توقيع الطلب غير صالح أو منتهي الصلاحية") {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

export class InboundEventConflictError extends Error {
  constructor(message = "تم استلام هذا الحدث مسبقاً بحمولة مختلفة — تعارض idempotency") {
    super(message);
    this.name = "InboundEventConflictError";
  }
}

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.INTEGRATION_HMAC_SECRET;
  if (!secret) {
    throw new Error("INTEGRATION_HMAC_SECRET غير مضبوط في بيئة السيرفر — محول الربط معطَّل حتى ضبطه");
  }
  return secret;
}

/** يتحقق من ترويستَي X-Timestamp وX-Signature مقابل الجسم الخام — يرمي InvalidSignatureError عند الفشل. */
export function verifyIntegrationRequest(rawBody: string, timestampHeader: string | null, signatureHeader: string | null) {
  if (!timestampHeader || !signatureHeader) {
    throw new InvalidSignatureError("يجب توفير ترويستَي X-Timestamp وX-Signature");
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > FRESHNESS_WINDOW_MS) {
    throw new InvalidSignatureError("الطابع الزمني للطلب غير صالح أو خارج نافذة الصلاحية (5 دقائق)");
  }

  const expected = crypto.createHmac("sha256", getSecret()).update(`${timestampHeader}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  const valid = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  if (!valid) {
    throw new InvalidSignatureError();
  }
}

export function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

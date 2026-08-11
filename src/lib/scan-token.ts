import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * رمز المسح المؤقت (Rotating QR) — SECURITY-AUDIT.V2.md §2 (FLOW-X01).
 *
 * المشكلة التي يحلّها: رمز QR الثابت (`Booking.qrToken`) كان صالحاً طوال عمر
 * الحجز — لقطة شاشة واحدة (أو صورة مُعاد إرسالها في محادثة) تكفي لانتحال الحجز
 * إلى الأبد، وبالنسبة للاشتراك الشهري ذلك يعني 30 يوماً كاملة.
 *
 * الحل: الرمز المعروض في QR لا يعيش إلا ثوانٍ معدودة، ويتجدد تلقائياً في شاشة
 * العميل، ويُستهلَك ذرياً عند أول مسح ناجح (يُمسَح من الصف في نفس عملية الكتابة
 * المشروطة) فلا يُقبل مرتين مهما تكرر إرساله. أي لقطة شاشة تصبح بلا قيمة خلال
 * ثوانٍ، وأي إعادة إرسال لرمز سبق مسحه تُرفض صراحة.
 */

/** عمر رمز المسح — قصير عمداً: يكفي للمسح الفوري ولا يكفي لمشاركة لقطة شاشة. */
export const SCAN_TOKEN_TTL_SECONDS = 45;

export class ScanTokenError extends Error {
  constructor(message = "رمز المسح غير صالح أو انتهت صلاحيته — اطلب رمزاً جديداً من شاشة العميل") {
    super(message);
    this.name = "ScanTokenError";
  }
}

/**
 * يولّد رمز مسح جديد لهذا الحجز ويستبدل أي رمز سابق (الرمز القديم يبطل فوراً —
 * رمز واحد صالح لكل حجز في أي لحظة). عشوائي تشفيرياً 256 بت بترميز base64url.
 */
export async function issueScanToken(bookingId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SCAN_TOKEN_TTL_SECONDS * 1000);

  await prisma.booking.update({
    where: { id: bookingId },
    data: { scanToken: token, scanTokenExpiresAt: expiresAt },
  });

  return { token, expiresAt };
}

/**
 * يستهلك رمز مسح ذرياً ويُعيد معرّف الحجز المرتبط به.
 *
 * الاستهلاك عبر `updateMany` مشروط بأن الرمز ما زال موجوداً وغير منتهٍ — أول
 * طلب يفوز (count = 1) ويمسح الرمز في نفس العملية، وأي طلب متزامن أو معاد
 * إرساله بعده يجد count = 0 فيُرفض. لا حاجة لقفل صف: شرط `scanToken` نفسه هو
 * الذي يضمن الحصرية لأن الحقل فريد (@unique) والكتابة مشروطة به.
 *
 * يجب تمرير `tx` عند الاستدعاء ضمن معاملة قائمة حتى يتراجع الاستهلاك أيضاً إن
 * فشلت بقية العملية (وإلا احترق رمز العميل بلا تنفيذ فعلي لأي إجراء).
 */
export async function consumeScanToken(token: string, tx?: Prisma.TransactionClient): Promise<string> {
  const db = tx ?? prisma;

  const booking = await db.booking.findUnique({
    where: { scanToken: token },
    select: { id: true, scanTokenExpiresAt: true },
  });

  if (!booking || !booking.scanTokenExpiresAt || booking.scanTokenExpiresAt.getTime() < Date.now()) {
    throw new ScanTokenError();
  }

  const consumed = await db.booking.updateMany({
    where: { id: booking.id, scanToken: token, scanTokenExpiresAt: { gt: new Date() } },
    data: { scanToken: null, scanTokenExpiresAt: null },
  });

  if (consumed.count !== 1) {
    // سباق: طلب متزامن آخر استهلك نفس الرمز قبلنا بجزء من الثانية.
    throw new ScanTokenError("تم استخدام رمز المسح هذا بالفعل — اطلب رمزاً جديداً");
  }

  return booking.id;
}

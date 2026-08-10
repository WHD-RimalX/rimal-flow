import { getServerSession, type Session } from "next-auth";
import { decode } from "next-auth/jwt";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isStaff } from "@/lib/rbac";
import { ForbiddenError } from "@/lib/rbac";

/**
 * يقبل جلسة عبر ترويسة `Authorization: Bearer <token>` بجانب كوكي الجلسة
 * المعتاد — توافقاً مع عقد التكامل §10 حيث تحتاج مجموعات اختبار خارجية (مثل
 * Postman) لتمرير هويات مختلفة (admin_token/user_token) على كل طلب صراحةً
 * بدل الاعتماد على كوكي متصفح مشترك واحد لا يميّز بين الهويات. الـ token هنا
 * هو نفس JWE المشفَّر الذي يولّده NextAuth للكوكي بالضبط (نفس `encode`/`decode`
 * ونفس السر) — وليس آلية مصادقة منفصلة أو أضعف أمنياً.
 */
async function getBearerSession(): Promise<Session | null> {
  const authHeader = headers().get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const decoded = await decode({ token, secret: process.env.NEXTAUTH_SECRET as string });
    if (!decoded?.id) return null;

    return {
      user: {
        id: decoded.id,
        name: (decoded.name as string) ?? null,
        email: (decoded.email as string) ?? null,
        role: decoded.role,
        permissions: decoded.permissions,
        isStudent: decoded.isStudent,
      },
      expires: new Date(((decoded.exp as number) ?? 0) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * SECURITY-AUDIT(V2).md §5 (FLOW-C07/C08): إعادة التحقق من isActive/role/
 * permissions من قاعدة البيانات كانت مقتصرة على requireStaffSession() فقط —
 * أي مسار "مختلط" (عميل عادي أو موظف على نفس المسار، مثل POST /api/bookings
 * أو GET /api/bookings أو /api/bookings/:id/check-in) كان يستخدم getAuthSession()
 * مباشرة ويثق بادّعاء الـ JWT المخبَّأ لغاية 8 ساعات — حساب مُعطَّل أو مخفَّض
 * الصلاحية يبقى فعّالاً على هذه المسارات تحديداً رغم إصلاح المسارات الإدارية
 * البحتة. الحل: إعادة التحقق تتم هنا مركزياً، مرة واحدة، لكل استدعاء لـ
 * getAuthSession() (المصدر الوحيد لأي جلسة في كامل التطبيق) — فيرث كل مسار
 * يستدعيها (مباشرة أو عبر requireSession/requireStaffSession) البيانات
 * الحقيقية الحالية تلقائياً، بدل الاعتماد على كل مسار ليتذكّر فعل هذا بنفسه.
 * حساب مُعطَّل أو محذوف يُعامَل كـ"لا جلسة إطلاقاً" (401) في كل مكان.
 */
export async function getAuthSession() {
  const session = (await getBearerSession()) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) return session;

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, permissions: true, isActive: true },
  });

  if (!current || !current.isActive) {
    return null;
  }

  session.user.role = current.role;
  session.user.permissions = current.permissions;

  return session;
}

export class UnauthorizedError extends Error {
  constructor(message = "يجب تسجيل الدخول أولاً") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** يتحقق من وجود جلسة صالحة — يُستخدم داخل API routes قبل أي عملية حساسة. */
export async function requireSession() {
  const session = await getAuthSession();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session;
}

/**
 * يتحقق من أن المستخدم موظف (استقبال/مدير/مدير عام).
 * توافقاً مع عقد التكامل §10 (401 = لا جلسة إطلاقاً، 403 = جلسة صالحة لكن
 * الدور غير كافٍ): لا جلسة → UnauthorizedError (401)؛ جلسة موجودة لكن الدور
 * ليس موظفاً → ForbiddenError (403)، لا نخلط بينهما كما كان سابقاً.
 *
 * إعادة قراءة isActive/role/permissions من قاعدة البيانات تتم الآن مركزياً في
 * getAuthSession() أعلاه — هذه الدالة تكتفي بفحص أن الدور (الحقيقي الحالي) موظف.
 */
export async function requireStaffSession() {
  const session = await requireSession();

  if (!isStaff(session.user.role)) {
    throw new ForbiddenError("هذا الإجراء متاح لموظفي رمال X فقط");
  }

  return session;
}

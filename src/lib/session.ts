import { getServerSession, type Session } from "next-auth";
import { decode } from "next-auth/jwt";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
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

export async function getAuthSession() {
  const bearerSession = await getBearerSession();
  if (bearerSession) return bearerSession;
  return getServerSession(authOptions);
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
 */
export async function requireStaffSession() {
  const session = await requireSession();
  if (!isStaff(session.user.role)) {
    throw new ForbiddenError("هذا الإجراء متاح لموظفي رمال X فقط");
  }
  return session;
}

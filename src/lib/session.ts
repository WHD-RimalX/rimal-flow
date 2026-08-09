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
 *
 * SECURITY-AUDIT.md §5 (FLOW-C07/C08): جلسات JWT تحمل الدور والصلاحيات كما كانت
 * لحظة تسجيل الدخول لمدة تصل 8 ساعات — تعطيل حساب موظف أو تخفيض دوره لا يُبطل
 * جلسته الحالية فوراً. لذا كل استدعاء لهذه الدالة يعيد قراءة isActive/role/
 * permissions الفعلية من قاعدة البيانات (وليس فقط الادّعاء المخزَّن في الـ JWT)
 * قبل الموافقة على أي إجراء إداري — تكلفة قراءة إضافية مقبولة لأنها تقتصر على
 * المسارات المخصَّصة للموظفين فقط، لا كل طلب في التطبيق.
 */
export async function requireStaffSession() {
  const session = await requireSession();

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, permissions: true, isActive: true },
  });

  if (!current || !current.isActive || !isStaff(current.role)) {
    throw new ForbiddenError("هذا الإجراء متاح لموظفي رمال X فقط");
  }

  // نُحدِّث الجلسة بالقيم الفعلية الحالية من قاعدة البيانات — أي مسار يستخدم
  // session.user.role/permissions بعدها يرى الحقيقة الحالية لا ادّعاء الـ JWT القديم.
  session.user.role = current.role;
  session.user.permissions = current.permissions;

  return session;
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

export async function getAuthSession() {
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

/** يتحقق من أن المستخدم موظف (استقبال/مدير/مدير عام). */
export async function requireStaffSession() {
  const session = await requireSession();
  if (!isStaff(session.user.role)) {
    throw new UnauthorizedError("هذا الإجراء متاح لموظفي رمال X فقط");
  }
  return session;
}

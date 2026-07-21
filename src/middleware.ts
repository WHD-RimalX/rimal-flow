import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * حماية على مستوى الصفحات: /dashboard/** مقتصرة حصراً على حسابات ADMIN و RECEPTION
 * (وSUPER_ADMIN كدور أعلى من ADMIN بنفس صلاحياته وأكثر). أي عميل عادي (USER) أو
 * زائر غير مسجل يُمنع من الدخول:
 *   - زائر بلا جلسة إطلاقاً → إعادة توجيه لصفحة تسجيل الدخول (لا يوجد شيء يخوّله بعد).
 *   - مستخدم مسجّل بدور USER → صفحة 403 (/unauthorized) لأنه مسجَّل فعلاً لكن دوره لا يخوّله.
 * ملاحظة: هذا يحمي الواجهة فقط — كل API route يتحقق من الصلاحيات بشكل مستقل
 * (انظر src/lib/session.ts و src/lib/rbac.ts) لأننا لا نثق بالـ Client إطلاقاً.
 */
const DASHBOARD_ALLOWED_ROLES = ["RECEPTION", "ADMIN", "SUPER_ADMIN"];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isDashboardRoute = req.nextUrl.pathname.startsWith("/dashboard");

    if (isDashboardRoute) {
      if (!token) {
        return NextResponse.redirect(new URL("/auth/login", req.url));
      }
      if (!DASHBOARD_ALLOWED_ROLES.includes(token.role as string)) {
        return NextResponse.redirect(new URL("/unauthorized", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: () => true, // نتحقق يدوياً أعلاه لنتحكم بمنطق إعادة التوجيه بدقة
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*"],
};

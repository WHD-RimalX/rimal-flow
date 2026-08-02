import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * حماية على مستوى الصفحات: /dashboard/** و/checkin/** مقتصرة حصراً على حسابات
 * ADMIN و RECEPTION (وSUPER_ADMIN كدور أعلى من ADMIN بنفس صلاحياته وأكثر). أي
 * زائر غير مصرَّح له — سواء بلا جلسة إطلاقاً أو مسجَّل دخوله بدور USER عادي —
 * يُعامَل بنفس الطريقة تماماً: إعادة توجيه لصفحة 403 (/unauthorized)، دون تمييز
 * أو تلميح بوجود صفحة دخول، تعزيزاً للأمان. صفحة الماسح (/checkin) أداة تشغيلية
 * لموظفي الاستقبال فقط الآن — العميل يصل لرمز QR الخاص بحجزه من حسابه مباشرة،
 * وليس عبر هذه الصفحة.
 * ملاحظة: هذا يحمي الواجهة فقط — كل API route يتحقق من الصلاحيات بشكل مستقل
 * (انظر src/lib/session.ts و src/lib/rbac.ts) لأننا لا نثق بالـ Client إطلاقاً.
 */
const STAFF_ONLY_ROLES = ["RECEPTION", "ADMIN", "SUPER_ADMIN"];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isStaffOnlyRoute =
      req.nextUrl.pathname.startsWith("/dashboard") || req.nextUrl.pathname.startsWith("/checkin");

    if (isStaffOnlyRoute) {
      const role = token?.role as string | undefined;
      if (!role || !STAFF_ONLY_ROLES.includes(role)) {
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
  matcher: ["/dashboard/:path*", "/checkin/:path*"],
};

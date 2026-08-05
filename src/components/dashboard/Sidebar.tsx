"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "لوحة اليوم", icon: "🗓️" },
  { href: "/dashboard/calendar", label: "التقويم التفاعلي", icon: "📅" },
  { href: "/dashboard/bookings", label: "سجل الحجوزات", icon: "📋" },
  { href: "/dashboard/subscribers", label: "المشتركون", icon: "👥" },
];

function roleLabel(role: string | undefined) {
  if (role === "SUPER_ADMIN") return "مدير عام";
  if (role === "ADMIN") return "مدير";
  return "موظف استقبال";
}

/** الشريط الجانبي على الشاشات الكبيرة، ويتحول لشريط علوي أفقي على الجوال (Sidebar + DashboardLayout مسؤولان معاً عن التجاوب). */
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <>
      {/* شريط علوي للجوال فقط */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2.5 lg:hidden">
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="رمال X" className="h-7 w-auto" />
        </Link>
        <nav className="flex flex-1 items-center justify-end gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                pathname === item.href ? "bg-rimal-purple-50 text-rimal-purple" : "text-gray-600"
              )}
            >
              {item.icon} {item.label}
            </Link>
          ))}
          <Link
            href="/"
            className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600"
          >
            🏠 الرئيسية
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/auth/login" })}
            className="shrink-0 whitespace-nowrap rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-600"
          >
            خروج
          </button>
        </nav>
      </header>

      {/* الشريط الجانبي للشاشات الكبيرة فقط */}
      <aside className="hidden w-64 shrink-0 flex-col border-l border-gray-200 bg-white lg:flex">
        <div className="border-b border-gray-100 px-5 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="رمال X" className="h-8 w-auto" />
          <p className="mt-2 text-[11px] text-gray-500">مركز العمليات الذكي</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                pathname === item.href
                  ? "bg-rimal-purple-50 text-rimal-purple"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}

          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            <span>🏠</span>
            الصفحة الرئيسية
          </Link>
        </nav>

        <div className="border-t border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-700">{session?.user?.name}</p>
          <p className="text-[11px] text-gray-500">{roleLabel(session?.user?.role)}</p>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/auth/login" })}
            className="mt-3 w-full rounded-xl border-0 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm transition hover:bg-red-50 hover:text-red-600"
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>
    </>
  );
}

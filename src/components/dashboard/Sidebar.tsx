"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "لوحة اليوم", icon: "🗓️" },
  { href: "/dashboard/calendar", label: "التقويم التفاعلي", icon: "📅" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <p className="text-sm font-extrabold text-rimal-purple">رمال فلو</p>
        <p className="text-[11px] text-gray-500">مركز العمليات الذكي</p>
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
      </nav>

      <div className="border-t border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-700">{session?.user?.name}</p>
        <p className="text-[11px] text-gray-500">
          {session?.user?.role === "SUPER_ADMIN"
            ? "مدير عام"
            : session?.user?.role === "ADMIN"
            ? "مدير"
            : "موظف استقبال"}
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/auth/login" })}
          className="mt-3 w-full rounded-xl border-0 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm transition hover:bg-red-50 hover:text-red-600"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}

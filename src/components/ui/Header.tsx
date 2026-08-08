"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();
  const staff = session?.user && session.user.role !== "USER";

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="رمال X" className="h-9 w-auto" />
          <div className="leading-tight">
            <p className="text-sm font-extrabold text-white">رمال فلو</p>
            <p className="text-[11px] text-gray-400">Rimal Flow — رمال X</p>
          </div>
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-gray-300 transition hover:text-rimal-orange">
            الحجز
          </Link>
          {session?.user && !staff && (
            <Link href="/my-bookings" className="text-gray-300 transition hover:text-rimal-orange">
              حجوزاتي
            </Link>
          )}
          {staff && (
            <>
              <Link href="/checkin" className="text-gray-300 transition hover:text-rimal-orange">
                تسجيل الحضور
              </Link>
              <Link href="/dashboard" className="text-gray-300 transition hover:text-rimal-orange">
                لوحة التحكم
              </Link>
            </>
          )}

          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-gray-400 sm:inline">مرحباً، {session.user.name}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:border-white/30"
              >
                تسجيل الخروج
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/auth/login" className="text-gray-300 transition hover:text-rimal-orange">
                تسجيل الدخول
              </Link>
              <Link href="/auth/register" className="btn-accent !px-4 !py-1.5 text-xs">
                إنشاء حساب
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

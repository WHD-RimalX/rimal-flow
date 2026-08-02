"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();
  const staff = session?.user && session.user.role !== "USER";

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="رمال X" className="h-9 w-auto" />
          <div className="leading-tight">
            <p className="text-sm font-extrabold text-rimal-purple">رمال فلو</p>
            <p className="text-[11px] text-gray-500">Rimal Flow — رمال X</p>
          </div>
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-gray-600 transition hover:text-rimal-purple">
            الحجز
          </Link>
          {session?.user && !staff && (
            <Link href="/my-bookings" className="text-gray-600 transition hover:text-rimal-purple">
              حجوزاتي
            </Link>
          )}
          {staff && (
            <>
              <Link href="/checkin" className="text-gray-600 transition hover:text-rimal-purple">
                تسجيل الحضور
              </Link>
              <Link href="/dashboard" className="text-gray-600 transition hover:text-rimal-purple">
                لوحة التحكم
              </Link>
            </>
          )}

          {session?.user ? (
            <div className="flex items-center gap-2">
              <span className="hidden text-gray-500 sm:inline">مرحباً، {session.user.name}</span>
              <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary !px-3 !py-1.5 text-xs">
                تسجيل الخروج
              </button>
            </div>
          ) : (
            <Link href="/auth/login" className="btn-primary !px-4 !py-1.5 text-xs">
              تسجيل الدخول
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

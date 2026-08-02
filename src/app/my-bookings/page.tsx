"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/ui/Header";
import { apiFetch } from "@/lib/api-client";
import { BookingQrCard } from "@/components/booking/BookingQrCard";
import type { BookingDTO } from "@/types";

/** صفحة العميل لعرض حجوزاته ورمز QR الخاص بكل حجز مع الوقت المتبقي بشكل حي. */
export default function MyBookingsPage() {
  const { status } = useSession();
  const [bookings, setBookings] = useState<BookingDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetch<{ bookings: BookingDTO[] }>("/api/bookings")
      .then((data) =>
        setBookings(
          [...data.bookings].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        )
      )
      .catch(() => setError("تعذّر تحميل حجوزاتك"));
  }, [status]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-extrabold text-gray-900">حجوزاتي</h1>
        <p className="mt-1 text-sm text-gray-500">
          رمز QR الخاص بكل حجز ووقته المتبقي — أظهره للاستقبال عند الوصول أو المغادرة.
        </p>

        {status === "loading" ? (
          <p className="mt-6 text-sm text-gray-500">جارِ التحميل...</p>
        ) : status !== "authenticated" ? (
          <div className="card mt-6 text-center">
            <p className="text-sm text-gray-600">يلزم تسجيل الدخول لعرض حجوزاتك.</p>
            <a href="/auth/login" className="btn-primary mt-3 inline-block px-6 py-2 text-sm">
              تسجيل الدخول
            </a>
          </div>
        ) : error ? (
          <p className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : !bookings ? (
          <p className="mt-6 text-sm text-gray-500">جارِ التحميل...</p>
        ) : bookings.length === 0 ? (
          <p className="mt-6 text-sm text-gray-500">لا توجد لديك حجوزات بعد.</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {bookings.map((b) => (
              <BookingQrCard key={b.id} booking={b} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

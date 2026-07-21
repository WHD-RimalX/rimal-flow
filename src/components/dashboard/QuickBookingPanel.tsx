"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatSAR } from "@/lib/utils";
import type { BookingDTO, SpaceDTO, UserSearchResultDTO } from "@/types";

interface QuickBookingPanelProps {
  space: SpaceDTO;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * نافذة تخصيص الحجز اليدوي — تظهر كـ Modal عند اختيار مقعد/مساحة متاحة من خريطة المقر.
 * تتيح لموظف الاستقبال البحث الفوري عن عميل مسجَّل بالاسم أو رقم الجوال وتعيينه مباشرة،
 * أو إدخال بيانات عميل جديد (ضيف) إن لم يكن موجوداً في النظام.
 * قاعدة إلزامية: لا يمكن إنشاء الحجز بدون تحديد مستفيد فعلي (عميل مسجَّل أو ضيف).
 * لا يوجد اختيار لنوع الباقة هنا — هذا تسكين فوري (Walk-in) بواقة الساعة القياسية.
 */
export function QuickBookingPanel({ space, onClose, onCreated }: QuickBookingPanelProps) {
  const [mode, setMode] = useState<"search" | "guest">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResultDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResultDTO | null>(null);

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingDTO | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2 || selectedUser) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      apiFetch<{ users: UserSearchResultDTO[] }>(`/api/users/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => setResults(res.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selectedUser]);

  const studentEligible = Number(space.studentDiscount) > 0;
  const effectiveIsStudent = mode === "search" && selectedUser ? selectedUser.isStudent : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        spaceId: space.id,
        bookingType: "HOURLY",
        startTime: new Date().toISOString(),
      };

      if (mode === "search") {
        if (!selectedUser) {
          setError("يرجى اختيار عميل من نتائج البحث أولاً");
          setSubmitting(false);
          return;
        }
        payload.customerUserId = selectedUser.id;
        payload.isStudent = selectedUser.isStudent;
      } else {
        payload.guestName = guestName;
        payload.guestPhone = guestPhone;
        payload.isStudent = false;
      }

      const res = await apiFetch<{ booking: BookingDTO }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setResult(res.booking);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_20px_60px_rgba(76,53,105,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">تخصيص حجز يدوي — من خريطة المقر</p>
            <h3 className="text-base font-bold text-gray-900">{space.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {result ? (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
            تم تأكيد الحجز بكود <span className="font-mono font-bold">{result.bookingCode}</span> بقيمة{" "}
            {formatSAR(Number(result.finalPrice))}.
            <button onClick={onClose} className="btn-primary mt-4 w-full">
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* التبديل بين البحث عن عميل مسجَّل أو إدخال ضيف جديد */}
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setMode("search")}
                className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                  mode === "search" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
                }`}
              >
                عميل مسجَّل
              </button>
              <button
                type="button"
                onClick={() => setMode("guest")}
                className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                  mode === "guest" ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
                }`}
              >
                عميل جديد (ضيف)
              </button>
            </div>

            {mode === "search" ? (
              <div>
                <label className="label-field">ابحث بالاسم أو رقم الجوال</label>
                {selectedUser ? (
                  <div className="flex items-center justify-between rounded-xl border-0 bg-rimal-purple-50 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{selectedUser.name}</p>
                      <p className="text-xs text-gray-500">
                        {selectedUser.phone ?? selectedUser.email}
                        {selectedUser.isStudent && " · طالب"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(null);
                        setQuery("");
                      }}
                      className="text-xs font-semibold text-gray-400 hover:text-red-600"
                    >
                      إزالة
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="input-field"
                      placeholder="مثال: أحمد أو 05xxxxxxxx"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoFocus
                    />
                    {searching && <p className="mt-1 text-xs text-gray-400">جارِ البحث...</p>}
                    {results.length > 0 && (
                      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-gray-50 p-1.5">
                        {results.map((u) => (
                          <button
                            type="button"
                            key={u.id}
                            onClick={() => setSelectedUser(u)}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm transition hover:bg-white hover:shadow-sm"
                          >
                            <span className="font-medium text-gray-800">{u.name}</span>
                            <span className="text-xs text-gray-400">{u.phone ?? u.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!searching && query.trim().length >= 2 && results.length === 0 && (
                      <p className="mt-1 text-xs text-gray-400">
                        لا توجد نتائج مطابقة — يمكنك التبديل إلى "عميل جديد" لإدخال بياناته
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-field">اسم العميل</label>
                  <input
                    className="input-field"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label-field">رقم الجوال</label>
                  <input
                    className="input-field"
                    placeholder="0512345678"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            {studentEligible && effectiveIsStudent && (
              <p className="rounded-lg bg-rimal-orange-50 px-3 py-2 text-xs text-rimal-orange-600">
                هذا العميل مسجَّل كطالب — سيُطبَّق خصم {Math.round(Number(space.studentDiscount) * 100)}% تلقائياً
              </p>
            )}

            {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

            {space.hourlyPrice && (
              <p className="text-center text-xs text-gray-400">
                تسكين فوري بباقة الساعة — {formatSAR(Number(space.hourlyPrice))}
              </p>
            )}

            <button type="submit" disabled={submitting} className="btn-accent w-full">
              {submitting ? "جارِ التأكيد..." : "تأكيد التخصيص والحجز"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

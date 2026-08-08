"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { UserSearchResultDTO } from "@/types";

export interface CustomerSelection {
  customerUserId?: string;
  guestName?: string;
  guestPhone?: string;
}

type Mode = "self" | "existing" | "guest";

interface CustomerPickerProps {
  /** يُستدعى في كل مرة يتغيّر فيها الاختيار المحلول: null تعني "لنفسي" (الموظف نفسه). */
  onChange: (selection: CustomerSelection | null) => void;
  /** إخفاء تبويب "لنفسي" — تُستخدم في صفحة "الزائرين" حيث كل حجز هناك لعميل آخر إلزامياً. */
  allowSelf?: boolean;
}

/**
 * منتقي "لمن هذا الحجز؟" — لنفسي (الموظف) / عميل مسجَّل (بحث بالاسم أو الجوال) /
 * ضيف walk-in جديد (اسم + جوال بلا حساب). مُشترَك بين صفحة الحجز العادية
 * (تظهر فقط للموظفين) وصفحة "الزائرين" الإدارية لتفادي ازدواج نفس المنطق.
 */
export function CustomerPicker({ onChange, allowSelf = true }: CustomerPickerProps) {
  const [mode, setMode] = useState<Mode>(allowSelf ? "self" : "existing");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserSearchResultDTO[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResultDTO | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  useEffect(() => {
    if (userQuery.trim().length < 2) {
      setUserResults([]);
      return;
    }
    const handle = setTimeout(() => {
      apiFetch<{ users: UserSearchResultDTO[] }>(`/api/users/search?q=${encodeURIComponent(userQuery.trim())}`)
        .then((data) => setUserResults(data.users))
        .catch(() => setUserResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [userQuery]);

  useEffect(() => {
    if (mode === "self") {
      onChange(null);
    } else if (mode === "existing") {
      onChange(selectedUser ? { customerUserId: selectedUser.id } : null);
    } else {
      onChange(guestName.trim() && guestPhone.trim() ? { guestName: guestName.trim(), guestPhone: guestPhone.trim() } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedUser, guestName, guestPhone]);

  return (
    <div>
      <label className="label-field">لمن هذا الحجز؟</label>
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
        {(
          [
            ...(allowSelf ? [{ id: "self" as Mode, label: "لنفسي" }] : []),
            { id: "existing" as Mode, label: "عميل مسجَّل" },
            { id: "guest" as Mode, label: "ضيف walk-in" },
          ]
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setMode(opt.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${
              mode === opt.id ? "bg-white text-rimal-purple shadow-sm" : "text-gray-500"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === "existing" && (
        <div className="mt-3">
          {selectedUser ? (
            <div className="flex items-center justify-between rounded-lg bg-rimal-purple-50 px-3 py-2 text-sm">
              <span className="font-semibold text-gray-800">
                {selectedUser.name} <span className="text-xs text-gray-400">{selectedUser.phone}</span>
              </span>
              <button type="button" onClick={() => setSelectedUser(null)} className="text-xs text-gray-400 hover:text-rimal-purple">
                تغيير
              </button>
            </div>
          ) : (
            <>
              <input
                className="input-field"
                placeholder="ابحث بالاسم أو رقم الجوال"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
              {userResults.length > 0 && (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-gray-50 p-1.5">
                  {userResults.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      onClick={() => {
                        setSelectedUser(u);
                        setUserResults([]);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm transition hover:bg-white hover:shadow-sm"
                    >
                      <span className="font-medium text-gray-800">{u.name}</span>
                      <span className="text-xs text-gray-400">{u.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === "guest" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label-field">اسم الضيف</label>
            <input className="input-field" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
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
    </div>
  );
}

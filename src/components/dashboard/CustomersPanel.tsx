"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatArabicDateTime } from "@/lib/utils";
import type { CustomerDTO } from "@/types";

/** قائمة العملاء المسجَّلين بحساب حقيقي على الموقع (اسم/جوال/بريد) — بحث فوري بأي منها. */
export function CustomersPanel() {
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      apiFetch<{ customers: CustomerDTO[] }>(`/api/admin/customers${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`)
        .then((data) => setCustomers(data.customers))
        .catch(() => setError("تعذّر تحميل قائمة العملاء"))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-700">العملاء المسجَّلون ({customers.length})</h2>
        <input
          type="text"
          placeholder="بحث بالاسم/الجوال/البريد"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 shadow-sm"
        />
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">جارِ التحميل...</p>
      ) : customers.length === 0 ? (
        <p className="text-sm text-gray-500">لا يوجد عملاء مطابقون</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="pb-2 font-medium">الاسم</th>
                <th className="pb-2 font-medium">رقم الجوال</th>
                <th className="pb-2 font-medium">البريد الإلكتروني</th>
                <th className="pb-2 font-medium">تاريخ التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 font-medium text-gray-800">
                    {c.name}
                    {c.isStudent && (
                      <span className="badge mr-2 border-rimal-orange/30 bg-rimal-orange-50 text-rimal-orange-600">طالب</span>
                    )}
                  </td>
                  <td className="py-2.5 text-gray-600">{c.phone ?? "—"}</td>
                  <td className="py-2.5 text-gray-600">{c.email ?? "—"}</td>
                  <td className="py-2.5 text-xs text-gray-400">{formatArabicDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

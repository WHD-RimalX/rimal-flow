"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface FieldErrors {
  [field: string]: string[] | undefined;
}

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    isStudent: false,
    studentIdNumber: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      });

      const res = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      if (res?.error) throw new Error("تم إنشاء الحساب لكن تعذّر تسجيل الدخول تلقائياً");

      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues) {
        // نميّز رسالة كل حقل على حدة (هاتف/إيميل/اسم/كلمة مرور) بدل رسالة عامة واحدة
        const flat = err.issues as { fieldErrors?: FieldErrors; formErrors?: string[] };
        if (flat.fieldErrors && Object.keys(flat.fieldErrors).length > 0) {
          setFieldErrors(flat.fieldErrors);
        } else {
          setFormError(flat.formErrors?.[0] ?? err.message);
        }
      } else {
        setFormError(err instanceof ApiError ? err.message : "حدث خطأ أثناء إنشاء الحساب");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card mx-auto max-w-sm">
      <h1 className="mb-1 text-xl font-extrabold text-gray-900">إنشاء حساب جديد</h1>
      <p className="mb-5 text-sm text-gray-500">انضم إلى رمال فلو وابدأ الحجز الآن</p>

      <label className="label-field">الاسم الكامل</label>
      <input
        className={cn("input-field mb-1", fieldErrors.name && "border-red-400 focus:ring-red-200")}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      {fieldErrors.name?.[0] && <p className="mb-3 text-xs text-red-600">{fieldErrors.name[0]}</p>}
      {!fieldErrors.name && <div className="mb-4" />}

      <label className="label-field">البريد الإلكتروني</label>
      <input
        type="email"
        className={cn("input-field mb-1", fieldErrors.email && "border-red-400 focus:ring-red-200")}
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        required
      />
      {fieldErrors.email?.[0] && <p className="mb-3 text-xs text-red-600">{fieldErrors.email[0]}</p>}
      {!fieldErrors.email && <div className="mb-4" />}

      <label className="label-field">رقم الجوال</label>
      <input
        className={cn("input-field mb-1", fieldErrors.phone && "border-red-400 focus:ring-red-200")}
        placeholder="0512345678"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        required
      />
      {fieldErrors.phone?.[0] && <p className="mb-3 text-xs text-red-600">{fieldErrors.phone[0]}</p>}
      {!fieldErrors.phone && <div className="mb-4" />}

      <label className="label-field">كلمة المرور</label>
      <input
        type="password"
        className={cn("input-field mb-1", fieldErrors.password && "border-red-400 focus:ring-red-200")}
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        required
      />
      {fieldErrors.password?.[0] && <p className="mb-3 text-xs text-red-600">{fieldErrors.password[0]}</p>}
      {!fieldErrors.password && <div className="mb-4" />}

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isStudent}
          onChange={(e) => setForm({ ...form, isStudent: e.target.checked })}
          className="h-4 w-4 accent-rimal-orange"
        />
        أنا طالب (لتفعيل خصم الطلاب على الحجوزات المؤهلة)
      </label>

      {form.isStudent && (
        <input
          className="input-field mb-4"
          placeholder="الرقم الجامعي"
          value={form.studentIdNumber}
          onChange={(e) => setForm({ ...form, studentIdNumber: e.target.value })}
        />
      )}

      {formError && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{formError}</p>}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "جارِ الإنشاء..." : "إنشاء الحساب"}
      </button>

      <p className="mt-4 text-center text-xs text-gray-500">
        لديك حساب بالفعل؟{" "}
        <Link href="/auth/login" className="font-semibold text-rimal-purple">
          تسجيل الدخول
        </Link>
      </p>
    </form>
  );
}

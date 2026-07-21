"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card mx-auto max-w-sm">
      <h1 className="mb-1 text-xl font-extrabold text-gray-900">تسجيل الدخول</h1>
      <p className="mb-5 text-sm text-gray-500">مرحباً بعودتك إلى رمال فلو</p>

      <label className="label-field">البريد الإلكتروني</label>
      <input
        type="email"
        className="input-field mb-4"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      <label className="label-field">كلمة المرور</label>
      <input
        type="password"
        className="input-field mb-4"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "جارِ الدخول..." : "دخول"}
      </button>

      <p className="mt-4 text-center text-xs text-gray-500">
        ليس لديك حساب؟{" "}
        <Link href="/auth/register" className="font-semibold text-rimal-purple">
          إنشاء حساب جديد
        </Link>
      </p>
    </form>
  );
}

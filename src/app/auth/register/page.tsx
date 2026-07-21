import { Header } from "@/components/ui/Header";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <RegisterForm />
      </main>
    </>
  );
}

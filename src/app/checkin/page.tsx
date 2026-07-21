import { Header } from "@/components/ui/Header";
import { CheckInPanel } from "@/components/checkin/CheckInPanel";

export default function CheckInPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <CheckInPanel />
      </main>
    </>
  );
}

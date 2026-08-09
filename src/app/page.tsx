import { Suspense } from "react";
import { Header } from "@/components/ui/Header";
import { BookingExperience } from "@/components/booking/BookingExperience";

export default function HomePage() {
  return (
    <>
      <Header />
      <Suspense fallback={null}>
        <BookingExperience />
      </Suspense>
    </>
  );
}

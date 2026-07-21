"use client";

import { useState } from "react";
import { InteractiveFloorMap } from "@/components/floor-map/InteractiveFloorMap";
import { QuickBookingPanel } from "@/components/dashboard/QuickBookingPanel";
import { LiveAttendeesPanel } from "@/components/dashboard/LiveAttendeesPanel";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { BookingsTable } from "@/components/dashboard/BookingsTable";
import type { SpaceDTO } from "@/types";

export function OperationsDashboard() {
  const [selectedSpace, setSelectedSpace] = useState<SpaceDTO | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">لوحة اليوم</h1>
        <p className="text-sm text-gray-500">
          Timeline Command Center — نظرة لحظية على كل عمليات رمال فلو
        </p>
      </div>

      <InteractiveFloorMap onSelectSpace={setSelectedSpace} />

      {selectedSpace && (
        <QuickBookingPanel
          space={selectedSpace}
          onClose={() => setSelectedSpace(null)}
          onCreated={() => {
            setRefreshSignal((n) => n + 1);
            setSelectedSpace(null);
          }}
        />
      )}

      <LiveAttendeesPanel refreshSignal={refreshSignal} />
      <StatsCards />
      <BookingsTable refreshSignal={refreshSignal} />
    </div>
  );
}

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "seatIndex" INTEGER;

-- CreateIndex
CREATE INDEX "bookings_spaceId_seatIndex_idx" ON "bookings"("spaceId", "seatIndex");

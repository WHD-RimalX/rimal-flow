-- AlterTable: add nullable first so it can be backfilled on rows that already exist
ALTER TABLE "bookings" ADD COLUMN "qrToken" TEXT;

-- Backfill existing rows with a value derived from their own already-unique id
-- (avoids depending on a specific Postgres extension like pgcrypto for gen_random_uuid()).
UPDATE "bookings" SET "qrToken" = 'legacy-' || "id" WHERE "qrToken" IS NULL;

-- Now that every row has a value, enforce NOT NULL
ALTER TABLE "bookings" ALTER COLUMN "qrToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_qrToken_key" ON "bookings"("qrToken");

-- AlterTable
ALTER TABLE "check_in_logs" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "check_in_logs_idempotencyKey_key" ON "check_in_logs"("idempotencyKey");

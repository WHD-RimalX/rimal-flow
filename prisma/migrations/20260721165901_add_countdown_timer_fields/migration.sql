-- AlterTable
ALTER TABLE "check_in_logs" ADD COLUMN     "actualStartTime" TIMESTAMP(3),
ADD COLUMN     "bufferEndsAt" TIMESTAMP(3),
ADD COLUMN     "expectedEndTime" TIMESTAMP(3);

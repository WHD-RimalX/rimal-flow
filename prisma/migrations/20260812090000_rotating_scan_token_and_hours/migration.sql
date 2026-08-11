-- رمز المسح المؤقت (Rotating QR) بديلاً عن رمز QR الثابت الدائم:
-- الرمز الثابت كان صالحاً طوال عمر الحجز، فلقطة شاشة واحدة تكفي لانتحاله للأبد.
-- البديل: رمز عشوائي قصير العمر يُولَّد عند الطلب ويُستهلَك ذرياً عند أول مسح.
ALTER TABLE "bookings" ADD COLUMN "scanToken" TEXT;
ALTER TABLE "bookings" ADD COLUMN "scanTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "bookings_scanToken_key" ON "bookings"("scanToken");

-- ساعات الدوام الجديدة: الأحد–الخميس 8ص–10م (14 ساعة)، السبت 9ص–10م (13 ساعة)،
-- والجمعة إجازة أسبوعية (تُحذَف من الخريطة تماماً فتُعامَل كيوم مغلق).
-- تُطبَّق على كل المساحات القائمة حتى لا تبقى بيانات توفّر قديمة تناقض ساعات
-- المقر المفروضة في الكود (src/lib/business-hours.ts).
UPDATE "spaces"
SET "weeklyAvailability" = jsonb_build_object(
  'sun', jsonb_build_object('open', '08:00', 'close', '22:00'),
  'mon', jsonb_build_object('open', '08:00', 'close', '22:00'),
  'tue', jsonb_build_object('open', '08:00', 'close', '22:00'),
  'wed', jsonb_build_object('open', '08:00', 'close', '22:00'),
  'thu', jsonb_build_object('open', '08:00', 'close', '22:00'),
  'sat', jsonb_build_object('open', '09:00', 'close', '22:00')
);

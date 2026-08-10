-- SECURITY-AUDIT(V2).md §2 (FLOW-X01): توكنات "legacy-<bookingId>" من الترحيل
-- التاريخي 20260802174908_add_booking_qr_token كانت قيماً قابلة للتخمين المباشر
-- من معرّف الحجز المعروف (Predictable credential). عولجت يدوياً مرة واحدة على
-- قاعدة الإنتاج، لكن بلا أثر قابل للتكرار في الكود — أي بيئة تُبنى من الصفر
-- (محلية جديدة، staging) عبر تشغيل كل المهاجرات تعيد إنتاج نفس التوكنات القابلة
-- للتخمين. هذه المهاجرة تدوّر أي توكن متبقٍ يطابق النمط 'legacy-%' بقيمة عشوائية
-- مشفَّرة (UUID v4 عبر pgcrypto)، وآمنة لإعادة التشغيل (WHERE يطابق فقط القيم
-- المتبقية غير المدوَّرة بعد — لا تأثير إن لم يوجد أي توكن legacy أصلاً).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "bookings"
SET "qrToken" = gen_random_uuid()::text
WHERE "qrToken" LIKE 'legacy-%';

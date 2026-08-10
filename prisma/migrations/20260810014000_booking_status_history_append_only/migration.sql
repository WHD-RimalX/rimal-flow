-- SECURITY-AUDIT(V2).md §3 (FLOW-C03): "booking_status_history" جدول تدقيق
-- عادي قابل للتعديل/الحذف بـ UPDATE/DELETE من أي اتصال بصلاحيات كافية على
-- القاعدة (تجاوز تام لتطبيقنا نفسه، عبر أي أداة إدارة قاعدة بيانات مباشرة).
-- Trigger على مستوى قاعدة البيانات نفسها يرفض أي UPDATE أو DELETE على هذا
-- الجدول تحديداً بصرف النظر عن الطرف المنفِّذ — الإدراج (INSERT) فقط مسموح،
-- وهو كل ما يحتاجه recordStatusTransition أصلاً.
CREATE OR REPLACE FUNCTION prevent_booking_status_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'booking_status_history append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_status_history_no_update
BEFORE UPDATE ON "booking_status_history"
FOR EACH ROW EXECUTE FUNCTION prevent_booking_status_history_mutation();

CREATE TRIGGER booking_status_history_no_delete
BEFORE DELETE ON "booking_status_history"
FOR EACH ROW EXECUTE FUNCTION prevent_booking_status_history_mutation();

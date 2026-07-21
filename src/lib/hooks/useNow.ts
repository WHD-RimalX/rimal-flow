"use client";

import { useEffect, useState } from "react";

/** يُعيد الوقت الحالي (Date.now()) ويعيد الرسم كل intervalMs — يُستخدم لتشغيل المؤقتات الحية محلياً بدون طلبات شبكة إضافية. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}

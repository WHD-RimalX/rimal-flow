"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface QrScannerProps {
  onScan: (value: string) => void;
}

type ScannerStatus = "requesting" | "scanning" | "error";

/**
 * ماسح QR حقيقي عبر كاميرا الجهاز (Web Cam API) — يعمل محلياً على localhost
 * بدون الحاجة لنشر الموقع، لأن المتصفحات تعامل localhost كسياق آمن (secure context)
 * حتى بدون HTTPS. يلتقط إطارات الفيديو ويحلّلها بمكتبة jsQR بحثاً عن رمز QR.
 */
export function QrScanner({ onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [status, setStatus] = useState<ScannerStatus>("requesting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code?.data) {
        onScanRef.current(code.data);
        return; // نوقف الحلقة بعد أول مسح ناجح
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");
        tick();
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("تعذّر الوصول إلى الكاميرا — تأكد من منح إذن الكاميرا للمتصفح");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (status === "error") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-2xl bg-gray-900 p-4 text-center text-xs text-white/70">
        <p>{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black shadow-inner">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
      {status === "requesting" && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-xs text-white">
          جارِ طلب إذن الكاميرا...
        </div>
      )}
      <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/50" />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

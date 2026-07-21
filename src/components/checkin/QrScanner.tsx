"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface QrScannerProps {
  onScan: (value: string) => void;
}

type ScannerStatus = "requesting" | "scanning" | "error";

/** يترجم أخطاء getUserMedia الشائعة على الجوال لرسالة عربية مفهومة. */
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح لهذا الموقع ثم أعد المحاولة";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "لم يتم العثور على كاميرا في هذا الجهاز";
    case "NotReadableError":
    case "TrackStartError":
      return "الكاميرا مستخدَمة حالياً من تطبيق آخر — أغلق أي تطبيق آخر يستخدمها وأعد المحاولة";
    case "OverconstrainedError":
      return "تعذّر ضبط إعدادات الكاميرا الخلفية — جارٍ المحاولة بإعدادات أبسط";
    default:
      return "تعذّر الوصول إلى الكاميرا — تأكد من منح الإذن وحاول مجدداً";
  }
}

/**
 * ماسح QR حقيقي عبر كاميرا الجهاز (Web Cam API) — يعمل محلياً على localhost
 * بدون الحاجة لنشر الموقع، لأن المتصفحات تعامل localhost كسياق آمن (secure context)
 * حتى بدون HTTPS، وكذلك بعد النشر عبر HTTPS من متصفح الجوال مباشرة.
 * يلتقط إطارات الفيديو ويحلّلها بمكتبة jsQR بحثاً عن رمز QR.
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("requesting");
    setErrorMessage(null);

    function stopStream() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    function handleTrackEnded() {
      // انقطاع غير متوقع لتغذية الكاميرا (مثال: تطبيق آخر استحوذ عليها) — نعرض حالة خطأ بدل شاشة سوداء جامدة
      if (!cancelled) {
        setStatus("error");
        setErrorMessage("توقفت تغذية الكاميرا فجأة — اضغط إعادة المحاولة");
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code?.data) {
          onScanRef.current(code.data);
          return; // نوقف الحلقة بعد أول مسح ناجح
        }
      } catch {
        // تجاهل فشل قراءة إطار منفرد (مثال: تغيّر أبعاد الفيديو لحظياً) وتابع المحاولة
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    async function start(constraints: MediaStreamConstraints) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", handleTrackEnded));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!cancelled) {
        setStatus("scanning");
        tick();
      }
    }

    async function run() {
      // نطلب دقة أعلى ومربّعة قدر الإمكان لتسهيل قراءة الرمز، مع تفضيل الكاميرا الخلفية
      const preferred: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      };
      try {
        await start(preferred);
      } catch (err) {
        // بعض أجهزة الجوال ترفض قيوداً دقيقة كهذه — نعيد المحاولة بإعدادات أبسط قبل الاستسلام
        try {
          await start({ video: true, audio: false });
        } catch (fallbackErr) {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(describeCameraError(fallbackErr ?? err));
          }
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopStream();
    };
  }, [attempt]);

  if (status === "error") {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl bg-gray-900 p-4 text-center text-sm text-white/80">
        <p>{errorMessage}</p>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full max-w-sm mx-auto overflow-hidden rounded-2xl bg-black shadow-inner">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
      {status === "requesting" && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-xs text-white">
          جارِ طلب إذن الكاميرا...
        </div>
      )}
      {status === "scanning" && (
        <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs font-semibold text-white drop-shadow">
          قرّب رمز QR من الإطار
        </p>
      )}
      <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/60" />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

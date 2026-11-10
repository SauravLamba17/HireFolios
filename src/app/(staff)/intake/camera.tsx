"use client";

import { useEffect, useRef, useState } from "react";

export type Shot = { blob: Blob; url: string };

class BlankImage extends Error {}

/** True when the picture is one flat colour: no frame painted yet, camera warming up, or lens covered. */
function isBlank(c: HTMLCanvasElement) {
  const t = document.createElement("canvas");
  t.width = t.height = 32;
  const ctx = t.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return max - min < 6;
}

const BLANK_MESSAGE = "The picture came out blank. Check nothing covers the camera, wait a second and try again.";

/**
 * Draws an image or video frame as a JPEG. `portrait` crops the centre to 3:4 (face photo).
 * Canvas output is never mirrored, even though the live front-camera preview is.
 */
async function renderJpeg(src: CanvasImageSource, sw: number, sh: number, maxLong: number, portrait: boolean): Promise<Blob> {
  let sx = 0, sy = 0, w = sw, h = sh;
  if (portrait) {
    if (w / h > 3 / 4) {
      const nw = (h * 3) / 4;
      sx = (w - nw) / 2;
      w = nw;
    } else {
      const nh = (w * 4) / 3;
      sy = (h - nh) / 2;
      h = nh;
    }
  }
  const scale = Math.min(1, maxLong / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(src, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  if (isBlank(canvas)) throw new BlankImage();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not create the image");
  return blob;
}

/** A photo picked or taken with the camera app → resized JPEG. */
export async function fileToJpeg(file: Blob, maxLong: number, portrait = false): Promise<Blob> {
  const bmp = await createImageBitmap(file); // applies the photo's EXIF rotation
  try {
    return await renderJpeg(bmp, bmp.width, bmp.height, maxLong, portrait);
  } finally {
    bmp.close();
  }
}

type CamState = "starting" | "live" | "insecure" | "denied" | "failed";

type FrameGrabber = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => FrameGrabber;

/**
 * Latest camera frame straight from the track (Chrome / Android Chrome: ImageCapture), so a capture
 * doesn't depend on the <video> preview having painted. Null where the API is missing.
 */
async function grabFrame(v: HTMLVideoElement): Promise<ImageBitmap | null> {
  const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  const track = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!IC || !track || track.readyState !== "live") return null;
  // grabFrame waits for the next frame; a stalled camera must not freeze the button.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  const frame = new IC(track).grabFrame().catch(() => null);
  const first = await Promise.race([frame, timeout]);
  if (!first) void frame.then((f) => f?.close()); // a late frame is dropped
  return first;
}

/**
 * Live camera with a capture button. Falls back to the phone's camera app (file input with
 * `capture`) when the page is not on HTTPS, the camera is blocked, or it fails to start.
 */
export function Camera({
  facing,
  maxLong,
  portrait = false,
  captureLabel,
  disabled,
  onCapture,
}: {
  facing: "user" | "environment";
  maxLong: number;
  portrait?: boolean;
  captureLabel: string;
  disabled?: boolean;
  onCapture: (blob: Blob) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CamState>("starting");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blanks = useRef(0);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("insecure"); // browsers only allow the camera on https:// (or localhost)
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState("starting");
    // Still not live after 8 s: give HR the retry button and the camera-app fallback.
    const watchdog = setTimeout(() => setState((st) => (st === "starting" ? "failed" : st)), 8000);
    (async () => {
      // Switching cameras (back → front) can fail while the previous stream is still being
      // released, so retry a few times before giving up.
      for (let tries = 1; ; tries++) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          if (video.current) {
            video.current.srcObject = s;
            await video.current.play().catch(() => {});
          }
          return; // "live" is set once the video knows its size (onLoadedMetadata)
        } catch (e) {
          if (cancelled) return;
          const name = (e as { name?: string })?.name;
          if (name === "NotAllowedError" || name === "SecurityError") return setState("denied");
          if (tries >= 4) return setState("failed");
          await new Promise((r) => setTimeout(r, 500 * tries));
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      stream?.getTracks().forEach((t) => t.stop()); // camera light goes off when leaving the step
    };
  }, [facing, attempt]);

  async function capture() {
    const v = video.current;
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      const frame = await grabFrame(v);
      let blob: Blob;
      if (frame) {
        try {
          blob = await renderJpeg(frame, frame.width, frame.height, maxLong, portrait);
        } finally {
          frame.close();
        }
      } else if (v.videoWidth) {
        blob = await renderJpeg(v, v.videoWidth, v.videoHeight, maxLong, portrait);
      } else {
        setError("The camera is not ready yet. Wait a moment and tap again.");
        setBusy(false);
        return;
      }
      onCapture(blob);
      blanks.current = 0;
    } catch (e) {
      if (!(e instanceof BlankImage)) setError("Could not take the picture. Try again.");
      else if (++blanks.current < 2) setError(BLANK_MESSAGE);
      else {
        // Two black frames in a row: the stream is stuck, so open the camera again.
        blanks.current = 0;
        setError("The camera was restarted. Try again in a moment.");
        setAttempt((a) => a + 1);
      }
    }
    setBusy(false);
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onCapture(await fileToJpeg(file, maxLong, portrait));
    } catch (e) {
      setError(e instanceof BlankImage ? BLANK_MESSAGE : "That file is not a photo this browser can read. Take it again.");
    }
    setBusy(false);
  }

  const fallback = state !== "live" && state !== "starting";
  return (
    <div className="space-y-3">
      {state === "insecure" && (
        <p role="alert" className="alert-error">
          Camera needs HTTPS — open the https:// address of this app. Until then, use the button below to take the picture with the camera app.
        </p>
      )}
      {state === "denied" && (
        <p role="alert" className="alert-error">
          The camera is blocked for this site. Allow it in the browser&apos;s site settings and reopen this step, or use the button below.
        </p>
      )}
      {state === "failed" && (
        <div role="alert" className="alert-error space-y-2">
          <p>The camera could not start (another app may be using it). Try again, or use the button below to take the picture with the camera app.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
            Try the camera again
          </button>
        </div>
      )}

      {!fallback && (
        <div className={`relative mx-auto overflow-hidden rounded-xl bg-slate-900 ${portrait ? "aspect-[3/4] max-w-sm" : "aspect-[4/3] w-full"}`}>
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={() => setState("live")}
            aria-label="Camera preview"
            className={`h-full w-full ${portrait ? "object-cover -scale-x-100" : "object-contain"}`}
          />
          {portrait && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-[12%_14%] rounded-[50%] border-4 border-dashed border-white/80" />
          )}
          {state === "starting" && <p className="absolute inset-0 grid place-items-center text-white">Starting camera…</p>}
        </div>
      )}

      {error && <p role="alert" className="alert-error">{error}</p>}

      {fallback ? (
        <label className={`btn btn-primary h-14 w-full text-lg ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Processing…" : `${captureLabel} with camera app`}
          <input
            type="file"
            accept="image/*"
            capture={facing}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => {
              void fromFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <button type="button" onClick={capture} disabled={disabled || busy || state !== "live"} className="btn btn-primary h-14 w-full text-lg">
          {busy ? "Processing…" : captureLabel}
        </button>
      )}
    </div>
  );
}

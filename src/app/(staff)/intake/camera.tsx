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
 * Canvas output is never mirrored, even though the live webcam preview for the face photo is.
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

/** A picture file chosen by HR → resized JPEG. */
export async function fileToJpeg(file: Blob, maxLong: number, portrait = false): Promise<Blob> {
  const bmp = await createImageBitmap(file); // applies the photo's EXIF rotation
  try {
    return await renderJpeg(bmp, bmp.width, bmp.height, maxLong, portrait);
  } finally {
    bmp.close();
  }
}

type CamState = "starting" | "live" | "insecure" | "denied" | "nocam" | "unplugged" | "failed";

type FrameGrabber = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => FrameGrabber;

/**
 * Latest camera frame straight from the track (Chrome / Edge: ImageCapture), so a capture
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

// The webcam chosen on this PC (HR desk) is remembered in this browser only.
const WEBCAM_KEY = "hf-webcam";
const readChoice = () => {
  try {
    return localStorage.getItem(WEBCAM_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveChoice = (id: string) => {
  try {
    if (id) localStorage.setItem(WEBCAM_KEY, id);
    else localStorage.removeItem(WEBCAM_KEY);
  } catch {
    // storage blocked: the browser's default webcam is used
  }
};

const MESSAGES: Partial<Record<CamState, string>> = {
  insecure: "The webcam needs the secure address of this app (https://…). Open that address, or upload a photo file below.",
  denied: "The browser is blocking the webcam for this site. Click the camera icon in the address bar, choose Allow, then press Try again. Or upload a photo file below.",
  nocam: "No webcam found. Plug in a USB webcam and press Try again, or upload a photo file below.",
  unplugged: "The webcam was disconnected. Plug it back in and press Try again.",
  failed: "The webcam could not start (another program may be using it). Close that program and press Try again, or upload a photo file below.",
};

/**
 * Webcam with a picker (remembered per PC), a capture button and an "upload a photo file" fallback.
 * `guide`: "face" = oval in a 3:4 frame (preview mirrored like a mirror; the saved photo is not);
 * "document" = a page outline for paper CVs.
 */
export function Camera({
  maxLong,
  guide,
  captureLabel,
  uploadLabel,
  disabled,
  autoFocusCapture,
  onCapture,
}: {
  maxLong: number;
  guide: "face" | "document";
  captureLabel: string;
  uploadLabel: string;
  disabled?: boolean;
  /** Put the keyboard on "Take photo" once the webcam is live (Enter takes the picture). */
  autoFocusCapture?: boolean;
  onCapture: (blob: Blob) => void;
}) {
  const captureBtn = useRef<HTMLButtonElement>(null);
  const portrait = guide === "face";
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CamState>("starting");
  const [attempt, setAttempt] = useState(0);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blanks = useRef(0);

  useEffect(() => setDeviceId(readChoice()), []);
  useEffect(() => {
    if (autoFocusCapture && state === "live" && captureBtn.current?.offsetParent) captureBtn.current.focus();
  }, [autoFocusCapture, state]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("insecure"); // browsers only allow the webcam on https:// (or localhost)
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState("starting");
    // Still not live after 8 s: offer Try again and the upload.
    const watchdog = setTimeout(() => setState((st) => (st === "starting" ? "failed" : st)), 8000);
    const listDevices = async () => {
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const cams = all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Webcam ${i + 1}` }));
      if (!cancelled) setDevices(cams);
      return cams;
    };
    (async () => {
      // Before permission, browsers may hide devices; getUserMedia's NotFoundError decides "no webcam".
      const cams = await listDevices();
      const wanted = deviceId && cams.some((c) => c.id === deviceId) ? deviceId : "";
      for (let tries = 1; ; tries++) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { ...(wanted ? { deviceId: { exact: wanted } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          s.getVideoTracks()[0]?.addEventListener("ended", () => !cancelled && setState("unplugged"));
          if (video.current) {
            video.current.srcObject = s;
            await video.current.play().catch(() => {});
          }
          await listDevices(); // labels are visible once permission is given
          return; // "live" is set once the video knows its size (onLoadedMetadata)
        } catch (e) {
          if (cancelled) return;
          const name = (e as { name?: string })?.name;
          if (name === "NotAllowedError" || name === "SecurityError") return setState("denied");
          if (name === "OverconstrainedError" || (name === "NotFoundError" && cams.length === 0)) return setState("nocam");
          // NotReadableError, or NotFoundError while webcams are listed: the previous step (or another
          // program) may still be releasing it; retry a few times.
          if (tries >= 4) return setState("failed");
          await new Promise((r) => setTimeout(r, 500 * tries));
          if (cancelled) return;
        }
      }
    })();
    const onDeviceChange = () => void listDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
      stream?.getTracks().forEach((t) => t.stop()); // webcam light goes off when leaving the step
    };
  }, [deviceId, attempt]);

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
        setError("The webcam is not ready yet. Wait a moment and try again.");
        setBusy(false);
        return;
      }
      onCapture(blob);
      blanks.current = 0;
    } catch (e) {
      if (!(e instanceof BlankImage)) setError("Could not take the picture. Try again.");
      else if (++blanks.current < 2) setError(BLANK_MESSAGE);
      else {
        // Two black frames in a row: the stream is stuck, so open the webcam again.
        blanks.current = 0;
        setError("The webcam was restarted. Try again in a moment.");
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
      setError(e instanceof BlankImage ? BLANK_MESSAGE : "That file is not a picture this browser can read (use JPEG or PNG).");
    }
    setBusy(false);
  }

  const showVideo = state === "live" || state === "starting";
  const problem = MESSAGES[state];
  return (
    <div className="space-y-3">
      {devices.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="webcam" className="text-sm font-medium text-slate-700">Webcam</label>
          <select
            id="webcam"
            value={deviceId && devices.some((d) => d.id === deviceId) ? deviceId : ""}
            onChange={(e) => {
              saveChoice(e.target.value);
              setDeviceId(e.target.value);
            }}
            className="input h-10 w-auto min-w-64"
          >
            <option value="">Browser default</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
      )}

      {problem && (
        <div role="alert" className="alert-error space-y-2">
          <p>{problem}</p>
          {state !== "insecure" && (
            <button type="button" className="btn btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          )}
        </div>
      )}

      {showVideo && (
        <div className={`relative mx-auto overflow-hidden rounded-xl bg-slate-900 ${portrait ? "aspect-[3/4] max-h-[60vh] max-w-sm" : "aspect-video max-h-[60vh] w-full"}`}>
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={() => setState("live")}
            aria-label="Webcam preview"
            className={`h-full w-full ${portrait ? "-scale-x-100 object-cover" : "object-contain"}`}
          />
          {guide === "face" && <div aria-hidden="true" className="pointer-events-none absolute inset-[12%_14%] rounded-[50%] border-4 border-dashed border-white/80" />}
          {guide === "document" && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-[5%] left-1/2 aspect-[1/1.414] -translate-x-1/2 rounded border-4 border-dashed border-white/80" />
          )}
          {state === "starting" && <p className="absolute inset-0 grid place-items-center text-white">Starting webcam…</p>}
        </div>
      )}

      {error && <p role="alert" className="alert-error">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {showVideo && (
          <button ref={captureBtn} type="button" onClick={capture} disabled={disabled || busy || state !== "live"} className="btn btn-primary h-14 flex-1 text-lg">
            {busy ? "Processing…" : captureLabel}
          </button>
        )}
        <label className={`btn btn-secondary h-14 ${showVideo ? "" : "flex-1"} ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}>
          {uploadLabel}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || busy}
            data-testid="camera-upload"
            onChange={(e) => {
              void fromFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

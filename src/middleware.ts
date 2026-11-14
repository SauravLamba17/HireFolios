// Security headers on every response (Phase 5, internet-facing). Pages get a Content-Security-Policy with a fresh nonce
// per request (Next.js puts it on its own scripts), so injected scripts cannot run; nothing may frame the app; HTTPS is
// pinned with HSTS when the request came over HTTPS (Caddy). API responses get the same headers without the page CSP
// (files and logos set their own). Runs in the edge runtime: it reads the few S3 values it needs from process.env
// directly (src/lib/config.ts validates them at start-up).
import { NextResponse, type NextRequest } from "next/server";

/** Origin of the S3 endpoint the browser is sent to when S3_SIGNED_URLS=on (images load from there). */
function signedUrlOrigin() {
  const e = process.env;
  if (e.STORAGE_DRIVER !== "s3" || e.S3_SIGNED_URLS !== "on" || !e.S3_BUCKET) return "";
  if (e.S3_ENDPOINT) return new URL(e.S3_ENDPOINT).origin;
  return `https://${e.S3_BUCKET}.s3.${e.S3_REGION || "ap-south-1"}.amazonaws.com`;
}

export function contentSecurityPolicy(nonce: string, dev: boolean, s3Origin = "") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React style attributes (bar widths, positions)
    `img-src 'self' data: blob:${s3Origin ? ` ${s3Origin}` : ""}`, // webcam captures are blob:/data:
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const https = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development", signedUrlOrigin());

  const requestHeaders = new Headers(req.headers);
  if (!isApi) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp); // Next.js reads the nonce from here
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (!isApi) res.headers.set("content-security-policy", csp);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("referrer-policy", "same-origin");
  res.headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  if (https) res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return res;
}

export const config = {
  // everything except Next.js's own static files (content-hashed, served before middleware would add value)
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};

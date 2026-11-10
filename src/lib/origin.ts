/**
 * The origin the browser used to reach this server: localhost, the office PC's LAN IP
 * (which DHCP may change) or its name. A same-origin request's Origin header equals this;
 * a cross-site request's never does.
 */
export function requestOrigin(req: Request): string | null {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return null;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  return `${proto}://${host}`;
}

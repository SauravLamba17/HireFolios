// Client addresses and the office IP allow-list (pure, unit-tested). Browser-safe: the Settings form checks entries too.
//
// Both deployments put Caddy in front of the app (office PC and AWS). Caddy drops X-Forwarded-For sent by the client and
// writes the real address, so the LAST entry is the one Caddy saw. Reaching the app port directly (dev, a LAN test)
// gives no header: the address is unknown, and an enabled allow-list then refuses (fails closed).

/** The client's IP from the request headers, or null when there is no proxy in front. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  const ip = last ?? headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  return ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1"); // IPv4 mapped into IPv6
}

const v4 = (ip: string) => {
  const p = ip.split(".");
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return p.reduce((n, x) => n * 256 + Number(x), 0);
};

/** One allow-list entry: an IPv4 address, an IPv4 range like 203.0.113.0/24, or an exact IPv6 address. */
export function validEntry(entry: string) {
  const e = entry.trim();
  if (!e) return false;
  const [ip, bits, extra] = e.split("/");
  if (extra !== undefined) return false;
  if (v4(ip) !== null) return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  return bits === undefined && /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
}

/** True when `ip` matches any entry. Unknown address: false. */
export function ipAllowed(ip: string | null, entries: string[]) {
  if (!ip) return false;
  const n = v4(ip);
  return entries.some((raw) => {
    const [addr, bits] = raw.trim().split("/");
    if (n === null || v4(addr) === null) return addr.toLowerCase() === ip.toLowerCase();
    const b = bits === undefined ? 32 : Number(bits);
    if (b === 0) return true;
    const mask = 2 ** 32 - 2 ** (32 - b);
    return (n & mask) >>> 0 === (v4(addr)! & mask) >>> 0;
  });
}

/** Lines from the Settings form → clean entries (blank lines and comments after # removed). */
export const parseAllowList = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);

// ---------- a small in-memory rate limiter (API requests per signed-in person) ----------

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  /** Records a hit; false when `key` is over the limit in the current window. */
  hit(key: string, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k); // forget idle keys
    return recent.length <= this.max;
  }
}

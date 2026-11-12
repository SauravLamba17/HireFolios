// Supported browsers: Google Chrome and Microsoft Edge (both Chromium). Pure: used by the browser notice and tests.
// Other Chromium browsers are let through (same engine, the webcam works); Firefox, Safari and old browsers are not.
export type BrowserInfo = { userAgent: string; brands?: { brand: string; version: string }[] };

export function isSupportedBrowser({ userAgent, brands }: BrowserInfo): boolean {
  if (brands?.length) return brands.some((b) => /Chrom|Edge/i.test(b.brand) && Number(b.version) >= 120);
  const m = /(?:Chrome|Edg)\/(\d+)/.exec(userAgent);
  return Boolean(m) && !/Firefox|FxiOS/.test(userAgent) && Number(m![1]) >= 120;
}

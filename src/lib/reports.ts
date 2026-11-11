// Report maths (pure, unit-tested). The SQL is in the reports page; every number comes from real rows.

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;

const toDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => toDay(new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS));
// A real calendar day (2026-02-30 would silently roll over into March, so compare after a round trip).
const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && toDay(new Date(`${v}T00:00:00Z`)) === v;

/** Range from the URL (IST calendar days). Default: the last 30 days up to today. Bad or reversed input falls back. */
export function parseRange(params: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const to = isDay(params.to) && params.to <= today ? params.to : today;
  let from = isDay(params.from) && params.from <= to ? params.from : addDays(to, -29);
  if (daysBetween(from, to).length > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to };
}

/** Every day from..to inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** One value per day, zero where there were no rows. */
export function fillDays(from: string, to: string, rows: { day: string; n: number }[]) {
  const map = new Map(rows.map((r) => [r.day, Number(r.n)]));
  return daysBetween(from, to).map((day) => ({ day, n: map.get(day) ?? 0 }));
}

/** Percentage rounded to a whole number, or null when there is nothing to divide by. */
export const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function minutesLabel(m: number | null) {
  if (m === null || !Number.isFinite(m)) return "—";
  const total = Math.round(m);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** Bars scaled to the largest value (0–100 %), so the longest bar fills the row. */
export function barWidths<T extends { n: number }>(rows: T[]) {
  const max = Math.max(0, ...rows.map((r) => r.n));
  return rows.map((r) => ({ ...r, pct: max ? Math.round((r.n / max) * 100) : 0 }));
}

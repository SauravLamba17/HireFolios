// All dates shown to staff are Indian Standard Time (CLAUDE.md hard rule 7). The one place for the zone: a code
// constant, not a setting, until the SaaS phase makes it per tenant (tenants.time_zone is already stored).
export const APP_TIME_ZONE = "Asia/Kolkata";
export const APP_UTC_OFFSET = "+05:30"; // IST has no daylight saving
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const formatDateIST = (d: Date) => dateFmt.format(d);

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }); // YYYY-MM-DD

/** Today's calendar date in India, as YYYY-MM-DD (token day, age checks). */
export const todayIST = (now = new Date()) => dayFmt.format(now);

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatDateTimeIST = (d: Date) => dateTimeFmt.format(d);

/** A stored IST calendar day (YYYY-MM-DD) shown like formatDateIST. */
export const formatDayIST = (day: string) => formatDateIST(new Date(`${day}T00:00:00${APP_UTC_OFFSET}`));

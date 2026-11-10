// All dates shown to staff are Indian Standard Time.
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const formatDateIST = (d: Date) => dateFmt.format(d);

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

/** Today's calendar date in India, as YYYY-MM-DD (token day, age checks). */
export const todayIST = (now = new Date()) => dayFmt.format(now);

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatDateTimeIST = (d: Date) => dateTimeFmt.format(d);

/** A stored IST calendar day (YYYY-MM-DD) shown like formatDateIST. */
export const formatDayIST = (day: string) => formatDateIST(new Date(`${day}T00:00:00+05:30`));

// All dates shown to staff are Indian Standard Time.
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const formatDateIST = (d: Date) => dateFmt.format(d);

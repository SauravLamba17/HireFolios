"use client";

import { useEffect, useState } from "react";

/** "12 min" since a server timestamp, ticking every 15 s. */
export function Elapsed({ since, suffix = "" }: { since: string; suffix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  return (
    <span suppressHydrationWarning>
      {min < 1 ? "<1" : min} min{suffix}
    </span>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span suppressHydrationWarning>
      {now?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) ?? ""}
    </span>
  );
}

/** Soft two-note chime when a new call appears. Muted until someone turns it on (browsers need a tap). */
export function Chime({ latestCallId }: { latestCallId: string | null }) {
  const [on, setOn] = useState(false);
  const last = useRef(latestCallId);
  const ctx = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setOn(localStorage.getItem("tv-chime") === "on");
    } catch {
      // storage blocked: stays muted
    }
  }, []);

  useEffect(() => {
    if (latestCallId && latestCallId !== last.current && on && ctx.current) {
      const ac = ctx.current;
      [660, 880].forEach((hz, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        const t = ac.currentTime + i * 0.35;
        o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + 0.65);
      });
    }
    last.current = latestCallId;
  }, [latestCallId, on]);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        if (next) ctx.current ??= new AudioContext();
        setOn(next);
        try {
          localStorage.setItem("tv-chime", next ? "on" : "off");
        } catch {
          // ignore
        }
      }}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-lg text-slate-700"
    >
      {on ? "🔔 Chime on" : "🔕 Chime off"}
    </button>
  );
}

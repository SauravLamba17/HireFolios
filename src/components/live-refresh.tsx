"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5000;

/**
 * Keeps a server-rendered page live: listens to /api/live (Server-Sent Events, tenant-scoped pings) and
 * re-renders on each change. While the stream is down it polls every 5 s; EventSource reconnects by itself.
 */
export function LiveRefresh({ quiet = false }: { quiet?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, 250); // several changes in a burst → one refresh
    };
    const es = new EventSource("/api/live");
    es.addEventListener("ready", () => {
      setLive(true);
      refresh(); // catch up on anything missed while disconnected
    });
    es.addEventListener("change", refresh);
    es.onerror = () => setLive(false);
    const poll = setInterval(() => {
      if (es.readyState !== EventSource.OPEN) router.refresh();
    }, POLL_MS);
    return () => {
      es.close();
      clearInterval(poll);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  if (quiet) return null;
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-sm ${live ? "text-green-800" : "text-amber-800"}`}>
      <span aria-hidden="true" className={`size-2.5 rounded-full ${live ? "bg-green-600" : "bg-amber-500"}`} />
      {live ? "Live" : "Reconnecting… updating every 5 s"}
    </span>
  );
}

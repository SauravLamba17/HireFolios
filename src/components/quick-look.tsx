"use client";

// Header quick-look (HR, manager, admin): type 2+ letters of a name or 4+ digits of a mobile. "/" focuses it,
// ↑ ↓ move, Enter opens the profile, Esc closes. ARIA combobox + listbox.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { formatDayIST } from "@/lib/ist";
import type { QuickLookRow } from "@/lib/rediscovery/quicklook";

export function QuickLook() {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<QuickLookRow[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  // "/" anywhere (not while typing in a field) focuses the box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // debounced search (~200 ms); the latest request wins
  useEffect(() => {
    const term = q.trim();
    const enough = /^\d[\d\s\-+()]*$/.test(term) ? term.replace(/\D/g, "").length >= 4 : term.replace(/[^\p{L}]/gu, "").length >= 2;
    if (!enough) {
      setRows([]);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState("loading");
      try {
        const res = await fetch(`/api/quicklook?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { rows: QuickLookRow[] };
        setRows(j.rows);
        setActive(j.rows.length ? 0 : -1);
        setState("done");
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState("error");
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (r: QuickLookRow) => {
    setOpen(false);
    setQ("");
    router.push(`/dashboard/candidates/${r.id}`);
  };
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const showList = open && q.trim() !== "" && state !== "idle";

  return (
    <div className="relative w-full max-w-sm min-w-56 flex-1">
      <label htmlFor={`${id}-in`} className="sr-only">Quick look: name or mobile</label>
      <input
        ref={input}
        id={`${id}-in`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
        placeholder="Find a person — name or mobile ( / )"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(rows.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (rows[active]) go(rows[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            if (!open) setQ("");
          }
        }}
        className="input h-11"
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Quick look results" className="absolute left-0 z-30 mt-1 xl:right-0 xl:left-auto max-h-[70vh] w-[min(42rem,92vw)] overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {state === "loading" && rows.length === 0 && <li className="p-3 text-slate-600">Searching…</li>}
          {state === "error" && <li className="p-3 text-red-700">Could not search. Try again.</li>}
          {state === "done" && rows.length === 0 && <li className="p-3 text-slate-600">Nobody found.</li>}
          {rows.map((r, i) => (
            <li
              key={r.id}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer gap-3 border-b border-slate-100 p-3 last:border-0 ${i === active ? "bg-blue-50" : ""}`}
            >
              {r.photoId ? (
                // eslint-disable-next-line @next/next/no-img-element -- private file behind the session cookie
                <img src={`/api/files/${r.photoId}`} alt="" loading="lazy" className="h-14 w-11 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid h-14 w-11 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-400">—</span>
              )}
              <span className="min-w-0 flex-1 text-sm">
                <span className="block text-base font-semibold text-slate-900">
                  {r.name} <span className="font-normal text-slate-600">· {r.mobile}{r.city ? ` · ${r.city}` : ""}</span>
                </span>
                <span className="block text-slate-700">
                  {[r.lastJob, r.profile].filter(Boolean).join(" · ")}
                </span>
                <span className="block text-slate-600">
                  {r.lastVisit ? `Last visit ${formatDayIST(r.lastVisit)} · ${r.visits} visit${r.visits === 1 ? "" : "s"}` : "No visits"}
                  {r.change && ` · score ${r.change}`}
                </span>
                <span className="block text-slate-800">{r.line}</span>
                {(r.tags.length > 0 || r.callbackDue) && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t.code} className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.code === "do_not_rehire" ? "bg-red-700 text-white" : "bg-violet-100 text-violet-900"}`}>{t.label}</span>
                    ))}
                    {r.callbackDue && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Due for call-back</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

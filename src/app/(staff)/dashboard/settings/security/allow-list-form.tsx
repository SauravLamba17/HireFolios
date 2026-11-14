"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseAllowList, validEntry } from "@/lib/net";
import { send } from "@/lib/send";

export function AllowListForm({ on, entries, mine }: { on: boolean; entries: string[]; mine: string | null }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(on);
  const [text, setText] = useState(entries.join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bad = parseAllowList(text).filter((e) => !validEntry(e));

  async function save() {
    setBusy(true);
    setMsg(null);
    const err = await send("/api/settings/security", "PATCH", { on: enabled, entries: parseAllowList(text) });
    setMsg({ ok: !err, text: err ?? (enabled ? "Saved: sign-in only from these addresses." : "Saved: the list is off.") });
    router.refresh();
    setBusy(false);
  }

  return (
    <section className="card space-y-4" aria-labelledby="ip-h">
      <h2 id="ip-h" className="text-lg font-semibold">Office network only (IP allow-list)</h2>
      <p className="max-w-3xl text-sm text-slate-600">
        When on, staff can sign in only from these internet addresses (the office&apos;s address from your internet provider), and the lobby TV login works
        only from them. Off by default. Your address right now: <strong data-testid="my-ip">{mine ?? "unknown (no proxy in front of the app)"}</strong>.
      </p>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5 accent-blue-700" />
        <span className="font-medium">Allow sign-in only from the addresses below</span>
      </label>
      <div>
        <label htmlFor="ip-list" className="label">Addresses (one per line: 203.0.113.7, a range 203.0.113.0/24, or an IPv6 address)</label>
        <textarea id="ip-list" rows={5} value={text} onChange={(e) => setText(e.target.value)} className="input h-auto py-2 font-mono" />
        {bad.length > 0 && <p className="mt-1 text-sm text-red-700">Not an address: {bad.join(", ")}</p>}
        {mine && !parseAllowList(text).includes(mine) && (
          <button type="button" onClick={() => setText((t) => `${t.trim() ? `${t.trim()}\n` : ""}${mine}`)} className="mt-2 text-sm text-blue-700 underline">
            Add my address ({mine})
          </button>
        )}
      </div>
      <button type="button" disabled={busy || bad.length > 0} onClick={save} className="btn btn-primary">Save</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>{msg.text}</p>}
    </section>
  );
}

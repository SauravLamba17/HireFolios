"use client";

// Rediscovery controls (HR only): suggestion accept / dismiss, tags. Every call goes to /api/candidates/[id]/rediscovery.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/send";

export function useRediscovery(candidateId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send(`/api/candidates/${candidateId}/rediscovery`, "POST", body);
    setMsg({ ok: !err, text: err ?? success });
    router.refresh();
    setBusy(false);
    return !err;
  }
  const box = msg && (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>
      {msg.text}
    </p>
  );
  return { busy, post, box };
}

/** One open suggestion: the tag, the reason in words, Accept / Dismiss with an optional note. */
export function SuggestionCard({ candidateId, tag, label, reason, name }: { candidateId: string; tag: string; label: string; reason: string; name?: string }) {
  const { busy, post, box } = useRediscovery(candidateId);
  const [note, setNote] = useState("");
  const id = `sg-${candidateId}-${tag}`;
  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3" role="group" aria-label={`Suggestion: ${label}${name ? ` for ${name}` : ""}`}>
      <p>
        <span className="font-semibold text-violet-900">Suggested tag: {label}</span>
        <span className="block text-sm text-slate-700">{reason}</span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={id} className="sr-only">Note (optional)</label>
          <input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" className="input" />
        </div>
        <button type="button" disabled={busy} onClick={() => post({ action: "suggestionAccept", tag, note }, `Tagged: ${label}.`)} className="btn btn-primary">
          Accept
        </button>
        <button type="button" disabled={busy} onClick={() => post({ action: "suggestionDismiss", tag, note }, "Dismissed. It comes back only after a new decision.")} className="btn btn-secondary">
          Dismiss
        </button>
      </div>
      {box}
    </div>
  );
}

export type TagView = { id: string; code: string; label: string; note: string | null; by: string | null; at: string; source: string };

/** Tags with their notes; remove needs a note. `options`: tags HR may add (active ones). */
export function TagEditor({ candidateId, tags, options, canTag }: { candidateId: string; tags: TagView[]; options: { code: string; label: string }[]; canTag: boolean }) {
  const { busy, post, box } = useRediscovery(candidateId);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeNote, setRemoveNote] = useState("");
  const [code, setCode] = useState("");
  const needsReason = code === "do_not_rehire";
  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const note = String(new FormData(form).get("note") ?? "");
    if (await post({ action: "tagAdd", code, note }, "Tag added.")) {
      form.reset();
      setCode("");
    }
  }
  const free = options.filter((o) => !tags.some((t) => t.code === o.code));
  return (
    <div className="space-y-3">
      {tags.length === 0 ? (
        <p className="text-slate-600">No tags.</p>
      ) : (
        <ul className="space-y-2" aria-label="Tags">
          {tags.map((t) => (
            <li key={t.id} className={`rounded-lg border p-2 ${t.code === "do_not_rehire" ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${t.code === "do_not_rehire" ? "bg-red-700 text-white" : "bg-violet-100 text-violet-900"}`}>{t.label}</span>
                <span className="text-sm text-slate-600">
                  {t.note && <>“{t.note}” · </>}
                  {t.by ?? "—"} · {t.at}
                  {t.source === "suggestion" && " · accepted suggestion"}
                </span>
                {canTag && removing !== t.id && (
                  <button type="button" onClick={() => { setRemoving(t.id); setRemoveNote(""); }} className="ml-auto text-sm text-blue-700 underline">
                    Remove
                  </button>
                )}
              </div>
              {removing === t.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1">
                    <label htmlFor={`rm-${t.id}`} className="label">Why remove {t.label}?</label>
                    <input id={`rm-${t.id}`} value={removeNote} onChange={(e) => setRemoveNote(e.target.value)} minLength={3} maxLength={500} className="input" />
                  </div>
                  <button type="button" disabled={busy} onClick={async () => (await post({ action: "tagRemove", tagId: t.id, note: removeNote }, "Tag removed.")) && setRemoving(null)} className="btn btn-danger">
                    Remove tag
                  </button>
                  <button type="button" onClick={() => setRemoving(null)} className="btn btn-secondary">Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canTag && free.length > 0 && (
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2" aria-label="New tag">
          <div>
            <label htmlFor={`tag-${candidateId}`} className="label">Add a tag</label>
            <select id={`tag-${candidateId}`} required value={code} onChange={(e) => setCode(e.target.value)} className="input">
              <option value="">Choose…</option>
              {free.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor={`tagnote-${candidateId}`} className="label">{needsReason ? "Reason (required)" : "Note (optional)"}</label>
            <input id={`tagnote-${candidateId}`} name="note" required={needsReason} minLength={needsReason ? 3 : undefined} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={busy} className="btn btn-secondary">Add tag</button>
        </form>
      )}
      {box}
    </div>
  );
}

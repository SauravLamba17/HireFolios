"use client";

// Contact etiquette controls (HR only, docs/REDISCOVERY.md D): Call / WhatsApp / Mark contacted with the cooling
// warning and the contact log, call-backs, consent after the visit, Do not contact. All go to
// /api/candidates/[id]/rediscovery; the app never sends anything itself (tel: and wa.me links only).
import { useState, type FormEvent } from "react";
import { useRediscovery } from "@/components/rediscovery";
import { CHANNELS, CONSENT_CHANNELS, CONTACT_OUTCOMES, PURPOSES, telLink, waLink, type Channel, type Purpose } from "@/lib/rediscovery/contact";

export type Template = { id: string; label: string; text: string };

/** Asks before contacting again inside the cooling period. Never blocks: Continue goes ahead. */
const okToContact = (cooling: string | null) => !cooling || window.confirm(`${cooling}\n\nOK = Continue, Cancel = don't contact now.`);

export function ContactPanel({
  candidateId,
  mobile,
  cooling,
  waAllowed,
  templates,
  defaultPurpose,
  pushId = null,
  label,
}: {
  candidateId: string;
  mobile: string;
  cooling: string | null;
  waAllowed: boolean;
  templates: Template[];
  defaultPurpose: Purpose;
  pushId?: string | null;
  label?: string;
}) {
  const { busy, post, box } = useRediscovery(candidateId);
  const [logging, setLogging] = useState<Channel | null>(null);
  const [picking, setPicking] = useState(false);
  const [tpl, setTpl] = useState(templates[0]?.id ?? "");
  const chosen = templates.find((t) => t.id === tpl);

  async function onLog(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await post(
      { action: "contact", channel: f.get("channel"), purpose: f.get("purpose"), outcome: String(f.get("outcome") || "") || null, note: String(f.get("note") ?? ""), pushId },
      "Contact saved.",
    );
    if (ok) setLogging(null);
  }

  return (
    <div className="space-y-2" role="group" aria-label={label ?? "Contact"}>
      {cooling && <p className="text-sm font-medium text-amber-900" data-testid="cooling">{cooling}</p>}
      <div className="flex flex-wrap gap-2">
        <a
          href={telLink(mobile)}
          onClick={(e) => {
            if (!okToContact(cooling)) return e.preventDefault();
            setLogging("call");
            setPicking(false);
          }}
          className="btn btn-secondary"
        >
          Call
        </a>
        {waAllowed ? (
          <button type="button" onClick={() => setPicking((p) => !p)} className="btn btn-secondary" aria-expanded={picking}>
            WhatsApp
          </button>
        ) : (
          <span className="flex items-center rounded-lg bg-slate-100 px-3 text-sm text-slate-600" title="No WhatsApp consent">Call only (no WhatsApp consent)</span>
        )}
        <button type="button" onClick={() => setLogging("other")} className="btn btn-secondary">Mark contacted</button>
      </div>
      {picking && waAllowed && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label htmlFor={`tpl-${candidateId}`} className="label">Message</label>
          <select id={`tpl-${candidateId}`} value={tpl} onChange={(e) => setTpl(e.target.value)} className="input">
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {chosen && <p className="rounded bg-slate-50 p-2 text-sm whitespace-pre-line" data-testid="wa-preview">{chosen.text}</p>}
          <a
            href={chosen ? waLink(mobile, chosen.text) : "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!okToContact(cooling)) return e.preventDefault();
              setLogging("whatsapp");
              setPicking(false);
            }}
            className="btn btn-primary"
          >
            Open WhatsApp
          </a>
        </div>
      )}
      {logging && (
        <form onSubmit={onLog} className="grid gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 md:grid-cols-4 md:items-end" aria-label="Log the contact">
          <div>
            <label htmlFor={`ch-${candidateId}`} className="label">How</label>
            <select id={`ch-${candidateId}`} name="channel" defaultValue={logging} className="input">
              {Object.entries(CHANNELS).filter(([k]) => k !== "whatsapp" || waAllowed).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`pu-${candidateId}`} className="label">Purpose</label>
            <select id={`pu-${candidateId}`} name="purpose" defaultValue={defaultPurpose} className="input">
              {Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`oc-${candidateId}`} className="label">Outcome</label>
            <select id={`oc-${candidateId}`} name="outcome" defaultValue="" className="input">
              <option value="">Not yet known</option>
              {Object.entries(CONTACT_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`no-${candidateId}`} className="label">Note (optional)</label>
            <input id={`no-${candidateId}`} name="note" maxLength={500} className="input" />
          </div>
          <div className="flex gap-2 md:col-span-4">
            <button type="submit" disabled={busy} className="btn btn-primary">Save contact</button>
            <button type="button" onClick={() => setLogging(null)} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      )}
      {box}
    </div>
  );
}

export function CallbackBox({ candidateId, callback, defaultDay, reason, today }: { candidateId: string; callback: { id: string; dueOn: string; dueText: string; note: string | null } | null; defaultDay: string; reason: string | null; today: string }) {
  const { busy, post, box } = useRediscovery(candidateId);
  if (callback) {
    return (
      <div className="space-y-2" aria-label="Call-back">
        <p className={callback.dueOn <= today ? "font-semibold text-amber-900" : ""}>
          Call-back {callback.dueOn <= today ? "due" : "on"} {callback.dueText}
          {callback.note && <span className="font-normal text-slate-600"> · {callback.note}</span>}
        </p>
        <CallbackActions candidateId={candidateId} callbackId={callback.id} today={today} post={post} busy={busy} />
        {box}
      </div>
    );
  }
  return (
    <form
      aria-label="Set a call-back"
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await post({ action: "callbackSet", dueOn: f.get("due"), note: String(f.get("note") ?? "") }, "Call-back set.");
      }}
    >
      <div>
        <label htmlFor={`cbd-${candidateId}`} className="label">Call back on</label>
        <input id={`cbd-${candidateId}`} name="due" type="date" min={today} defaultValue={defaultDay < today ? today : defaultDay} required className="input" />
      </div>
      <div className="min-w-48 flex-1">
        <label htmlFor={`cbn-${candidateId}`} className="label">Note (optional)</label>
        <input id={`cbn-${candidateId}`} name="note" maxLength={500} className="input" />
      </div>
      <button type="submit" disabled={busy} className="btn btn-secondary">Set call-back</button>
      {reason && <p className="w-full text-sm text-slate-600">Suggested because: {reason}. Date = decision day + notice period.</p>}
      <div className="w-full">{box}</div>
    </form>
  );
}

/** Done (with the outcome) or Snooze to a date. */
export function CallbackActions({ candidateId, callbackId, today, post, busy }: { candidateId: string; callbackId: string; today: string; post?: (b: Record<string, unknown>, s: string) => Promise<boolean>; busy?: boolean }) {
  const own = useRediscovery(candidateId);
  const send = post ?? own.post;
  const [mode, setMode] = useState<"done" | "snooze" | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("done")} className="btn btn-secondary">Done</button>
        <button type="button" onClick={() => setMode("snooze")} className="btn btn-secondary">Snooze</button>
      </div>
      {mode && (
        <form
          aria-label={mode === "done" ? "Call-back done" : "Snooze call-back"}
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok =
              mode === "done"
                ? await send({ action: "callbackDone", callbackId, outcome: f.get("outcome"), note: String(f.get("note") ?? "") }, "Call-back done.")
                : await send({ action: "callbackSnooze", callbackId, dueOn: f.get("due"), note: String(f.get("note") ?? "") }, "Call-back moved.");
            if (ok) setMode(null);
          }}
        >
          {mode === "done" ? (
            <div>
              <label htmlFor={`cbo-${callbackId}`} className="label">Outcome</label>
              <select id={`cbo-${callbackId}`} name="outcome" required defaultValue="" className="input">
                <option value="" disabled>Choose…</option>
                {Object.entries(CONTACT_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor={`cbs-${callbackId}`} className="label">Snooze to</label>
              <input id={`cbs-${callbackId}`} name="due" type="date" min={today} required className="input" />
            </div>
          )}
          <div className="min-w-40 flex-1">
            <label htmlFor={`cbx-${callbackId}`} className="label">Note (optional)</label>
            <input id={`cbx-${callbackId}`} name="note" maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={busy ?? own.busy} className="btn btn-primary">{mode === "done" ? "Save" : "Snooze"}</button>
        </form>
      )}
      {!post && own.box}
    </div>
  );
}

export function ConsentBox({ candidateId, inPool, poolUntilText, withdrawnText, today }: { candidateId: string; inPool: boolean; poolUntilText: string | null; withdrawnText: string | null; today: string }) {
  const { busy, post, box } = useRediscovery(candidateId);
  const [recording, setRecording] = useState(false);
  return (
    <div className="space-y-2">
      <p>
        {inPool ? (
          <>In the talent pool{poolUntilText && <> · kept until {poolUntilText} unless renewed</>}</>
        ) : withdrawnText ? (
          <>Talent-pool consent withdrawn {withdrawnText}</>
        ) : (
          <>No talent-pool consent: data follows the normal deletion dates.</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRecording((r) => !r)} className="btn btn-secondary" aria-expanded={recording}>
          {inPool ? "Renew consent" : "Record consent given now"}
        </button>
        {inPool && (
          <form
            aria-label="Withdraw consent"
            className="flex items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = String(new FormData(e.currentTarget).get("day"));
              if (!window.confirm("Withdraw talent-pool consent? The person leaves the pool, bulk lists and call-backs, and normal deletion dates start from this date.")) return;
              await post({ action: "consentWithdraw", day: d }, "Consent withdrawn.");
            }}
          >
            <div>
              <label htmlFor={`wd-${candidateId}`} className="label">Withdrawn on</label>
              <input id={`wd-${candidateId}`} name="day" type="date" max={today} defaultValue={today} required className="input" />
            </div>
            <button type="submit" disabled={busy} className="btn btn-danger">Withdraw consent</button>
          </form>
        )}
      </div>
      {recording && (
        <form
          aria-label="Record talent-pool consent"
          className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-4 md:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await post({ action: "consentRecord", day: f.get("day"), channel: f.get("channel"), note: String(f.get("note") ?? ""), whatsapp: f.get("wa") === "on" }, "Consent recorded.")) setRecording(false);
          }}
        >
          <div>
            <label htmlFor={`kd-${candidateId}`} className="label">Given on</label>
            <input id={`kd-${candidateId}`} name="day" type="date" max={today} defaultValue={today} required className="input" />
          </div>
          <div>
            <label htmlFor={`kc-${candidateId}`} className="label">How</label>
            <select id={`kc-${candidateId}`} name="channel" required className="input">
              {Object.entries(CONSENT_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`kn-${candidateId}`} className="label">Note (optional)</label>
            <input id={`kn-${candidateId}`} name="note" maxLength={500} className="input" />
          </div>
          <label className="flex h-12 items-center gap-2">
            <input type="checkbox" name="wa" className="size-5 accent-blue-700" /> WhatsApp updates OK
          </label>
          <button type="submit" disabled={busy} className="btn btn-primary md:col-span-4 md:w-fit">Save consent</button>
        </form>
      )}
      {box}
    </div>
  );
}

export function DncBox({ candidateId, dnc, canClear }: { candidateId: string; dnc: { reason: string; by: string | null; at: string } | null; canClear: boolean }) {
  const { busy, post, box } = useRediscovery(candidateId);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      {dnc ? (
        <p className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-red-900" data-testid="dnc">
          <strong>Do not contact</strong> (the person asked): {dnc.reason} · {dnc.by ?? "—"} · {dnc.at}
        </p>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm text-blue-700 underline" aria-expanded={open}>
          They asked not to be contacted…
        </button>
      )}
      {(open || (dnc && canClear)) && (
        <form
          aria-label={dnc ? "Clear Do not contact" : "Mark Do not contact"}
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("v") ?? "");
            if (await post(dnc ? { action: "dncClear", note: v } : { action: "dncSet", reason: v }, dnc ? "Do not contact cleared." : "Marked Do not contact.")) setOpen(false);
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor={`dnc-${candidateId}`} className="label">{dnc ? "Why clear it? (admin)" : "What did they say?"}</label>
            <input id={`dnc-${candidateId}`} name="v" required minLength={3} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={busy} className={dnc ? "btn btn-secondary" : "btn btn-danger"}>{dnc ? "Clear Do not contact" : "Mark Do not contact"}</button>
        </form>
      )}
      {box}
    </div>
  );
}

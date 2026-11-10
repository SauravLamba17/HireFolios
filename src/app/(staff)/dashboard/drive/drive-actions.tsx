"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/send";

type Opt = { id: string; label: string };

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return false;
    setBusy(true);
    setError(null);
    const err = await send("/api/drive", "POST", body);
    setError(err);
    router.refresh();
    setBusy(false);
    return !err;
  }
  const errorBox = error && (
    <p role="alert" className="alert-error mt-2">
      {error}
    </p>
  );
  return { busy, run, errorBox };
}

export function AddPanel({ people, rounds }: { people: Opt[]; rounds: Opt[] }) {
  const { busy, run, errorBox } = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await run({ action: "addPanel", name: String(f.get("room")).trim(), interviewerId: f.get("interviewer"), stageId: f.get("stage") })) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="card space-y-3" aria-label="Add a panel">
      <h3 className="font-semibold">Add a panel</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="room" className="label">Room</label>
          <input id="room" name="room" required maxLength={40} placeholder="Room 1" className="input" />
        </div>
        <div>
          <label htmlFor="interviewer" className="label">Interviewer</label>
          <select id="interviewer" name="interviewer" required defaultValue="" className="input">
            <option value="" disabled>Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="stage" className="label">Round</label>
          <select id="stage" name="stage" required defaultValue={rounds[0]?.id ?? ""} className="input">
            {rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Adding…" : "Add panel"}</button>
      {people.length === 0 && <p className="text-sm text-slate-600">Add interviewers on the Staff page first.</p>}
      {errorBox}
    </form>
  );
}

export function PanelActions({
  panel,
  waiting,
  people,
  rounds,
}: {
  panel: { id: string; name: string; status: string; interviewerId: string | null; stageId: string; currentId: string | null; currentToken: string | null };
  waiting: Opt[];
  people: Opt[];
  rounds: Opt[];
}) {
  const { busy, run, errorBox } = useAction();
  const [pick, setPick] = useState("");
  const [editing, setEditing] = useState(false);
  const p = panel;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {p.status === "available" && (
          <button type="button" disabled={busy || waiting.length === 0} onClick={() => run({ action: "assign", panelId: p.id })} className="btn btn-primary">
            Assign next
          </button>
        )}
        {p.currentId && (
          <>
            <button type="button" disabled={busy} onClick={() => run({ action: "requeue", applicationId: p.currentId }, `Send ${p.currentToken} back to waiting (keeps their place)?`)} className="btn btn-secondary">
              Back to waiting
            </button>
            <button type="button" disabled={busy} onClick={() => run({ action: "mark", applicationId: p.currentId, kind: "no_show" }, `Mark ${p.currentToken} as no-show? This ends their visit today.`)} className="btn btn-danger">
              No-show
            </button>
          </>
        )}
        {p.status === "away" ? (
          <button type="button" disabled={busy} onClick={() => run({ action: "updatePanel", panelId: p.id, status: "available" })} className="btn btn-secondary">
            Set available
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ action: "updatePanel", panelId: p.id, status: "away" }, p.status === "busy" ? `Set ${p.name} away? ${p.currentToken} goes back to waiting and keeps their place.` : undefined)}
            className="btn btn-secondary"
          >
            Set away
          </button>
        )}
        {p.status !== "busy" && (
          <button type="button" disabled={busy} onClick={() => setEditing((x) => !x)} aria-expanded={editing} className="btn btn-secondary">
            Edit
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => run({ action: "updatePanel", panelId: p.id, status: "closed" }, `Close ${p.name} for today?${p.currentToken ? ` ${p.currentToken} goes back to waiting.` : ""}`)} className="btn btn-danger">
          Close
        </button>
      </div>
      {p.status === "available" && waiting.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <label htmlFor={`pick-${p.id}`} className="sr-only">Choose a waiting candidate for {p.name}</label>
          <select id={`pick-${p.id}`} value={pick} onChange={(e) => setPick(e.target.value)} className="input min-w-0 flex-1">
            <option value="">Pick a candidate…</option>
            {waiting.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          <button type="button" disabled={busy || !pick} onClick={async () => (await run({ action: "assign", panelId: p.id, applicationId: pick })) && setPick("")} className="btn btn-secondary">
            Assign
          </button>
        </div>
      )}
      {editing && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await run({ action: "updatePanel", panelId: p.id, interviewerId: f.get("interviewer"), stageId: f.get("stage") })) setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`int-${p.id}`}>Interviewer</label>
          <select id={`int-${p.id}`} name="interviewer" defaultValue={p.interviewerId ?? ""} className="input">
            {people.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <label className="sr-only" htmlFor={`stg-${p.id}`}>Round</label>
          <select id={`stg-${p.id}`} name="stage" defaultValue={p.stageId} className="input">
            {rounds.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <button type="submit" disabled={busy} className="btn btn-primary">Save</button>
        </form>
      )}
      {errorBox}
    </div>
  );
}

export function WaitingActions({ id, token }: { id: string; token: string }) {
  const { busy, run, errorBox } = useAction();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => run({ action: "mark", applicationId: id, kind: "no_show" }, `Mark ${token} as no-show? This ends their visit today.`)} className="btn btn-secondary h-10 px-3 text-sm">
          No-show
        </button>
        <button type="button" disabled={busy} onClick={() => run({ action: "mark", applicationId: id, kind: "withdrawn" }, `Mark ${token} as walked away? This ends their visit today.`)} className="btn btn-secondary h-10 px-3 text-sm">
          Walked away
        </button>
      </div>
      {errorBox}
    </div>
  );
}

export function EndDay({ closed }: { closed: boolean }) {
  const { busy, run, errorBox } = useAction();
  return (
    <div>
      {closed ? (
        <button type="button" disabled={busy} onClick={() => run({ action: "reopen" }, "Reopen today's drive?")} className="btn btn-secondary">
          Reopen drive
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ action: "endDay" }, "End the day? All panels close and anyone still in a room goes back to waiting.")}
          className="btn btn-danger"
        >
          End of day
        </button>
      )}
      {errorBox}
    </div>
  );
}

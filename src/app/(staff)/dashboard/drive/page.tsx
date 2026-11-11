import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Elapsed } from "@/components/elapsed";
import { LiveRefresh } from "@/components/live-refresh";
import { StatusBadge } from "@/components/status-badge";
import { boardState } from "@/lib/drive";
import { formatDateTimeIST, formatDayIST } from "@/lib/ist";
import { OUTCOME_LABELS } from "@/lib/options";
import { can, ROLE_LABELS, requireStaff } from "@/lib/session";
import { AddPanel, EndDay, PanelActions, WaitingActions } from "./drive-actions";

export const metadata: Metadata = { title: "Drive board" };

const PANEL_BADGE: Record<string, string> = {
  available: "bg-green-50 text-green-800",
  busy: "bg-blue-50 text-blue-800",
  away: "bg-amber-50 text-amber-900",
};
const DONE = ["selected", "rejected", "on_hold", "no_show", "withdrawn"] as const;
const iso = (d: Date) => new Date(d).toISOString();
const clock = (d: Date) => formatDateTimeIST(new Date(d)).split(", ").pop();

export default async function DrivePage() {
  const staff = await requireStaff("drive");
  const manage = can(staff.role, "driveManage");
  const b = await boardState(staff.tenantId);
  const people = manage
    ? await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(eq(users.tenantId, staff.tenantId), eq(users.active, true), inArray(users.role, ["interviewer", "manager", "admin"])))
        .orderBy(asc(users.name))
    : [];
  const peopleOpts = people.map((p) => ({ id: p.id, label: `${p.name} (${ROLE_LABELS[p.role]})` }));
  const rounds = b.stages.filter((s) => s.active && s.isInterview).map((s) => ({ id: s.id, label: s.name }));
  const waitingFor = (stageId: string) =>
    (b.waiting.find((w) => w.stage.id === stageId)?.cards ?? []).map((c) => ({ id: c.id, label: `${c.token} · ${c.full_name}` }));
  const counts = Object.fromEntries(DONE.map((o) => [o, b.done.filter((d) => d.outcome === o)]));
  const waitingTotal = b.waiting.reduce((n, w) => n + w.cards.length, 0) + b.unqueued.length;
  const timing =
    b.finishedToday >= 3 && b.averageToday !== null
      ? `Average interview today: ${Math.round(b.averageToday)} min over ${b.finishedToday} finished.`
      : b.defaultMinutes
        ? `Wait times are estimates from the Settings default (${b.defaultMinutes} min) until 3 interviews finish today (${b.finishedToday} so far).`
        : `Wait times appear after 3 interviews finish today (${b.finishedToday} so far).`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Drive board</h1>
          <p className="mt-1 text-slate-600">
            {formatDayIST(b.drive.driveDate)} · {b.drive.locationName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LiveRefresh />
          <Link href="/tv" target="_blank" className="btn btn-secondary">
            Lobby TV screen ↗
          </Link>
          {can(staff.role, "export") && (
            <a href={`/api/exports/drive?date=${b.drive.driveDate}`} className="btn btn-secondary">
              Export day (Excel)
            </a>
          )}
          {manage && <EndDay closed={Boolean(b.drive.closedAt)} />}
        </div>
      </div>

      {b.drive.closedAt && (
        <section className="card space-y-3" aria-labelledby="summary-h">
          <h2 id="summary-h" className="text-lg font-semibold">Day closed at {clock(b.drive.closedAt)}: summary</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Registered", b.waiting.reduce((n, w) => n + w.cards.length, 0) + b.unqueued.length + b.done.length + b.panels.filter((p) => p.current).length],
              ["Interviews finished", b.finishedToday],
              ...DONE.map((o) => [OUTCOME_LABELS[o], counts[o].length] as const),
              ["Still waiting", waitingTotal],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-sm text-slate-600">{k}</dt>
                <dd className="text-2xl font-semibold" data-testid={`summary-${k}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-slate-600">{b.finishedToday >= 3 && b.averageToday !== null ? `Average interview: ${Math.round(b.averageToday)} min.` : "Fewer than 3 interviews finished: no average."}</p>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="panels-h">
        <h2 id="panels-h" className="text-lg font-semibold">Panels ({b.panels.length})</h2>
        {b.panels.length === 0 && <p className="text-slate-600">No panels yet today.{manage ? " Add one below." : ""}</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {b.panels.map((p) => (
            <article key={p.id} className="card space-y-3 p-4" aria-label={`Panel ${p.name}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${PANEL_BADGE[p.status]}`}>{p.status === "busy" ? "In interview" : p.status === "away" ? "Away" : "Available"}</span>
                <span className="text-slate-600">
                  {p.interviewer ?? "No interviewer"} · {p.stage}
                </span>
              </div>
              {p.current && (
                <p className="rounded-lg bg-blue-50 px-3 py-2">
                  <strong>{p.current.token}</strong> {p.current.full_name}
                  {p.current.calledAt && (
                    <span className="text-slate-600"> · <Elapsed since={iso(p.current.calledAt)} /> in room</span>
                  )}
                </p>
              )}
              {manage && !b.drive.closedAt && (
                <PanelActions
                  panel={{ id: p.id, name: p.name, status: p.status, interviewerId: p.interviewerId, stageId: p.stageId, currentId: p.current?.id ?? null, currentToken: p.current?.token ?? null }}
                  waiting={waitingFor(p.stageId)}
                  people={peopleOpts}
                  rounds={rounds}
                />
              )}
            </article>
          ))}
        </div>
        {manage && !b.drive.closedAt && <AddPanel people={peopleOpts} rounds={rounds} />}
      </section>

      <p className="text-sm text-slate-600">{timing}</p>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="waiting-h" className="space-y-4">
          <h2 id="waiting-h" className="text-lg font-semibold">Waiting ({waitingTotal})</h2>
          {b.waiting.map((w) => (
            <div key={w.stage.id} className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">
                {w.stage.name} · {w.cards.length} waiting · {w.panels} {w.panels === 1 ? "panel" : "panels"}
              </h3>
              {w.cards.length === 0 && <p className="text-sm text-slate-500">Nobody waiting.</p>}
              <ul className="space-y-2" aria-label={`Waiting for ${w.stage.name}`}>
                {w.cards.map((c) => (
                  <li key={c.id} className="card space-y-2 p-3">
                    <div className="flex gap-3">
                      {c.photo_id ? (
                        <Image src={`/api/files/${c.photo_id}`} unoptimized width={48} height={64} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-16 w-12 shrink-0 rounded bg-slate-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p>
                          <strong>{c.token}</strong>{" "}
                          <Link href={`/dashboard/candidates/${c.candidate_id}`} className="text-blue-800 hover:underline">{c.full_name}</Link>
                        </p>
                        <p className="text-sm text-slate-600">{c.job}</p>
                        <p className="text-sm text-slate-600">
                          #{c.position} · waiting <Elapsed since={iso(c.waitingSince)} /> ·{" "}
                          {c.estimate ? `~${c.estimate.minutes} min${c.estimate.kind === "estimate" ? " (estimate)" : ""}` : "—"}
                        </p>
                        {manage && (c.cooldown || c.duplicate) && (
                          <p className="text-sm font-medium text-red-800">
                            {c.cooldown && <span title="Rejected within the cooldown period">⚠ Cooldown </span>}
                            {c.duplicate && <span title="Same email, or a similar name and date of birth, under another mobile">⧉ Possible duplicate</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    {manage && !b.drive.closedAt && <WaitingActions id={c.id} token={c.token} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {b.unqueued.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Not in an interview round</h3>
              <ul className="space-y-1 text-sm">
                {b.unqueued.map((c) => (
                  <li key={c.id}>
                    <strong>{c.token}</strong> <Link href={`/dashboard/candidates/${c.candidate_id}`} className="text-blue-800 hover:underline">{c.full_name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="inint-h" className="space-y-3">
          <h2 id="inint-h" className="text-lg font-semibold">In interview ({b.panels.filter((p) => p.current).length})</h2>
          {b.panels.filter((p) => p.current).length === 0 && <p className="text-sm text-slate-500">No interviews running.</p>}
          <ul className="space-y-2" aria-label="In interview">
            {b.panels
              .filter((p) => p.current)
              .map((p) => (
                <li key={p.id} className="card p-3">
                  <p className="font-semibold">{p.name} · {p.interviewer}</p>
                  <p>
                    <strong>{p.current!.token}</strong>{" "}
                    <Link href={`/dashboard/candidates/${p.current!.candidate_id}`} className="text-blue-800 hover:underline">{p.current!.full_name}</Link>
                  </p>
                  <p className="text-sm text-slate-600">
                    {p.stage}
                    {p.current!.calledAt && <> · <Elapsed since={iso(p.current!.calledAt)} /></>}
                  </p>
                </li>
              ))}
          </ul>
        </section>

        <section aria-labelledby="done-h" className="space-y-3">
          <h2 id="done-h" className="text-lg font-semibold">Done today ({b.done.length})</h2>
          <div className="flex flex-wrap gap-2">
            {DONE.map((o) => (
              <span key={o} data-testid={`done-${o}`}>
                <StatusBadge outcome={o} stage={null} /> <strong>{counts[o].length}</strong>
              </span>
            ))}
          </div>
          {DONE.filter((o) => counts[o].length).map((o) => (
            <details key={o} open className="card p-3">
              <summary className="cursor-pointer font-medium">
                {OUTCOME_LABELS[o]} ({counts[o].length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {counts[o].map((d) => (
                  <li key={d.id}>
                    <strong>{d.token}</strong>{" "}
                    <Link href={`/dashboard/candidates/${d.candidate_id}`} className="text-blue-800 hover:underline">{d.full_name}</Link>
                    {d.reject_reason && <span className="text-slate-600"> · {d.reject_reason}</span>}
                    {d.decided_at && <span className="text-slate-500"> · {clock(d.decided_at)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
}

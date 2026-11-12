"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ListItem, ListKey } from "@/lib/lists";
import { CATEGORY_KINDS, SYSTEM_TAGS } from "@/lib/rediscovery/categories";
import { send } from "@/lib/send";

function usePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(body: unknown, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send("/api/settings/lists", "POST", body);
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

function ItemRow({ list, item, first, last }: { list: ListKey; item: ListItem; first: boolean; last: boolean }) {
  const { busy, post, box } = usePost();
  const [label, setLabel] = useState(item.label);
  const [active, setActive] = useState(item.active);
  const [kind, setKind] = useState(item.kind ?? "neutral");
  const id = `li-${item.id}`;
  const system = list === "rediscovery_tag" && item.code !== null && SYSTEM_TAGS.includes(item.code);
  return (
    <li className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id}>Name</label>
        <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} className={`input min-w-0 flex-1 ${item.active ? "" : "text-slate-500"}`} />
        {item.days !== null && <span className="text-sm text-slate-500">{item.days} days</span>}
        {list === "reject_category" && (
          <>
            <label className="sr-only" htmlFor={`${id}-kind`}>Kind of {item.label}</label>
            <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} className="input w-auto">
              {Object.entries(CATEGORY_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}
        {system ? (
          <span className="text-sm text-slate-500" title="Used by the rediscovery rules">Always in use</span>
        ) : (
          <label className="flex h-12 items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-blue-700" /> In use
          </label>
        )}
        <button type="button" disabled={busy} onClick={() => post({ action: "update", list, itemId: item.id, label, active, ...(list === "reject_category" ? { kind } : {}) }, "Saved.")} className="btn btn-secondary">
          Save
        </button>
        <button type="button" aria-label={`Move ${item.label} up`} disabled={busy || first} onClick={() => post({ action: "move", list, itemId: item.id, direction: "up" }, "Moved.")} className="btn btn-secondary px-3">
          ↑
        </button>
        <button type="button" aria-label={`Move ${item.label} down`} disabled={busy || last} onClick={() => post({ action: "move", list, itemId: item.id, direction: "down" }, "Moved.")} className="btn btn-secondary px-3">
          ↓
        </button>
        {item.sample && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900">Sample</span>}
        {!item.active && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-600">Retired</span>}
      </div>
      {box}
    </li>
  );
}

export function ListEditor({ list, title, help, items }: { list: ListKey; title: string; help: string; items: ListItem[] }) {
  const add = usePost();
  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const label = String(data.get("label") ?? "").trim();
    const days = list === "notice_period" ? Number(data.get("days")) : null;
    const kind = list === "reject_category" ? String(data.get("kind") || "neutral") : undefined;
    if (await add.post({ action: "create", list, label, days, kind }, `Added ${label}.`)) form.reset();
  }
  const h = `list-${list}-h`;
  return (
    <section className="card space-y-4" aria-labelledby={h}>
      <div>
        <h2 id={h} className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{help}</p>
      </div>
      <ul className="space-y-3" aria-label={`${title} items`}>
        {items.map((it, i) => (
          <ItemRow key={it.id} list={list} item={it} first={i === 0} last={i === items.length - 1} />
        ))}
      </ul>
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3" aria-label={`Add to ${title}`}>
        <div className="min-w-48 flex-1">
          <label htmlFor={`new-${list}`} className="label">New item</label>
          <input id={`new-${list}`} name="label" required maxLength={100} className="input" />
        </div>
        {list === "notice_period" && (
          <div className="w-32">
            <label htmlFor={`new-${list}-days`} className="label">Days</label>
            <input id={`new-${list}-days`} name="days" type="number" inputMode="numeric" min={0} max={365} step={1} required className="input" />
          </div>
        )}
        {list === "reject_category" && (
          <div>
            <label htmlFor={`new-${list}-kind`} className="label">Kind</label>
            <select id={`new-${list}-kind`} name="kind" defaultValue="neutral" className="input">
              {Object.entries(CATEGORY_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={add.busy} className="btn btn-primary">Add</button>
      </form>
      {add.box}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GROUPS, SETTINGS, SETTING_KEYS, type Group, type RediscoverySettings, type SettingKey } from "@/lib/rediscovery/settings";
import { send } from "@/lib/send";

const Sample = () => <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900">Sample — confirm</span>;

function GroupForm({ group, values, sample }: { group: Group; values: RediscoverySettings; sample: Partial<Record<SettingKey, boolean>> }) {
  const router = useRouter();
  const keys = SETTING_KEYS.filter((k) => SETTINGS[k].group === group);
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(keys.map((k) => [k, typeof values[k] === "boolean" ? (values[k] as boolean) : String(values[k])])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const anySample = keys.some((k) => sample[k]);

  async function save() {
    setBusy(true);
    setMsg(null);
    const patch = Object.fromEntries(keys.map((k) => [k, SETTINGS[k].kind === "number" ? (draft[k] === "" ? null : Number(draft[k])) : draft[k]]));
    const err = await send("/api/settings/rediscovery", "PATCH", patch);
    setMsg({ ok: !err, text: err ?? "Saved." });
    router.refresh();
    setBusy(false);
  }

  return (
    <section className="card space-y-4" aria-labelledby={`g-${group}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`g-${group}`} className="text-lg font-semibold">{GROUPS[group]}</h2>
        {anySample && <Sample />}
      </div>
      {group === "weights" && (
        <p className="text-sm text-slate-600">Each part of a bulk list&apos;s ranking counts this much (the list shows the weights). 0 turns a part off.</p>
      )}
      <div className={group === "templates" ? "grid gap-4 lg:grid-cols-2" : "grid gap-4 md:grid-cols-2"}>
        {keys.map((k) => {
          const s = SETTINGS[k];
          const id = `set-${k}`;
          if (s.kind === "boolean") {
            return (
              <div key={k}>
                <label className="flex min-h-12 items-center gap-3">
                  <input id={id} type="checkbox" checked={draft[k] as boolean} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.checked }))} className="size-5 accent-blue-700" />
                  <span className="font-medium">{s.label}</span>
                </label>
                <p className="text-sm text-slate-600">{s.help}</p>
              </div>
            );
          }
          return (
            <div key={k}>
              <label htmlFor={id} className="label">{s.label}</label>
              {s.kind === "number" ? (
                <input id={id} type="number" inputMode="decimal" min={s.min} max={s.max} step={s.step} value={draft[k] as string} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="input w-40" />
              ) : "multiline" in s && s.multiline ? (
                <textarea id={id} rows={4} maxLength={s.max} value={draft[k] as string} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="input h-auto py-2" />
              ) : (
                <input id={id} maxLength={s.max} value={draft[k] as string} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="input" />
              )}
              <p className="mt-1 text-sm text-slate-600">
                {s.help}
                {s.kind === "number" && ` Allowed: ${s.min} to ${s.max}.`}
              </p>
            </div>
          );
        })}
      </div>
      <button type="button" disabled={busy} onClick={save} className="btn btn-primary">
        {anySample ? "Save and confirm" : "Save"}
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>{msg.text}</p>}
    </section>
  );
}

export function RediscoverySettingsForm({ values, sample }: { values: RediscoverySettings; sample: Partial<Record<SettingKey, boolean>> }) {
  return (
    <div className="space-y-6">
      {(Object.keys(GROUPS) as Group[]).map((g) => (
        <GroupForm key={g} group={g} values={values} sample={sample} />
      ))}
    </div>
  );
}

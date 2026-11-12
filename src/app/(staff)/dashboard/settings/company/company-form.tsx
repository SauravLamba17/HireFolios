"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { APP_TIME_ZONE } from "@/lib/ist";
import { send } from "@/lib/send";

type CompanyFields = { name: string; shortName: string; tokenPrefix: string; officeAddress: string; timeZone: string };

export function CompanyForm({ company, logoUrl, timeZones }: { company: CompanyFields; logoUrl: string | null; timeZones: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoMsg, setLogoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setMsg(null);
    const err = await send("/api/settings/company", "PATCH", {
      name: v("name"),
      shortName: v("shortName"),
      tokenPrefix: v("tokenPrefix"),
      officeAddress: v("officeAddress"),
      timeZone: v("timeZone"),
    });
    setMsg({ ok: !err, text: err ?? "Saved." });
    setBusy(false);
    router.refresh();
  }

  async function logo(method: "POST" | "DELETE", file?: File) {
    setBusy(true);
    setLogoMsg(null);
    let err: string | null = null;
    try {
      const body = file ? new FormData() : undefined;
      if (file) body!.set("logo", file);
      const res = await fetch("/api/settings/company", { method, body });
      if (!res.ok) err = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.";
    } catch {
      err = "Could not reach the server. Check the connection.";
    }
    setLogoMsg({ ok: !err, text: err ?? (file ? "Logo saved." : "Logo removed.") });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={onSave} className="card space-y-4 lg:col-span-2" aria-label="Company profile">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="name" className="label">Company name</label>
            <input id="name" name="name" defaultValue={company.name} required minLength={2} maxLength={120} className="input" />
          </div>
          <div>
            <label htmlFor="shortName" className="label">Short name (optional)</label>
            <input id="shortName" name="shortName" defaultValue={company.shortName} maxLength={30} className="input" />
            <p className="mt-1 text-sm text-slate-500">Used where space is short, e.g. the header on small screens.</p>
          </div>
          <div>
            <label htmlFor="tokenPrefix" className="label">Token prefix</label>
            <input id="tokenPrefix" name="tokenPrefix" defaultValue={company.tokenPrefix} required pattern="[A-Za-z0-9]{1,3}" maxLength={3} className="input uppercase" />
            <p className="mt-1 text-sm text-slate-500">1 to 3 letters or digits. Tokens look like {company.tokenPrefix || "A"}-001.</p>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="officeAddress" className="label">Office address (optional)</label>
            <textarea id="officeAddress" name="officeAddress" defaultValue={company.officeAddress} rows={3} maxLength={300} className="input h-auto py-2" />
          </div>
          <div>
            <label htmlFor="timeZone" className="label">Time zone</label>
            <select id="timeZone" name="timeZone" defaultValue={company.timeZone} className="input">
              {timeZones.map((z) => <option key={z} value={z}>{z === APP_TIME_ZONE ? `India (${z})` : z}</option>)}
            </select>
            <p className="mt-1 text-sm text-slate-500">All dates and token days use India time for now.</p>
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>{msg.text}</p>}
      </form>

      <section className="card space-y-4" aria-labelledby="logo-h">
        <h2 id="logo-h" className="text-lg font-semibold">Logo</h2>
        <div className="grid h-32 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element -- private file behind the session cookie */}
          {logoUrl ? <img src={logoUrl} alt="Company logo" className="max-h-28 max-w-full object-contain" /> : <span className="text-slate-500">No logo</span>}
        </div>
        <label className={`btn btn-secondary w-full ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {logoUrl ? "Replace logo" : "Upload logo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            data-testid="logo-upload"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void logo("POST", f);
            }}
          />
        </label>
        {logoUrl && (
          <button type="button" disabled={busy} onClick={() => logo("DELETE")} className="btn btn-secondary w-full">Remove logo</button>
        )}
        <p className="text-sm text-slate-500">PNG, JPEG or WebP, up to 1 MB. Shown in the header, on the lobby TV and in Excel exports.</p>
        {logoMsg && <p role={logoMsg.ok ? "status" : "alert"} className={logoMsg.ok ? "alert-success" : "alert-error"}>{logoMsg.text}</p>}
      </section>
    </div>
  );
}

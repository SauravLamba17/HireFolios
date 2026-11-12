import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { getCompany } from "@/lib/company";
import { formatDateTimeIST, formatDayIST } from "@/lib/ist";
import { listNotices } from "@/lib/notice-db";
import { requireStaff } from "@/lib/session";
import { NoticeEditor, NoticePreview, StartDraft } from "./notice-editor";

export const metadata: Metadata = { title: "Privacy notice" };

export default async function NoticePage() {
  const staff = await requireStaff("settings");
  const [versions, company, [t]] = await Promise.all([
    listNotices(staff.tenantId),
    getCompany(staff.tenantId),
    db.select({ photo: tenants.photoRetentionDays, data: tenants.dataRetentionDays }).from(tenants).where(eq(tenants.id, staff.tenantId)),
  ]);
  const draft = versions.find((v) => v.status === "draft");
  const active = versions.find((v) => v.status === "active")!;
  const vars = { company: company.name, photoDays: t.photo, dataDays: t.data };
  const contact = (v: typeof active) => ({ name: v.contactName, email: v.contactEmail, phone: v.contactPhone });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Privacy notice</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          What the candidate reads and agrees to on the intake screen, in English and Hindi. Change it by editing a draft and publishing it as a new
          version. Published versions are never changed again, and each candidate&apos;s consent keeps the version they were shown.
        </p>
        <p className="mt-2 text-slate-800" data-testid="notice-in-use">
          In use at intake: <strong>{active.version}</strong>
          {active.effectiveDate && <> since {formatDayIST(active.effectiveDate)}</>}
        </p>
        {active.sample && (
          <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            The notice in use is the <strong>starting draft</strong> ({active.version}). Have it checked by your legal adviser (and the Hindi by a native
            speaker), name the contact person for data requests and complaints, then publish your own version.
          </p>
        )}
      </div>

      {draft ? (
        <NoticeEditor draft={{ texts: draft.texts, ...contact(draft) }} vars={vars} />
      ) : (
        <StartDraft />
      )}

      <section className="card space-y-3" aria-labelledby="versions-h">
        <h2 id="versions-h" className="text-lg font-semibold">Published versions</h2>
        <ul className="space-y-3">
          {versions
            .filter((v) => v.status !== "draft")
            .map((v) => (
              <li key={v.id} className="rounded-lg border border-slate-200">
                <details open={v.status === "active" && !draft}>
                  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3 px-4 py-2">
                    <strong>{v.version}</strong>
                    <span className={`rounded-full px-2.5 py-1 text-sm ${v.status === "active" ? "bg-green-100 text-green-900" : "bg-slate-100 text-slate-600"}`}>
                      {v.status === "active" ? "In use" : "Retired (read-only)"}
                    </span>
                    {v.effectiveDate && <span className="text-sm text-slate-600">from {formatDayIST(v.effectiveDate)}</span>}
                    {v.publishedAt && <span className="text-sm text-slate-500">published {formatDateTimeIST(v.publishedAt)}</span>}
                    <span className="text-sm text-slate-600">Contact: {[v.contactName, v.contactEmail, v.contactPhone].filter(Boolean).join(", ") || "not named (HR desk)"}</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <NoticePreview texts={v.texts} vars={vars} contact={contact(v)} />
                  </div>
                </details>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

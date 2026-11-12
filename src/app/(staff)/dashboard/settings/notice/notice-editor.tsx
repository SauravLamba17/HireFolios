"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { contactText, NOTICE_LANGUAGES, NOTICE_PLACEHOLDERS, noticeProblems, renderNotice, type NoticeLanguage, type NoticeText, type NoticeTexts } from "@/lib/notice";
import { send } from "@/lib/send";

type Contact = { name: string | null; email: string | null; phone: string | null };
type Vars = { company: string; photoDays: number; dataDays: number };

function useNoticePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(body: unknown, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send("/api/settings/notice", "POST", body);
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

/** The notice as the candidate will see it (placeholders filled in), in both languages. */
export function NoticePreview({ texts, vars, contact, initial = "en" }: { texts: NoticeTexts; vars: Vars; contact: Contact; initial?: NoticeLanguage }) {
  const [lang, setLang] = useState<NoticeLanguage>(initial);
  const t = renderNotice(texts[lang], { ...vars, contact: contactText(lang, contact) });
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Preview language" className="flex gap-2">
        {NOTICE_LANGUAGES.map((l) => (
          <button key={l.value} type="button" aria-pressed={lang === l.value} onClick={() => setLang(l.value)} className={`btn ${lang === l.value ? "btn-primary" : "btn-secondary"}`}>
            {l.label}
          </button>
        ))}
      </div>
      <div lang={lang} className="space-y-3 rounded-lg bg-slate-50 p-4" aria-label="Notice preview">
        <h3 className="text-xl font-semibold">{t.title}</h3>
        {t.paragraphs.map((p, i) => <p key={i} className="leading-relaxed">{p}</p>)}
        <p className="font-medium">☐ {t.agree}</p>
        <p>☐ {t.talentPool}</p>
        <p>☐ {t.whatsapp}</p>
        <p className="text-sm text-slate-600">Button: {t.continue} · If the first box is not ticked: {t.required}</p>
      </div>
    </div>
  );
}

export function StartDraft() {
  const { busy, post, box } = useNoticePost();
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Change the notice</h2>
      <p className="text-slate-600">Start a draft from the version in use. Nothing changes at intake until you publish it.</p>
      <button type="button" disabled={busy} onClick={() => post({ action: "start" }, "Draft started.")} className="btn btn-primary">
        Start a new version
      </button>
      {box}
    </section>
  );
}

const FIELD_LABELS: Record<keyof Omit<NoticeText, "paragraphs">, string> = {
  title: "Heading",
  agree: "Required tick box (agreement)",
  talentPool: "Optional tick box: talent pool",
  whatsapp: "Optional tick box: WhatsApp",
  continue: "Button",
  required: "Message if the first box is not ticked",
};

export function NoticeEditor({ draft, vars }: { draft: { texts: NoticeTexts } & Contact; vars: Vars }) {
  const { busy, post, box } = useNoticePost();
  const [texts, setTexts] = useState<NoticeTexts>(draft.texts);
  const [contact, setContact] = useState<Contact>({ name: draft.name, email: draft.email, phone: draft.phone });
  const [lang, setLang] = useState<NoticeLanguage>("en");
  const t = texts[lang];
  const setT = (patch: Partial<NoticeText>) => setTexts((all) => ({ ...all, [lang]: { ...all[lang], ...patch } }));
  const body = (action: "save" | "publish") => ({
    action,
    draft: { texts, contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone },
  });
  const problems = noticeProblems(texts);

  return (
    <section className="card space-y-5" aria-labelledby="draft-h">
      <div>
        <h2 id="draft-h" className="text-lg font-semibold">Draft (not shown to candidates yet)</h2>
        <p className="mt-1 text-sm text-slate-600">
          You can use: {Object.entries(NOTICE_PLACEHOLDERS).map(([k, v]) => (
            <span key={k} className="mr-3 inline-block"><code className="rounded bg-slate-100 px-1">{`{${k}}`}</code> {v}</span>
          ))}
        </p>
      </div>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="label">Contact for data requests and complaints (needed to publish)</legend>
        <div>
          <label htmlFor="c-name" className="label">Name</label>
          <input id="c-name" value={contact.name ?? ""} onChange={(e) => setContact({ ...contact, name: e.target.value })} maxLength={100} className="input" />
        </div>
        <div>
          <label htmlFor="c-email" className="label">Email</label>
          <input id="c-email" type="email" value={contact.email ?? ""} onChange={(e) => setContact({ ...contact, email: e.target.value })} maxLength={254} className="input" />
        </div>
        <div>
          <label htmlFor="c-phone" className="label">Phone</label>
          <input id="c-phone" value={contact.phone ?? ""} onChange={(e) => setContact({ ...contact, phone: e.target.value })} maxLength={30} className="input" />
        </div>
      </fieldset>

      <div role="group" aria-label="Edit language" className="flex gap-2">
        {NOTICE_LANGUAGES.map((l) => (
          <button key={l.value} type="button" aria-pressed={lang === l.value} onClick={() => setLang(l.value)} className={`btn ${lang === l.value ? "btn-primary" : "btn-secondary"}`}>
            Edit {l.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4" lang={lang}>
          <div>
            <label htmlFor="n-title" className="label">{FIELD_LABELS.title}</label>
            <input id="n-title" value={t.title} onChange={(e) => setT({ title: e.target.value })} maxLength={200} className="input" />
          </div>
          {t.paragraphs.map((p, i) => (
            <div key={`${lang}-${i}`}>
              <label htmlFor={`n-p-${i}`} className="label">Paragraph {i + 1}</label>
              <textarea
                id={`n-p-${i}`}
                value={p}
                rows={4}
                maxLength={2000}
                onChange={(e) => setT({ paragraphs: t.paragraphs.map((x, j) => (j === i ? e.target.value : x)) })}
                className="input h-auto py-2"
              />
            </div>
          ))}
          <button type="button" disabled={t.paragraphs.length >= 12} onClick={() => setT({ paragraphs: [...t.paragraphs, ""] })} className="btn btn-secondary">
            Add a paragraph
          </button>
          <p className="text-sm text-slate-500">To remove a paragraph, empty its box: empty boxes are dropped when you save.</p>
          {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).filter((k) => k !== "title").map((k) => (
            <div key={k}>
              <label htmlFor={`n-${k}`} className="label">{FIELD_LABELS[k]}</label>
              <textarea id={`n-${k}`} value={t[k]} rows={2} maxLength={500} onChange={(e) => setT({ [k]: e.target.value })} className="input h-auto py-2" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="label">Preview</h3>
          {/* follows the language being edited (keyed: switching the editor resets the preview) */}
          <NoticePreview key={lang} initial={lang} texts={texts} vars={vars} contact={contact} />
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="alert-error list-inside list-disc" aria-label="Before publishing">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => post(body("save"), "Draft saved.")} className="btn btn-secondary">Save draft</button>
        <button
          type="button"
          disabled={busy || problems.length > 0}
          onClick={() => {
            if (window.confirm("Publish this draft? From now on new candidates see it. The current version becomes read-only.")) void post(body("publish"), "Published. New candidates now see this version.");
          }}
          className="btn btn-primary"
        >
          Publish as new version
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Throw away this draft? The version in use stays as it is.")) void post({ action: "discard" }, "Draft discarded.");
          }}
          className="btn btn-secondary"
        >
          Discard draft
        </button>
      </div>
      {box}
    </section>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cvFileKind, makeIntakeDetails, normalizeMobile, type IntakeResult, type LookupResult, type UploadLimits } from "@/lib/intake";
import type { OptionLists } from "@/lib/lists";
import { formatDayIST } from "@/lib/ist";
import { contactText, NOTICE_LANGUAGES, renderNotice, type NoticeLanguage, type NoticeTexts } from "@/lib/notice";
import { OUTCOME_LABELS } from "@/lib/options";
import { Camera, type Shot } from "./camera";
import { DetailsForm, detailsFromPrefill, emptyDetails, toDetailsInput, type DetailsState, type Job } from "./details-form";

const STEPS = [
  { key: "mobile", label: "Mobile" },
  { key: "details", label: "Details" },
  { key: "consent", label: "Consent" },
  { key: "cv", label: "CV" },
  { key: "photo", label: "Photo" },
  { key: "save", label: "Save" },
] as const;
type Step = (typeof STEPS)[number]["key"] | "token";
const indexOf = (s: Step) => (s === "token" ? STEPS.length : STEPS.findIndex((x) => x.key === s));

type ConsentStage = "handover" | "notice" | "refused" | "handback";
type ConsentState = { language: NoticeLanguage; agreed: boolean; talentPool: boolean; whatsapp: boolean };
const noConsent = (): ConsentState => ({ language: "en", agreed: false, talentPool: false, whatsapp: false });

const TOKEN_SECONDS = 30;
const SAVE_TIMEOUT_MS = 60_000;

// crypto.randomUUID needs https; getRandomValues also works on the plain-http office LAN.
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const shot = (blob: Blob): Shot => ({ blob, url: URL.createObjectURL(blob) });

type ActiveNotice = { version: string; texts: NoticeTexts; contact: { name: string | null; email: string | null; phone: string | null } };

export function IntakeWizard({
  jobs,
  company,
  photoDays,
  dataDays,
  lists,
  notice,
  limits,
}: {
  jobs: Job[];
  company: string;
  photoDays: number;
  dataDays: number;
  lists: OptionLists;
  notice: ActiveNotice;
  limits: UploadLimits;
}) {
  const detailsSchema = useMemo(() => makeIntakeDetails(lists), [lists]);
  const { maxCvFiles: MAX_CV_FILES, maxCvPages: MAX_CV_PAGES, maxUploadBytes: MAX_UPLOAD_BYTES } = limits;
  const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
  const [step, setStep] = useState<Step>("mobile");
  const [maxStep, setMaxStep] = useState(0);

  const [mobileInput, setMobileInput] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [details, setDetails] = useState<DetailsState>(emptyDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [consent, setConsent] = useState<ConsentState>(noConsent);
  const [consentStage, setConsentStage] = useState<ConsentStage>("handover");

  const [pages, setPages] = useState<Shot[]>([]);
  const [cvFiles, setCvFiles] = useState<File[]>([]);
  const [showCvCam, setShowCvCam] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pickFiles = useRef<HTMLInputElement>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Shot | null>(null);

  const [requestId, setRequestId] = useState(uuid);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TOKEN_SECONDS);

  // The screen is turned towards the candidate: hide everything HR-only and ignore the back button / Esc.
  const candidateFacing = step === "consent" && (consentStage === "notice" || consentStage === "handback" || consentStage === "refused");
  const dirty = step !== "token" && (mobileInput.trim() !== "" || step !== "mobile");

  const live = useRef({ step, maxStep, candidateFacing });
  live.current = { step, maxStep, candidateFacing };

  const goTo = useCallback((next: Step) => {
    setStep(next);
    setMaxStep((m) => Math.max(m, indexOf(next)));
    window.history.pushState({ ...window.history.state, intakeStep: next }, "");
    window.scrollTo({ top: 0 });
  }, []);

  // Browser / Android back button moves between steps instead of leaving the page.
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, intakeStep: "mobile" }, "");
    const onPop = (e: PopStateEvent) => {
      const target = e.state?.intakeStep as Step | undefined;
      if (!target) return;
      const { step: cur, maxStep: max, candidateFacing: locked } = live.current;
      if (locked || cur === "token" || indexOf(target) > max || target === "token") {
        window.history.pushState({ ...window.history.state, intakeStep: cur }, "");
        return;
      }
      setStep(target);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Unsaved candidate: ask before a reload, closing the tab or following a header link.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && !a.hasAttribute("download") && !confirm("Leave this candidate? Nothing has been saved yet.")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const clearFiles = useCallback(() => {
    setPages((p) => {
      p.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    setPhoto((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    setCvFiles([]);
    setShowCvCam(false);
    setCvError(null);
  }, []);

  const reset = useCallback(() => {
    clearFiles();
    setMobileInput("");
    setLookup(null);
    setLookupError(null);
    setDetails(emptyDetails());
    setErrors({});
    setConsent(noConsent());
    setConsentStage("handover");
    setRequestId(uuid());
    setSaving(false);
    setSaveError(null);
    setResult(null);
    setMaxStep(0);
    goTo("mobile");
  }, [clearFiles, goTo]);

  // Keyboard first: each step puts the cursor on its first field (or the button marked data-autofocus).
  useEffect(() => {
    requestAnimationFrame(() => {
      const root = document.querySelector("[data-step-root]");
      if (!root) return;
      const visible = (el: HTMLElement) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled;
      const marked = [...root.querySelectorAll<HTMLElement>("[data-autofocus]")].find(visible);
      const first = [...root.querySelectorAll<HTMLElement>("input:not(.sr-only), select, textarea, button")].find(visible);
      (marked ?? first)?.focus();
    });
  }, [step, consentStage, photo, lookup]);

  // Esc = back one step (asks first). Not while the candidate is reading the notice, nor on the token screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const { step: cur, candidateFacing: locked } = live.current;
      if (locked || cur === "mobile" || cur === "token") return;
      const prev = STEPS[indexOf(cur) - 1]?.key;
      if (prev && confirm("Go back to the previous step?")) goTo(prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // Token screen clears itself so the next candidate never sees the previous one.
  useEffect(() => {
    if (step !== "token") return;
    setSecondsLeft(TOKEN_SECONDS);
    const t = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [step]);
  useEffect(() => {
    if (step === "token" && secondsLeft <= 0) reset();
  }, [step, secondsLeft, reset]);

  async function onFind(e: FormEvent) {
    e.preventDefault();
    const mobile = normalizeMobile(mobileInput);
    setLookupError(null);
    if (!mobile) return setLookupError("Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.");
    setLookupBusy(true);
    try {
      const res = await fetch(`/api/candidates/lookup?mobile=${mobile}`);
      if (!res.ok) {
        setLookupError(res.status === 401 ? "Your session ended. Sign in again." : ((await res.json().catch(() => null))?.error ?? "Lookup failed. Try again."));
      } else {
        const found = (await res.json()) as LookupResult;
        if (lookup?.mobile !== found.mobile) {
          // Another person: start their form from scratch (or from their saved profile).
          clearFiles();
          setDetails(found.found ? detailsFromPrefill(found.prefill, jobs, lists) : emptyDetails());
          setErrors({});
          setConsent(noConsent());
          setConsentStage("handover");
          setMaxStep(0);
        }
        setMobileInput(found.mobile);
        setLookup(found);
      }
    } catch {
      setLookupError("Could not reach the server. Check the Wi-Fi and try again.");
    }
    setLookupBusy(false);
  }

  function onDetailsNext() {
    const parsed = detailsSchema.safeParse(toDetailsInput(details));
    if (parsed.success) {
      setErrors({});
      setConsentStage(consent.agreed ? "handback" : "handover");
      return goTo("consent");
    }
    const errs: Record<string, string> = {};
    for (const i of parsed.error.issues) errs[i.path[0] === "otherOffer" ? i.path.join(".") : String(i.path[0])] ??= i.message;
    setErrors(errs);
    requestAnimationFrame(() => document.querySelector("[aria-invalid=true], .text-red-700")?.scrollIntoView({ block: "center" }));
  }

  function addCvFiles(list: FileList | File[] | null | undefined) {
    setCvError(null);
    const incoming = [...(list ?? [])];
    const problems: string[] = [];
    const ok = incoming.filter((f) => {
      if (!cvFileKind(f)) problems.push(`${f.name}: use PDF, Word (.docx), JPEG, PNG or WebP`);
      else if (f.size > MAX_UPLOAD_BYTES) problems.push(`${f.name}: larger than ${mb} MB`);
      else return true;
      return false;
    });
    const merged = [...cvFiles, ...ok.filter((f) => !cvFiles.some((c) => c.name === f.name && c.size === f.size))];
    if (merged.length > MAX_CV_FILES) problems.push(`At most ${MAX_CV_FILES} files; the rest were not added`);
    setCvFiles(merged.slice(0, MAX_CV_FILES));
    if (problems.length) setCvError(problems.join(" · "));
  }

  async function onSave() {
    if (saving || !lookup || !photo) return;
    setSaving(true);
    setSaveError(null);
    const fd = new FormData();
    fd.set(
      "data",
      JSON.stringify({
        clientRequestId: requestId,
        mobile: lookup.mobile,
        details: toDetailsInput(details),
        consent: { ...consent, noticeVersion: notice.version },
      }),
    );
    fd.set("photo", photo.blob, "photo.jpg");
    pages.forEach((p, i) => fd.append("cvPage", p.blob, `page-${i + 1}.jpg`));
    cvFiles.forEach((f) => fd.append("cvFile", f, f.name));

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SAVE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/intake", { method: "POST", body: fd, signal: abort.signal });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.token) {
        setResult(body as IntakeResult);
        goTo("token");
      } else if (res.status === 401) {
        setSaveError("Your session ended. Sign in again in a new tab, then come back here and press Save.");
      } else {
        setSaveError(body?.error ?? `Could not save (error ${res.status}). Press Save to try again.`);
      }
    } catch {
      setSaveError(
        navigator.onLine === false
          ? "No network. Check the PC's network connection, then press Save again. The candidate will not be registered twice."
          : "The server did not answer. Press Save again. The candidate will not be registered twice.",
      );
    } finally {
      clearTimeout(timer);
      setSaving(false);
    }
  }

  const job = jobs.find((j) => j.id === details.jobId);
  const text = renderNotice(notice.texts[consent.language], { company, photoDays, dataDays, contact: contactText(consent.language, notice.contact) });
  const cur = indexOf(step);

  const nav = (back: Step | null, next: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-6">
      {back ? (
        <button type="button" onClick={() => goTo(back)} className="btn btn-secondary h-14 px-6 text-lg">
          ← Back
        </button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">New candidate</h1>
        {dirty && step !== "mobile" && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => confirm("Cancel this candidate? Nothing has been saved.") && reset()}
          >
            Cancel
          </button>
        )}
      </div>

      {step !== "token" && (
        <ol className="grid grid-cols-6 gap-1 text-center text-sm" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === cur ? "step" : undefined}
              className={`rounded-md border-b-4 py-2 font-medium ${
                i === cur ? "border-blue-700 text-blue-800" : i < cur ? "border-blue-300 text-slate-700" : "border-slate-200 text-slate-400"
              }`}
            >
              {i < cur ? "✓ " : `${i + 1}. `}
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {step === "mobile" && (
        <section className="card mx-auto max-w-3xl space-y-5" aria-labelledby="mobile-h" data-step-root>
          <h2 id="mobile-h" className="text-lg font-semibold">Candidate&apos;s mobile number</h2>
          <form onSubmit={onFind} className="flex flex-wrap gap-3">
            <label htmlFor="mobile" className="sr-only">Mobile number</label>
            <input
              id="mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
              maxLength={20}
              placeholder="98765 43210"
              value={mobileInput}
              onChange={(e) => setMobileInput(e.target.value)}
              className="input h-16 min-w-60 flex-1 text-2xl tracking-wider"
            />
            <button type="submit" disabled={lookupBusy} className="btn btn-primary h-16 px-8 text-lg">
              {lookupBusy ? "Checking…" : "Find"}
            </button>
          </form>
          {lookupError && <p role="alert" className="alert-error">{lookupError}</p>}

          {lookup && !lookup.found && (
            <p role="status" className="alert-success text-base">New candidate. No earlier visits with this mobile.</p>
          )}
          {lookup?.found && (
            <div className="space-y-4">
              {lookup.cooldown && (
                <div role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3 text-red-900">
                  <p className="font-semibold">Cooldown: rejected recently</p>
                  <p>
                    {lookup.cooldown.reason ? `Reason: ${lookup.cooldown.reason}. ` : ""}Cooldown until {formatDayIST(lookup.cooldown.until)}. Check with the
                    hiring manager before registering again.
                  </p>
                </div>
              )}
              {lookup.today && (
                <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
                  Already registered today: token <strong>{lookup.today.token}</strong> for {lookup.today.job}. Continue only for a different position.
                </p>
              )}
              <div className="flex gap-4 rounded-lg border border-slate-200 p-4">
                {lookup.photoFileId ? (
                  <Image src={`/api/files/${lookup.photoFileId}`} unoptimized width={96} height={128} alt="Last photo" className="h-32 w-24 rounded-md object-cover" />
                ) : (
                  <div className="grid h-32 w-24 place-items-center rounded-md bg-slate-100 text-sm text-slate-500">No photo</div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-blue-800">Returning candidate</p>
                  <p className="text-xl font-semibold">{lookup.prefill.fullName}</p>
                  <p className="text-slate-600">
                    {lookup.prefill.dateOfBirth ? `Born ${formatDayIST(lookup.prefill.dateOfBirth)}` : ""} {lookup.prefill.city ? `· ${lookup.prefill.city}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">Details from the last visit are filled in. Check them with the candidate.</p>
                </div>
              </div>
              {lookup.visits.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="mb-2 text-left font-medium text-slate-700">{lookup.visits.length === 1 ? "Last visit" : `Last ${lookup.visits.length} visits`}</caption>
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Token</th>
                        <th className="px-3 py-2 font-medium">Position</th>
                        <th className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lookup.visits.map((v, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 whitespace-nowrap">{formatDayIST(v.day)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{v.token}</td>
                          <td className="px-3 py-2">{v.job}</td>
                          <td className="px-3 py-2">
                            {v.outcome === "in_progress" ? v.stage : (OUTCOME_LABELS[v.outcome] ?? v.outcome)}
                            {v.rejectReason ? ` (${v.rejectReason})` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {lookup && normalizeMobile(mobileInput) === lookup.mobile &&
            nav(
              null,
              <button type="button" data-autofocus onClick={() => goTo("details")} className="btn btn-primary h-14 px-8 text-lg">
                {lookup.found ? "Continue with this candidate →" : "Next: details →"}
              </button>,
            )}
        </section>
      )}

      {step === "details" && (
        <form
          className="card space-y-6"
          aria-label="Candidate details"
          data-step-root
          onSubmit={(e) => {
            e.preventDefault();
            onDetailsNext();
          }}
        >
          <p className="text-slate-600">
            Mobile <strong className="text-slate-900">{lookup?.mobile}</strong>
            {lookup?.found ? " · returning candidate" : " · new candidate"}
          </p>
          {Object.keys(errors).length > 0 && (
            <p role="alert" className="alert-error">Fix the {Object.keys(errors).length === 1 ? "field" : "fields"} marked in red.</p>
          )}
          <DetailsForm
            value={details}
            onChange={(p) => {
              setDetails((d) => ({ ...d, ...p }));
              // A field's message goes away as soon as HR changes that field.
              setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))));
            }}
            errors={errors}
            jobs={jobs}
            lists={lists}
          />
          {nav(
            "mobile",
            <button type="submit" className="btn btn-primary h-14 px-8 text-lg">
              Next: consent →
            </button>,
          )}
        </form>
      )}

      {step === "consent" && consentStage === "handover" && (
        <section className="card mx-auto max-w-3xl space-y-6 text-center" aria-labelledby="handover-h" data-step-root>
          <p className="text-5xl" aria-hidden="true">🖥️➜🙂</p>
          <h2 id="handover-h" className="text-2xl font-semibold">Please turn the screen towards the candidate</h2>
          <p className="text-slate-600">They read the privacy notice and click &ldquo;I agree&rdquo;. The webcam opens only after that.</p>
          <button type="button" data-autofocus onClick={() => setConsentStage("notice")} className="btn btn-primary h-16 w-full text-xl">
            The candidate can see the screen
          </button>
          {nav("details", <span />)}
        </section>
      )}

      {candidateFacing && (
        // Full screen over the staff header: the candidate only sees the notice.
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 px-4 py-8" data-step-root>
          <div className="mx-auto max-w-3xl space-y-6">
            {consentStage === "notice" && (
              <form
                className="card space-y-5"
                aria-labelledby="notice-h"
                lang={consent.language === "hi" ? "hi" : "en"}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (consent.agreed) setConsentStage("handback");
                }}
              >
                <div className="flex justify-end gap-2" role="group" aria-label="Language / भाषा">
                  {NOTICE_LANGUAGES.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      aria-pressed={consent.language === l.value}
                      onClick={() => setConsent((c) => ({ ...c, language: l.value }))}
                      className={`h-12 rounded-lg border px-5 text-base font-medium ${
                        consent.language === l.value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <h2 id="notice-h" className="text-2xl font-semibold">{text.title}</h2>
                {text.paragraphs.map((p, i) => <p key={i} className="text-xl leading-relaxed text-slate-800">{p}</p>)}
                <div className="space-y-3 pt-2">
                  {(
                    [
                      ["agreed", text.agree, true],
                      ["talentPool", text.talentPool, false],
                      ["whatsapp", text.whatsapp, false],
                    ] as const
                  ).map(([key, label, required]) => (
                    <label
                      key={key}
                      className={`flex min-h-14 cursor-pointer items-start gap-4 rounded-lg border p-4 text-lg ${
                        required ? "border-blue-300 bg-blue-50" : "border-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-autofocus={required || undefined}
                        checked={consent[key]}
                        onChange={(e) => setConsent((c) => ({ ...c, [key]: e.target.checked }))}
                        className="mt-1 size-7 shrink-0 accent-blue-700"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {!consent.agreed && <p className="text-slate-600">{text.required}</p>}
                <button type="submit" disabled={!consent.agreed} className="btn btn-primary h-16 w-full text-xl">
                  {text.continue}
                </button>
                <button type="button" onClick={() => setConsentStage("refused")} className="btn btn-secondary w-full">
                  {consent.language === "hi" ? "मैं सहमत नहीं हूँ" : "I do not agree"}
                </button>
                <p className="text-center text-xs text-slate-400">Notice {notice.version}</p>
              </form>
            )}
            {consentStage === "handback" && (
              <section className="card space-y-6 text-center" aria-labelledby="handback-h">
                <p className="text-5xl" aria-hidden="true">🙏</p>
                <h2 id="handback-h" className="text-2xl font-semibold">
                  {consent.language === "hi" ? "धन्यवाद! कृपया स्क्रीन वापस HR की ओर घुमा दें।" : "Thank you! Please turn the screen back to HR."}
                </h2>
                <button type="button" data-autofocus onClick={() => goTo("cv")} className="btn btn-primary h-16 w-full text-xl">
                  HR: continue to CV
                </button>
                <button type="button" onClick={() => setConsentStage("notice")} className="btn btn-secondary w-full">
                  Show the notice again
                </button>
              </section>
            )}
            {consentStage === "refused" && (
              <section className="card space-y-6 text-center" aria-labelledby="refused-h">
                <h2 id="refused-h" className="text-2xl font-semibold">
                  {consent.language === "hi" ? "कोई बात नहीं। कृपया स्क्रीन वापस HR की ओर घुमा दें।" : "That's fine. Please turn the screen back to HR."}
                </h2>
                <p className="text-slate-600">HR: without consent the candidate can&apos;t be registered here. Nothing has been saved.</p>
                <button
                  type="button"
                  onClick={() => {
                    setConsent((c) => ({ ...c, agreed: false }));
                    setConsentStage("notice");
                  }}
                  className="btn btn-secondary h-14 w-full text-lg"
                >
                  Show the notice again
                </button>
                <button type="button" onClick={reset} className="btn btn-danger h-14 w-full text-lg">
                  Cancel this candidate
                </button>
              </section>
            )}
          </div>
        </div>
      )}

      {step === "cv" && (
        <form
          className="card mx-auto max-w-3xl space-y-5"
          aria-labelledby="cv-h"
          data-step-root
          onSubmit={(e) => {
            e.preventDefault();
            goTo("photo");
          }}
        >
          <div>
            <h2 id="cv-h" className="text-lg font-semibold">CV</h2>
            <p className="text-slate-600">Upload the CV files, or photograph a paper CV with the webcam. You can skip this.</p>
          </div>

          <div
            data-testid="cv-drop"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addCvFiles(e.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed p-6 text-center ${dragOver ? "border-blue-600 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
          >
            <p className="text-lg font-medium">Drop CV files here</p>
            <p className="text-sm text-slate-600">PDF, Word (.docx) or images · up to {MAX_CV_FILES} files · {mb} MB each</p>
            <button type="button" onClick={() => pickFiles.current?.click()} className="btn btn-primary mt-3">
              Upload CV files…
            </button>
            <input
              ref={pickFiles}
              type="file"
              multiple
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-label="CV files"
              data-testid="cv-files"
              onChange={(e) => {
                addCvFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-sm text-slate-600">Candidates can email or WhatsApp their CV to HR. Download it on this PC and drop it here.</p>
          {cvError && <p role="alert" className="alert-error">{cvError}</p>}
          {cvFiles.length > 0 && (
            <ul className="space-y-2" aria-label="CV files to save">
              {cvFiles.map((f) => (
                <li key={`${f.name}-${f.size}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                  <span className="break-all">
                    📄 {f.name} <span className="text-slate-500">({Math.ceil(f.size / 1024)} KB)</span>
                  </span>
                  <button type="button" onClick={() => setCvFiles((all) => all.filter((x) => x !== f))} className="btn btn-danger h-10 text-sm">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={() => setShowCvCam((x) => !x)} aria-expanded={showCvCam} className="btn btn-secondary">
              📷 {showCvCam ? "Hide the webcam" : "Photograph a paper CV with the webcam"}
            </button>
            {showCvCam && pages.length < MAX_CV_PAGES && (
              <Camera
                guide="document"
                maxLong={1800}
                captureLabel={`Capture page ${pages.length + 1}`}
                uploadLabel="Add a page from an image file"
                onCapture={(b) => setPages((p) => (p.length < MAX_CV_PAGES ? [...p, shot(b)] : p))}
              />
            )}
            {pages.length >= MAX_CV_PAGES && <p className="alert-success">{MAX_CV_PAGES} pages captured (the most allowed).</p>}
            {pages.length > 0 && (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-label="Captured pages">
                {pages.map((p, i) => (
                  <li key={p.url} className="space-y-1">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                      <Image src={p.url} alt={`CV page ${i + 1}`} fill unoptimized className="object-contain" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(p.url);
                        setPages((all) => all.filter((x) => x !== p));
                      }}
                      className="btn btn-danger h-10 w-full px-2 text-sm"
                    >
                      Remove {i + 1}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {nav(
            "consent",
            <button type="submit" data-autofocus className="btn btn-primary h-14 px-8 text-lg">
              {pages.length || cvFiles.length ? "Next: photo →" : "Skip CV →"}
            </button>,
          )}
        </form>
      )}

      {step === "photo" && (
        <form
          className="card mx-auto max-w-3xl space-y-5"
          aria-labelledby="photo-h"
          data-step-root
          onSubmit={(e) => {
            e.preventDefault();
            if (photo) goTo("save");
          }}
        >
          <div>
            <h2 id="photo-h" className="text-lg font-semibold">Candidate photo</h2>
            <p className="text-slate-600">Ask the candidate to look at the webcam. Fit the face inside the oval, plain background, no cap or sunglasses.</p>
          </div>
          {photo && (
            <div className="space-y-3">
              <div className="relative mx-auto aspect-[3/4] max-w-sm overflow-hidden rounded-xl border border-slate-200">
                <Image src={photo.url} alt="Candidate photo" fill unoptimized className="object-cover" />
              </div>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(photo.url);
                  setPhoto(null);
                }}
                className="btn btn-secondary h-14 w-full text-lg"
              >
                Retake photo
              </button>
            </div>
          )}
          {/* Stays mounted while the photo is reviewed, so Retake doesn't close and reopen the camera. */}
          <div hidden={photo !== null}>
            <Camera guide="face" maxLong={800} captureLabel="Take photo" uploadLabel="Upload a photo file instead" autoFocusCapture onCapture={(b) => setPhoto(shot(b))} />
          </div>
          {nav(
            "cv",
            <button type="submit" disabled={!photo} data-autofocus className="btn btn-primary h-14 px-8 text-lg">
              Next: save →
            </button>,
          )}
        </form>
      )}

      {step === "save" && lookup && (
        <form
          className="card mx-auto max-w-3xl space-y-5"
          aria-labelledby="save-h"
          data-step-root
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <h2 id="save-h" className="text-lg font-semibold">Check and save</h2>
          <div className="flex gap-4">
            {photo && (
              <div className="relative h-40 w-30 shrink-0 overflow-hidden rounded-md border border-slate-200">
                <Image src={photo.url} alt="Candidate photo" fill unoptimized className="object-cover" />
              </div>
            )}
            <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{details.fullName}</dd>
              <dt className="text-slate-500">Mobile</dt>
              <dd>{lookup.mobile}</dd>
              <dt className="text-slate-500">Position</dt>
              <dd>{job?.title ?? "—"}</dd>
              <dt className="text-slate-500">CV</dt>
              <dd className="break-all">
                {[cvFiles.map((f) => f.name).join(", "), pages.length && `${pages.length} webcam page${pages.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ") || "None"}
              </dd>
              <dt className="text-slate-500">Consent</dt>
              <dd>
                Agreed ({NOTICE_LANGUAGES.find((l) => l.value === consent.language)?.label})
                {consent.talentPool ? " · talent pool" : ""}
                {consent.whatsapp ? " · WhatsApp OK" : ""}
              </dd>
            </dl>
          </div>
          {saveError && <p role="alert" className="alert-error">{saveError}</p>}
          {nav(
            "photo",
            <button type="submit" disabled={saving} data-autofocus className="btn btn-primary h-16 px-10 text-xl">
              {saving ? "Saving…" : "Save and get token"}
            </button>,
          )}
        </form>
      )}

      {step === "token" && result && (
        <section className="card mx-auto max-w-3xl space-y-6 text-center" aria-labelledby="token-h" data-step-root>
          <p className="text-lg text-slate-600">Your token</p>
          <p id="token-h" className="text-8xl font-bold tracking-tight text-blue-800" data-testid="token">{result.token}</p>
          <div>
            <p className="text-2xl font-semibold">{result.fullName}</p>
            <p className="text-lg text-slate-600">{result.jobTitle}</p>
          </div>
          <p className="text-slate-600">Please take a seat. We will call your token.</p>
          {result.duplicates.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-left text-amber-950">
              <p className="font-semibold">For HR: possible duplicate under another mobile</p>
              <ul className="mt-2 space-y-1">
                {result.duplicates.map((d) => (
                  <li key={d.id}>
                    <a href={`/dashboard/candidates/${d.id}`} target="_blank" rel="noreferrer" className="underline">
                      {d.fullName}
                    </a>{" "}
                    (mobile ending {d.mobileLast4}): {d.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" data-autofocus onClick={reset} className="btn btn-primary h-16 w-full text-xl">
            Next candidate
          </button>
          <p className="text-sm text-slate-500">This screen clears in {secondsLeft} s.</p>
        </section>
      )}
    </div>
  );
}

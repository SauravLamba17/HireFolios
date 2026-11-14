// Smoke test against a running server: `npm run smoke` (SMOKE_BASE_URL, default http://localhost:3000).
// Creates two throwaway tenants (so tokens start at A-001), checks intake / lookup / files / search /
// profile end to end, then deletes everything it created, rows and files. Needs the server's settings (.env): the database
// and the same file storage (UPLOAD_DIR, or STORAGE_DRIVER=s3 + S3_*).
import { eq, inArray, sql } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { storage } from "@/lib/storage";
import { DEFAULT_NOTICE_VERSION as NOTICE_VERSION } from "@/lib/notice"; // a new tenant starts with this version
import { planPurge, runPurge } from "@/lib/purge";
import { createStaff } from "@/lib/staff";
import { rediscoverySmoke } from "./smoke-rediscovery";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUN = Date.now().toString(36);
const results: { name: string; ok: boolean; info?: string }[] = [];
const check = (name: string, ok: boolean, info?: unknown) => {
  results.push({ name, ok, info: ok ? undefined : JSON.stringify(info)?.slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${JSON.stringify(info)?.slice(0, 300)}`}`);
};

// Magic bytes are all the server checks; the content does not need to be a viewable picture.
const jpeg = (tag: string) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`smoke-${tag}-${RUN}`)])], { type: "image/jpeg" });
const mobileFor = (n: number) => `6${String(Date.now()).slice(-6)}${String(n).padStart(3, "0")}`;

let cookie = "";
// Better Auth: 3 sign-ins per IP per 10 s, counted until 10 s after the last one.
let signIns: number[] = [];
async function pace() {
  const now = Date.now();
  signIns = signIns.filter((t) => now - t < 10_500);
  if (signIns.length >= 2) await new Promise((r) => setTimeout(r, 10_700 - (now - Math.max(...signIns))));
  signIns = signIns.filter((t) => Date.now() - t < 10_500);
  signIns.push(Date.now());
}
// Another process (e2e, QA) may have used this IP's sign-in budget just before: wait it out once.
async function signInCall(who: unknown, anon = false) {
  await pace();
  const init = { method: "POST", anon, headers: { "content-type": "application/json" }, body: JSON.stringify(who) };
  let res = await call("/api/auth/sign-in/email", init);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 11_000));
    signIns = [Date.now()];
    res = await call("/api/auth/sign-in/email", init);
  }
  return res;
}
async function call(p: string, init: RequestInit & { anon?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (!init.anon && cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET") headers.set("origin", headers.get("origin") ?? BASE);
  return fetch(BASE + p, { ...init, headers, redirect: "manual" });
}

type Details = Record<string, unknown>;
const baseDetails = (jobId: string, over: Details = {}): Details => ({
  jobId,
  fullName: "Smoke Priya Sharma",
  dateOfBirth: "1998-04-12",
  email: `priya-${RUN}@smoke.example.test`,
  city: "Mohali",
  education: "B.Sc (Life Sciences)",
  experienceYears: 2,
  experienceMonths: 6,
  currentCtcLpa: 2.4,
  expectedCtcLpa: 3.5,
  noticeDays: 30,
  languages: ["English", "Hindi"],
  source: "Naukri",
  hrNotes: null,
  certifications: ["CPC"],
  codingSpecialties: ["E/M"],
  ehrSoftware: ["Epic"],
  nightShiftOk: true,
  voiceProcess: false,
  typingWpm: 35,
  skills: "denial management, Excel",
  ...over,
});
const consent = (over: Details = {}) => ({ agreed: true, language: "en", noticeVersion: NOTICE_VERSION, talentPool: true, whatsapp: false, ...over });

function intakeForm(body: unknown, files: { photo?: boolean; pages?: number } = { photo: true, pages: 0 }) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(body));
  if (files.photo) fd.set("photo", jpeg("photo"), "photo.jpg");
  for (let i = 0; i < (files.pages ?? 0); i++) fd.append("cvPage", jpeg(`page${i}`), `page-${i + 1}.jpg`);
  return fd;
}
const postIntake = (body: unknown, files?: { photo?: boolean; pages?: number }) => call("/api/intake", { method: "POST", body: intakeForm(body, files) });

// Files in the server's storage (a folder with STORAGE_DRIVER=local, the bucket with s3): the smoke test reads the
// same settings as the server it tests.
const stored = async (prefix: string) => {
  const keys: string[] = [];
  for await (const o of storage().list(prefix)) keys.push(o.key);
  return keys;
};
const filesOnDisk = async (tenantId: string) => (await stored(`${tenantId}/`)).length;
const fileExists = async (key: string) => (await storage().get(key)) !== null;

async function makeTenant(slug: string) {
  const [t] = await db.insert(s.tenants).values({ name: `Smoke ${slug}`, slug: `smoke-${slug}-${RUN}`, tokenPrefix: "A" }).returning();
  await db.insert(s.stages).values([
    { tenantId: t.id, name: "Registered", position: 1 },
    { tenantId: t.id, name: "HR screen", position: 2, isInterview: true, criteria: [{ label: "Communication", required: true }] },
  ]);
  await db.insert(s.rejectReasons).values(
    [
      ["Typing speed below requirement", "typing_voice"],
      ["Notice period too long", "notice_timing"],
      ["Salary expectation above budget", "cost"],
    ].map(([label, categoryCode], i) => ({ tenantId: t.id, label, position: i + 1, categoryCode })),
  );
  await db.insert(s.locations).values({ tenantId: t.id, name: "Smoke office" });
  const jobsRows = await db
    .insert(s.jobs)
    .values([
      { tenantId: t.id, title: "Smoke AR Caller" },
      { tenantId: t.id, title: "Smoke Closed Job", status: "closed", active: false },
    ])
    .returning();
  return { tenant: t, open: jobsRows[0], closed: jobsRows[1] };
}

async function cleanup(tenantIds: string[]) {
  if (tenantIds.length === 0) return;
  const t = inArray(s.candidateFiles.tenantId, tenantIds);
  await db.delete(s.candidateFiles).where(t);
  await db.delete(s.scorecards).where(inArray(s.scorecards.tenantId, tenantIds));
  await db.delete(s.queueEvents).where(inArray(s.queueEvents.tenantId, tenantIds));
  await db.delete(s.consents).where(inArray(s.consents.tenantId, tenantIds));
  await db.delete(s.dataExports).where(inArray(s.dataExports.tenantId, tenantIds));
  await db.delete(s.applications).where(inArray(s.applications.tenantId, tenantIds));
  await db.delete(s.panels).where(inArray(s.panels.tenantId, tenantIds));
  await db.delete(s.drives).where(inArray(s.drives.tenantId, tenantIds));
  await db.delete(s.rejectReasons).where(inArray(s.rejectReasons.tenantId, tenantIds));
  await db.delete(s.candidates).where(inArray(s.candidates.tenantId, tenantIds));
  await db.delete(s.dailyCounters).where(inArray(s.dailyCounters.tenantId, tenantIds));
  await db.delete(s.auditLog).where(inArray(s.auditLog.tenantId, tenantIds));
  await db.delete(s.optionItems).where(inArray(s.optionItems.tenantId, tenantIds));
  await db.delete(s.privacyNotices).where(inArray(s.privacyNotices.tenantId, tenantIds));
  await db.delete(s.users).where(inArray(s.users.tenantId, tenantIds)); // sessions + accounts cascade
  await db.delete(s.jobs).where(inArray(s.jobs.tenantId, tenantIds));
  await db.delete(s.stages).where(inArray(s.stages.tenantId, tenantIds));
  await db.delete(s.locations).where(inArray(s.locations.tenantId, tenantIds));
  await db.delete(s.tenants).where(inArray(s.tenants.id, tenantIds));
  for (const id of tenantIds) await storage().delete(await stored(`${id}/`));
}

async function main() {
  const check0 = await storage().check();
  if (!check0.ok) throw new Error(`File storage (${storage().driver}) is not reachable: ${check0.detail}. Use the same storage settings as the server.`);
  console.log(`storage: ${storage().driver}`);
  const created: string[] = [];
  try {
    const A = await makeTenant("a");
    const B = await makeTenant("b");
    created.push(A.tenant.id, B.tenant.id);
    const hr = { email: `hr-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` };
    await db.transaction((tx) => createStaff(tx, { tenantId: A.tenant.id, name: "Smoke HR", email: hr.email, role: "hr", password: hr.password, temporary: false }));

    // Tenant B: one candidate with a photo row, to prove A can't reach it.
    const [bCand] = await db.insert(s.candidates).values({ tenantId: B.tenant.id, fullName: "Smoke Other Tenant", mobile: mobileFor(900) }).returning();
    const [bFile] = await db
      .insert(s.candidateFiles)
      .values({ tenantId: B.tenant.id, candidateId: bCand.id, kind: "photo", storageKey: `${B.tenant.id}/${bCand.id}/x.jpg`, mimeType: "image/jpeg", sizeBytes: 1 })
      .returning();

    const m1 = mobileFor(1), m2 = mobileFor(2), m3 = mobileFor(3);

    let r = await call(`/api/candidates/lookup?mobile=${m1}`, { anon: true });
    check("lookup signed out → 401", r.status === 401, r.status);

    r = await signInCall(hr);
    cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    check("HR signs in", r.status === 200 && cookie.includes("session_token"), r.status);

    r = await call(`/api/candidates/lookup?mobile=12345`);
    check("lookup with a bad mobile → 400", r.status === 400, r.status);
    r = await call(`/api/candidates/lookup?mobile=${encodeURIComponent(`+91 ${m1.slice(0, 5)}-${m1.slice(5)}`)}`);
    let j = await r.json();
    check("lookup normalises +91 / spaces / dashes, new mobile → not found", r.status === 200 && j.found === false && j.mobile === m1, j);

    const req1 = { clientRequestId: crypto.randomUUID(), mobile: m1, details: baseDetails(A.open.id), consent: consent() };
    r = await postIntake(req1, { photo: false });
    j = await r.json();
    check("intake without photo → 400", r.status === 400 && /photo/i.test(j.error), j);
    r = await postIntake({ ...req1, details: baseDetails(A.open.id, { dateOfBirth: `${new Date().getFullYear() - 17}-01-01` }) });
    j = await r.json();
    check("intake under 18 → 400", r.status === 400 && /18/.test(j.error), j);
    r = await postIntake({ ...req1, consent: consent({ agreed: false }) });
    j = await r.json();
    check("intake without consent → 400", r.status === 400 && /consent/i.test(j.error), j);
    r = await postIntake({ ...req1, consent: consent({ noticeVersion: "old" }) });
    check("intake with an outdated notice version → 400", r.status === 400, r.status);
    r = await postIntake({ ...req1, details: baseDetails(A.closed.id) });
    j = await r.json();
    check("intake for a closed job → 400", r.status === 400 && /not open/i.test(j.error), j);
    r = await postIntake({ ...req1, details: baseDetails(B.open.id) });
    check("intake for another tenant's job → 400", r.status === 400, r.status);
    r = await call("/api/intake", { method: "POST", body: intakeForm(req1, { photo: true, pages: 2 }), headers: { origin: "http://evil.example" } });
    check("cross-site intake POST → 403", r.status === 403, r.status);
    check("rejected saves wrote no files", (await filesOnDisk(A.tenant.id)) === 0, await filesOnDisk(A.tenant.id));

    r = await postIntake(req1, { photo: true, pages: 2 });
    const first = await r.json();
    check("first save → 201, token A-001", r.status === 201 && first.token === "A-001" && first.returning === false, first);

    r = await postIntake(req1, { photo: true, pages: 2 });
    j = await r.json();
    const apps1 = await db.$count(s.applications, eq(s.applications.candidateId, first.candidateId));
    const files1 = await db.$count(s.candidateFiles, eq(s.candidateFiles.candidateId, first.candidateId));
    check("retry same client_request_id → same token, no duplicate", r.status === 200 && j.token === "A-001" && apps1 === 1 && files1 === 3, { status: r.status, token: j.token, apps1, files1 });
    check(`files stored in ${storage().driver} storage under <tenant>/<candidate>/`, (await stored(`${A.tenant.id}/${first.candidateId}/`)).length === 3);

    const [consentRow] = await db.select().from(s.consents).where(eq(s.consents.applicationId, first.applicationId));
    check("consent row saved with version, language, purposes", consentRow?.noticeVersion === NOTICE_VERSION && consentRow.language === "en" && consentRow.talentPool === true && consentRow.whatsapp === false, consentRow);
    const [cand] = await db.select().from(s.candidates).where(eq(s.candidates.id, first.candidateId));
    check("money stored as whole rupees (2.4 / 3.5 LPA)", cand.currentCtc === 240000 && cand.expectedCtc === 350000, [cand.currentCtc, cand.expectedCtc]);
    check("RCM fields stored", cand.certifications.join() === "CPC" && cand.ehrSoftware.join() === "Epic" && cand.nightShiftOk === true && cand.typingWpm === 35 && cand.experienceMonths === 30, cand);

    r = await call(`/api/candidates/lookup?mobile=${m1}`);
    j = await r.json();
    check("returning candidate found with photo, prefill and visit", j.found && j.photoFileId && j.prefill.fullName === "Smoke Priya Sharma" && j.visits.length === 1 && j.today?.token === "A-001" && j.prefill.expectedCtcLpa === 3.5, j);
    check("no cooldown without a rejection", j.cooldown === null, j.cooldown);
    const photoId: string = j.photoFileId;

    r = await postIntake({ ...req1, clientRequestId: crypto.randomUUID() }, { photo: true });
    j = await r.json();
    check("second visit → A-002, marked returning", r.status === 201 && j.token === "A-002" && j.returning === true, j);

    // Double tap: two identical requests at once → one application, same token, no orphan files.
    const req2 = { clientRequestId: crypto.randomUUID(), mobile: m2, details: baseDetails(A.open.id, { fullName: "Smoke Priya Sharmaa", email: null, certifications: [], codingSpecialties: [], ehrSoftware: ["eClinicalWorks"], nightShiftOk: false, voiceProcess: true, skills: "payment posting" }), consent: consent({ talentPool: false }) };
    const [d1, d2] = await Promise.all([postIntake(req2, { photo: true, pages: 1 }), postIntake(req2, { photo: true, pages: 1 })]);
    const [b1, b2] = await Promise.all([d1.json(), d2.json()]);
    const dupApps = await db.$count(s.applications, eq(s.applications.clientRequestId, req2.clientRequestId));
    const dbFiles = await db.$count(s.candidateFiles, eq(s.candidateFiles.tenantId, A.tenant.id));
    check("double-tap Save → one application, same token", b1.token === b2.token && b1.token === "A-003" && dupApps === 1, { b1: b1.token ?? b1, b2: b2.token ?? b2, dupApps });
    check("no orphan files in storage after the losing request", (await filesOnDisk(A.tenant.id)) === dbFiles, { stored: await filesOnDisk(A.tenant.id), db: dbFiles });
    check("similar name + same DOB under another mobile → possible duplicate", b1.duplicates?.some((d: { id: string; reason: string }) => d.id === first.candidateId && /similar name/.test(d.reason)), b1.duplicates);

    const req3 = { clientRequestId: crypto.randomUUID(), mobile: m3, details: baseDetails(A.open.id, { fullName: "Smoke Rahul Verma", dateOfBirth: "1995-09-01", certifications: ["CCS"], codingSpecialties: [], ehrSoftware: ["NextGen"], nightShiftOk: false, skills: "charge entry" }), consent: consent() };
    r = await postIntake(req3);
    j = await r.json();
    check("same email under another mobile → possible duplicate", r.status === 201 && j.token === "A-004" && j.duplicates.some((d: { id: string; reason: string }) => d.id === first.candidateId && d.reason === "same email"), j);

    const page = async (qs: string) => (await call(`/dashboard?${qs}`)).text();
    const names = (html: string) => ["Smoke Priya Sharma<", "Smoke Priya Sharmaa<", "Smoke Rahul Verma<"].map((n) => html.includes(n));
    const expect = async (label: string, qs: string, want: boolean[]) => {
      const got = names(await page(qs));
      check(`search ${label}`, got.join() === want.join(), { qs, got });
    };
    await expect("by skill (denial)", "q=denial", [true, false, false]);
    await expect("by certification text (CPC)", "q=CPC", [true, false, false]);
    await expect("by certification filter (CPC)", "cert=CPC", [true, false, false]);
    await expect("by software (Epic)", "q=epic", [true, false, false]);
    await expect("by software filter (Epic)", "ehr=Epic", [true, false, false]);
    await expect("night shift filter", "night=yes", [true, false, false]);
    await expect("voice process filter", "voice=yes", [false, true, false]);
    await expect("talent pool filter", "pool=yes", [true, false, true]);
    await expect("fuzzy name (Rahul Varma)", "q=Rahul+Varma", [false, false, true]);
    await expect("fuzzy name (Pirya Sharma)", "q=Pirya+Sharma", [true, true, false]);
    await expect("partial mobile (last 5 digits)", `q=${m3.slice(-5)}`, [false, false, true]);
    await expect("email (part with @)", `q=priya-${RUN}%40smoke`, [true, false, true]);
    await expect("city full text (mohali)", "q=mohali", [true, true, true]);
    await expect("position filter, other job", `job=${A.closed.id}`, [false, false, false]);
    const empty = await page("q=zzzzqqq");
    check("no results → empty state", empty.includes("No candidates match"));
    const garbage = await call("/dashboard?page=abc&status=bogus&job=not-a-uuid&from=x");
    check("bad filter values in URL are ignored, not a 500", garbage.status === 200, garbage.status);

    r = await call(`/api/files/${photoId}`);
    if (r.status === 302) {
      // S3_SIGNED_URLS=on: a short-lived signed link, never cached; it stops working after S3_SIGNED_URL_SECONDS
      const link = r.headers.get("location") ?? "";
      const seconds = Number(new URL(link).searchParams.get("X-Amz-Expires"));
      check(
        "file: signed S3 link (no-store) with the configured expiry",
        r.headers.get("cache-control") === "no-store" && seconds === Number(process.env.S3_SIGNED_URL_SECONDS || 60),
        [seconds, ...r.headers],
      );
      const got = await fetch(link);
      check("file: signed link serves the photo as image/jpeg", got.status === 200 && got.headers.get("content-type") === "image/jpeg", got.status);
      if (seconds <= 15) {
        await new Promise((res) => setTimeout(res, (seconds + 2) * 1000));
        const late = await fetch(link);
        check("file: signed link refused after it expires", late.status === 403, late.status);
      }
    } else
      check(
        "file served to same-tenant staff with nosniff + private cache",
        r.status === 200 && r.headers.get("content-type") === "image/jpeg" && r.headers.get("x-content-type-options") === "nosniff" && /private/.test(r.headers.get("cache-control") ?? ""),
        [r.status, ...r.headers],
      );
    r = await call(`/api/files/${photoId}`, { anon: true });
    check("file signed out → 401", r.status === 401, r.status);
    r = await call(`/api/files/${bFile.id}`);
    check("file of another tenant → 404", r.status === 404, r.status);
    r = await call(`/api/files/not-a-uuid`);
    check("file with a malformed id → 404", r.status === 404, r.status);

    r = await call(`/dashboard/candidates/${first.candidateId}`);
    const profile = await r.text();
    const cvPages = await db.select({ id: s.candidateFiles.id }).from(s.candidateFiles).where(sql`${s.candidateFiles.candidateId} = ${first.candidateId} and ${s.candidateFiles.kind} = 'cv_page'`);
    check("profile shows CV pages", r.status === 200 && cvPages.length === 2 && cvPages.every((p) => profile.includes(`/api/files/${p.id}`)) && /Page (<!-- -->)?2/.test(profile), { status: r.status, pages: cvPages.length, ids: cvPages.map((p) => profile.includes(p.id)) });
    check("profile shows RCM fields and consent", profile.includes("CPC") && profile.includes("Epic") && profile.includes(NOTICE_VERSION) && profile.includes("3.5 LPA"));
    r = await call(`/dashboard/candidates/${bCand.id}`);
    check("profile of another tenant → 404", r.status === 404, r.status);

    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, A.tenant.id));
    check("profile view audited (candidate.view)", audits.some((a) => a.action === "candidate.view" && a.entityId === first.candidateId));
    const pii = [m1, m2, m3, "Smoke Priya", "Rahul", "@smoke.example.test", "Mohali"];
    check("audit meta holds ids and codes only", audits.every((a) => !pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p))), audits.map((a) => a.meta));

    r = await call("/api/settings/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
    check("HR can't change settings → 403", r.status === 403, r.status);

    // ---------- Phase 2: drive day ----------
    const people = {
      i1: { email: `int1-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` },
      hrB: { email: `hrb-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` },
      tv: { email: `tv-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` },
      adm: { email: `adm-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` },
    };
    const ids: Record<string, string> = {};
    await db.transaction(async (tx) => {
      ids.i1 = (await createStaff(tx, { tenantId: A.tenant.id, name: "Smoke Interviewer", email: people.i1.email, role: "interviewer", password: people.i1.password, temporary: false }))!;
      ids.hrB = (await createStaff(tx, { tenantId: B.tenant.id, name: "Smoke HR B", email: people.hrB.email, role: "hr", password: people.hrB.password, temporary: false }))!;
      ids.tv = (await createStaff(tx, { tenantId: A.tenant.id, name: "Smoke Lobby TV", email: people.tv.email, role: "display", password: people.tv.password, temporary: false }))!;
      ids.adm = (await createStaff(tx, { tenantId: A.tenant.id, name: "Smoke Admin", email: people.adm.email, role: "admin", password: people.adm.password, temporary: false }))!;
    });
    const hrCookie = cookie;
    const cookies: Record<string, string> = {};
    for (const [k, who] of Object.entries(people)) {
      const res = await signInCall(who, true);
      cookies[k] = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    }
    const as = (who: string) => (p: string, init: RequestInit = {}) => {
      cookie = who === "hr" ? hrCookie : cookies[who];
      return call(p, init);
    };
    const drive = (who: string, body: unknown) => as(who)("/api/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const [hrScreen] = await db.select().from(s.stages).where(sql`${s.stages.tenantId} = ${A.tenant.id} and ${s.stages.name} = 'HR screen'`);

    // SSE: tenant A's stream gets A's pings and never B's; pings carry no data.
    const ctrl = new AbortController();
    cookie = hrCookie;
    const sse = await call("/api/live", { signal: ctrl.signal });
    check("SSE stream opens for HR (text/event-stream)", sse.status === 200 && (sse.headers.get("content-type") ?? "").startsWith("text/event-stream"), sse.status);
    let streamed = "";
    const reader = sse.body!.getReader();
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          streamed += new TextDecoder().decode(value);
        }
      } catch {
        // aborted
      }
    })();
    await new Promise((r) => setTimeout(r, 400));
    const before = (streamed.match(/event: change/g) ?? []).length;
    r = await drive("hrB", { action: "addPanel", name: "B room", interviewerId: ids.hrB, stageId: hrScreen.id });
    await new Promise((r) => setTimeout(r, 800));
    const afterB = (streamed.match(/event: change/g) ?? []).length;
    check("tenant B's change does not reach tenant A's stream", afterB === before, { before, afterB, bStatus: r.status });
    r = await drive("hr", { action: "addPanel", name: "Room 1", interviewerId: ids.i1, stageId: hrScreen.id });
    check("HR adds a panel (Room 1, interviewer, HR screen)", r.status === 200, await r.clone().json());
    await new Promise((r) => setTimeout(r, 800));
    const afterA = (streamed.match(/event: change/g) ?? []).length;
    check("tenant A's own change arrives on its stream", afterA > afterB, { afterB, afterA });
    check("stream carries no names, tokens or mobiles", !/Smoke|A-0|\b[6-9]\d{9}\b/.test(streamed), streamed.slice(0, 300));
    ctrl.abort();
    await pump;
    r = await as("tv")("/api/live");
    check("lobby TV login may open the stream", r.status === 200, r.status);
    await r.body?.cancel();

    // Assign m2 (no talent pool) to Room 1 by hand, then the interviewer rejects with a reason.
    const [panel] = await db.select().from(s.panels).where(sql`${s.panels.tenantId} = ${A.tenant.id} and ${s.panels.name} = 'Room 1'`);
    const [m2app] = await db.select().from(s.applications).where(eq(s.applications.clientRequestId, req2.clientRequestId));
    r = await drive("hr", { action: "assign", panelId: panel.id, applicationId: m2app.id });
    check("HR assigns a waiting candidate to Room 1", r.status === 200, await r.clone().json());
    r = await drive("hr", { action: "assign", panelId: panel.id });
    check("a busy panel can't take a second candidate", r.status === 400, r.status);

    const unassignedPhoto = photoId; // candidate 1 has never been in Room 1
    const [m2photo] = await db.select({ id: s.candidateFiles.id }).from(s.candidateFiles).where(sql`${s.candidateFiles.candidateId} = ${m2app.candidateId} and ${s.candidateFiles.kind} = 'photo'`);
    const iv = as("i1");
    check("interviewer opens the assigned candidate's profile", (await iv(`/dashboard/candidates/${m2app.candidateId}`)).status === 200);
    check("interviewer gets 404 for a candidate never assigned to them", (await iv(`/dashboard/candidates/${first.candidateId}`)).status === 404);
    check("interviewer gets 404 for an unassigned candidate's file", (await iv(`/api/files/${unassignedPhoto}`)).status === 404);
    check("interviewer can open the assigned candidate's photo", [200, 302].includes((await iv(`/api/files/${m2photo.id}`)).status)); // 302: a signed S3 link (S3_SIGNED_URLS=on)
    check("interviewer has no candidate list (redirect to /interview)", new URL((await iv("/dashboard")).headers.get("location") ?? "x:", BASE).pathname === "/interview");
    check("interviewer can't act on the drive board (403)", (await drive("i1", { action: "endDay" })).status === 403);
    check("lobby TV login: candidate files 404, board redirect, intake API 403", (await as("tv")(`/api/files/${m2photo.id}`)).status === 404 && (await as("tv")("/dashboard/drive")).status === 307 && (await as("tv")(`/api/candidates/lookup?mobile=${m1}`)).status === 403);

    const decide = (body: unknown) => iv("/api/interview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    r = await decide({ action: "decide", applicationId: m2app.id, scores: { Communication: 2 }, notes: "", decision: "reject", rejectReason: "Not on the list" });
    check("reject with a reason that is not on the list → 400", r.status === 400, await r.clone().json());
    r = await decide({ action: "decide", applicationId: m2app.id, scores: { Communication: 2 }, notes: "slow typing", decision: "reject", rejectReason: "Typing speed below requirement" });
    check("interviewer rejects with a listed reason", r.status === 200, await r.clone().json());
    const [m2after] = await db.select().from(s.applications).where(eq(s.applications.id, m2app.id));
    const days = (a: Date | null, b: Date | null) => (a && b ? Math.round((a.getTime() - b.getTime()) / 86_400_000) : null);
    check(
      "reject sets decided_at and purge dates (365 / 180 days)",
      m2after.outcome === "rejected" && m2after.rejectReason === "Typing speed below requirement" && days(m2after.purgeAfter, m2after.decidedAt) === 365 && days(m2after.photoPurgeAfter, m2after.decidedAt) === 180 && m2after.panelId === null,
      m2after,
    );
    const [pAfter] = await db.select({ status: s.panels.status }).from(s.panels).where(eq(s.panels.id, panel.id));
    check("submitting frees the panel", pAfter.status === "available", pAfter);

    // Talent-pool candidate (candidate 1 opted in): reject → decided, but no purge dates.
    const [m1app] = await db.select().from(s.applications).where(eq(s.applications.clientRequestId, req1.clientRequestId));
    r = await drive("hr", { action: "assign", panelId: panel.id, applicationId: m1app.id });
    r = await decide({ action: "decide", applicationId: m1app.id, scores: {}, notes: "", decision: "reject", rejectReason: "Notice period too long" });
    check("a required criterion left unrated → 400", r.status === 400 && /Communication/.test((await r.json()).error), r.status);
    r = await decide({ action: "decide", applicationId: m1app.id, scores: { Communication: 3 }, notes: "", decision: "reject", rejectReason: "Notice period too long" });
    const [m1after] = await db.select().from(s.applications).where(eq(s.applications.id, m1app.id));
    check("talent-pool opt-in: rejected without purge dates", r.status === 200 && m1after.outcome === "rejected" && m1after.decidedAt !== null && m1after.purgeAfter === null && m1after.photoPurgeAfter === null, m1after);
    check("interviewer may now open candidate 1 (assigned earlier)", (await iv(`/dashboard/candidates/${first.candidateId}`)).status === 200);
    const audit2 = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, A.tenant.id));
    check("drive actions audited with ids only", audit2.some((a) => a.action === "interview.decision") && audit2.some((a) => a.action === "queue.assign") && audit2.every((a) => !pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p))));
    cookie = hrCookie;

    // ---------- Phase 3.6: rediscovery (scripts/smoke-rediscovery.ts) ----------
    await rediscoverySmoke({ check, as, tenantA: A.tenant.id, tenantB: B.tenant.id, panelId: panel.id, hrScreenId: hrScreen.id, pii, candidates: { pool: first.candidateId, rejected: m2app.candidateId } });
    cookie = hrCookie;

    // ---------- Phase 3: the deletion job, in its own tenant, with dates shifted into the past ----------
    const P = await makeTenant("purge");
    created.push(P.tenant.id);
    const [stg] = await db.select().from(s.stages).where(sql`${s.stages.tenantId} = ${P.tenant.id} and ${s.stages.name} = 'Registered'`);
    const [locP] = await db.select().from(s.locations).where(eq(s.locations.tenantId, P.tenant.id));
    const DAY = 864e5;
    const nowP = new Date();
    const ago = (d: number) => new Date(nowP.getTime() - d * DAY);
    const ahead = (d: number) => new Date(nowP.getTime() + d * DAY);
    const mkCandidate = async (label: string, visits: { outcome: string; purge: Date | null; photo: Date | null }[], pool: boolean) => {
      const [c] = await db.insert(s.candidates).values({ tenantId: P.tenant.id, fullName: `Smoke Purge ${label}`, mobile: mobileFor(500 + Object.keys(purgeCase).length) }).returning();
      const apps: string[] = [];
      const files: string[] = [];
      for (const [i, v] of visits.entries()) {
        const [a] = await db
          .insert(s.applications)
          .values({
            tenantId: P.tenant.id, candidateId: c.id, jobId: P.open.id, locationId: locP.id, token: `A-${label}${i}`, tokenDate: "2025-01-01",
            currentStageId: stg.id, clientRequestId: crypto.randomUUID(), outcome: v.outcome as never, rejectReason: v.outcome === "rejected" ? "x" : null,
            decidedAt: v.purge ? ago(400) : null, purgeAfter: v.purge, photoPurgeAfter: v.photo,
          })
          .returning();
        apps.push(a.id);
        for (const kind of ["photo", "cv_page"] as const) {
          const fid = crypto.randomUUID();
          const key = `${P.tenant.id}/${c.id}/${fid}.jpg`;
          await storage().put(key, jpegBytes, "image/jpeg");
          await db.insert(s.candidateFiles).values({ id: fid, tenantId: P.tenant.id, candidateId: c.id, applicationId: a.id, kind, storageKey: key, mimeType: "image/jpeg", sizeBytes: 4 });
          files.push(key);
        }
        await db.insert(s.consents).values({ tenantId: P.tenant.id, candidateId: c.id, applicationId: a.id, noticeVersion: "t", talentPool: pool });
      }
      purgeCase[label] = { id: c.id, apps, files };
    };
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const purgeCase: Record<string, { id: string; apps: string[]; files: string[] }> = {};
    await mkCandidate("old", [{ outcome: "rejected", purge: ago(1), photo: ago(100) }], false); // → erase all
    await mkCandidate("photoOnly", [{ outcome: "no_show", purge: ahead(30), photo: ago(1) }], false); // → photo only
    await mkCandidate("pool", [{ outcome: "rejected", purge: ago(1), photo: ago(1) }], true); // → keep (talent pool)
    await mkCandidate("joined", [{ outcome: "rejected", purge: ago(10), photo: ahead(10) }, { outcome: "joined", purge: null, photo: null }], false); // → keep
    await mkCandidate("newer", [{ outcome: "rejected", purge: ago(10), photo: ahead(10) }, { outcome: "in_progress", purge: null, photo: null }], false); // → keep

    const dry = await runPurge({ dryRun: true, tenantId: P.tenant.id, now: nowP });
    check("deletion dry run: 1 candidate and 1 photo due, nothing deleted yet", JSON.stringify(dry) === JSON.stringify([{ tenantId: P.tenant.id, photos: 1, candidates: 1, files: 0 }]) && (await fileExists(purgeCase.old.files[0])), dry);
    const later = await planPurge(new Date(nowP.getTime() + 31 * DAY), P.tenant.id);
    check("dry run 31 days ahead also includes the photo-only candidate", later[0]?.candidates.sort().join() === [purgeCase.old.id, purgeCase.photoOnly.id].sort().join(), later);
    const realRun = await runPurge({ dryRun: false, tenantId: P.tenant.id, now: nowP });
    check("real run: same counts as the dry run, files removed", realRun[0].candidates === 1 && realRun[0].photos === 1 && realRun[0].files === 3, realRun);
    const exists = async (table: typeof s.candidates, id: string) => (await db.$count(table, eq(table.id, id))) === 1;
    const state = new Map<string, boolean>();
    for (const c of Object.values(purgeCase)) for (const k of c.files) state.set(k, await fileExists(k));
    const fileState = (k: string) => state.get(k) === true;
    check(
      "erased: the expired candidate, rows and files",
      !(await exists(s.candidates, purgeCase.old.id)) && (await db.$count(s.applications, eq(s.applications.candidateId, purgeCase.old.id))) === 0 && purgeCase.old.files.every((k) => !fileState(k)),
    );
    const [ph] = await db.select().from(s.candidateFiles).where(sql`${s.candidateFiles.candidateId} = ${purgeCase.photoOnly.id} and ${s.candidateFiles.kind} = 'photo'`);
    check(
      "photo-only: photo gone (row marked), CV page and candidate kept",
      ph.deletedAt !== null && !fileState(purgeCase.photoOnly.files[0]) && fileState(purgeCase.photoOnly.files[1]) && (await exists(s.candidates, purgeCase.photoOnly.id)),
    );
    for (const k of ["pool", "joined", "newer"]) {
      check(`kept untouched: ${k}`, (await exists(s.candidates, purgeCase[k].id)) && purgeCase[k].files.every(fileState) && (await db.$count(s.candidateFiles, sql`${s.candidateFiles.candidateId} = ${purgeCase[k].id} and ${s.candidateFiles.deletedAt} is not null`)) === 0);
    }
    const runs = await db.select().from(s.auditLog).where(sql`${s.auditLog.tenantId} = ${P.tenant.id} and ${s.auditLog.action} = 'retention.purge'`);
    check("one audit entry for the run, counts only", runs.length === 1 && runs[0].meta?.photos === 1 && runs[0].meta?.candidates === 1 && runs[0].meta?.files === 3 && Object.keys(runs[0].meta ?? {}).length === 3, runs.map((x) => x.meta));
    const again = await runPurge({ dryRun: false, tenantId: P.tenant.id, now: nowP });
    check("running again deletes nothing more (idempotent)", again[0].candidates === 0 && again[0].photos === 0, again);
  } finally {
    await cleanup(created);
    const left = created.length ? await db.$count(s.tenants, inArray(s.tenants.id, created)) : 0;
    let filesLeft = 0;
    for (const id of created) filesLeft += await filesOnDisk(id);
    check("cleanup removed smoke tenants and files", left === 0 && filesLeft === 0, { left, filesLeft });
  }
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: "smoke crashed", ok: false });
  })
  .finally(async () => {
    await pgClient.end();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed against ${BASE}`);
    process.exitCode = failed ? 1 : 0;
  });

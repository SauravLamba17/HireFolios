// Excel / CSV exports: column lists and row shaping (pure, unit-tested) plus the writers.
// Never photos or files; personal data only where the export is meant for it (joined employees).
import "server-only";
import ExcelJS from "exceljs";
import { experienceLabel, OUTCOME_LABELS } from "@/lib/options";
import { formatDateTimeIST, formatDayIST } from "@/lib/ist";
import { rupeesToLpa } from "@/lib/money";

export type Column<T> = { header: string; width: number; value: (row: T) => string | number | null };

const yesNo = (v: boolean | null) => (v === null ? "" : v ? "Yes" : "No");
const lpa = (r: number | null) => (r === null ? null : rupeesToLpa(r));
const day = (d: string | null) => (d ? formatDayIST(d) : "");

export type CandidateExportRow = {
  full_name: string;
  mobile: string;
  email: string | null;
  city: string | null;
  job: string | null;
  experience_months: number | null;
  expected_ctc: number | null;
  certifications: string[];
  ehr_software: string[];
  night_shift_ok: boolean | null;
  voice_process: boolean | null;
  token_date: string | null;
  token: string | null;
  outcome: string | null;
  stage: string | null;
  talent_pool: boolean;
};

export const CANDIDATE_COLUMNS: Column<CandidateExportRow>[] = [
  { header: "Name", width: 28, value: (r) => r.full_name },
  { header: "Mobile", width: 14, value: (r) => r.mobile },
  { header: "Email", width: 28, value: (r) => r.email },
  { header: "City", width: 16, value: (r) => r.city },
  { header: "Position (last visit)", width: 28, value: (r) => r.job },
  { header: "Experience", width: 12, value: (r) => experienceLabel(r.experience_months) },
  { header: "Expected CTC (LPA)", width: 12, value: (r) => lpa(r.expected_ctc) },
  { header: "Certifications", width: 20, value: (r) => r.certifications.join(", ") },
  { header: "EHR / PM software", width: 24, value: (r) => r.ehr_software.join(", ") },
  { header: "Night / US shift OK", width: 10, value: (r) => yesNo(r.night_shift_ok) },
  { header: "Voice process OK", width: 10, value: (r) => yesNo(r.voice_process) },
  { header: "Last visit", width: 13, value: (r) => day(r.token_date) },
  { header: "Token", width: 8, value: (r) => r.token },
  { header: "Status", width: 16, value: (r) => (r.outcome === "in_progress" ? (r.stage ?? "In progress") : r.outcome ? (OUTCOME_LABELS[r.outcome] ?? r.outcome) : "") },
  { header: "Talent pool", width: 10, value: (r) => (r.talent_pool ? "Yes" : "No") },
];

export type DriveExportRow = {
  token: string;
  full_name: string;
  mobile: string;
  job: string;
  stage: string;
  outcome: string;
  reject_reason: string | null;
  registered_at: string;
  decided_at: string | null;
  rounds: number;
};

export const DRIVE_COLUMNS: Column<DriveExportRow>[] = [
  { header: "Token", width: 8, value: (r) => r.token },
  { header: "Name", width: 28, value: (r) => r.full_name },
  { header: "Mobile", width: 14, value: (r) => r.mobile },
  { header: "Position", width: 28, value: (r) => r.job },
  { header: "Stage", width: 18, value: (r) => r.stage },
  { header: "Result", width: 16, value: (r) => OUTCOME_LABELS[r.outcome] ?? r.outcome },
  { header: "Reject reason", width: 30, value: (r) => r.reject_reason },
  { header: "Registered (IST)", width: 10, value: (r) => r.registered_at },
  { header: "Decided (IST)", width: 10, value: (r) => r.decided_at },
  { header: "Rounds", width: 8, value: (r) => r.rounds },
];

export type JoinedExportRow = {
  full_name: string;
  mobile: string;
  email: string | null;
  date_of_birth: string | null;
  job: string;
  joined_on: string | null;
  offered_ctc: number | null;
};

export const JOINED_COLUMNS: Column<JoinedExportRow>[] = [
  { header: "Name", width: 28, value: (r) => r.full_name },
  { header: "Mobile", width: 14, value: (r) => r.mobile },
  { header: "Email", width: 28, value: (r) => r.email },
  { header: "Date of birth", width: 13, value: (r) => day(r.date_of_birth) },
  { header: "Position", width: 28, value: (r) => r.job },
  { header: "Joining date", width: 13, value: (r) => day(r.joined_on) },
  { header: "Offered CTC (LPA)", width: 12, value: (r) => lpa(r.offered_ctc) },
];

/** CSV text (UTF-8, Excel-friendly). Cells that start with = + - @ are prefixed with ' so they can't run as formulas. */
export function toCsv<T>(columns: Column<T>[], rows: T[]) {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(","), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Values exactly as they go into the sheet (used by the writer and by tests). */
export const sheetRows = <T>(columns: Column<T>[], rows: T[]) => rows.map((r) => columns.map((c) => c.value(r) ?? ""));

/** A sheet ready to write: headers, widths and plain values (typed rows are shaped by `sheet`). */
export type Sheet = { name: string; headers: string[]; widths: number[]; rows: (string | number)[][] };
export const sheet = <T>(name: string, columns: Column<T>[], rows: T[]): Sheet => ({
  name,
  headers: columns.map((c) => c.header),
  widths: columns.map((c) => c.width),
  rows: sheetRows(columns, rows),
});

/** Company shown in the file (Settings → Company): workbook properties, print header, and a last "Company" sheet. */
export type ExportCompany = { name: string; logo?: { data: Uint8Array; extension: "png" | "jpeg" } };

export async function toXlsx(sheets: Sheet[], company?: ExportCompany): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  if (company) wb.company = company.name;
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    // "&" starts a header code in Excel: write it as "&&"
    if (company) ws.headerFooter.oddHeader = `&L${company.name.replace(/&/g, "&&")}&R&D &T`;
    ws.columns = sh.headers.map((header, i) => ({ header, width: sh.widths[i] }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of sh.rows) ws.addRow(r); // plain values: text stays text, never a formula
  }
  if (company) {
    const ws = wb.addWorksheet("Company");
    ws.getColumn(1).width = 60;
    if (company.logo) {
      const img = wb.addImage({ buffer: Buffer.from(company.logo.data) as unknown as ExcelJS.Buffer, extension: company.logo.extension });
      ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 200, height: 80 } });
      ws.getRow(1).height = 64;
    }
    ws.getCell("A2").value = company.name;
    ws.getCell("A2").font = { bold: true, size: 14 };
    ws.getCell("A3").value = `Exported ${formatDateTimeIST(new Date())}`;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

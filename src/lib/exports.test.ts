import { describe, expect, it } from "vitest";
import { CANDIDATE_COLUMNS, JOINED_COLUMNS, sheetRows, toCsv, type CandidateExportRow, type JoinedExportRow } from "./exports";

const cand: CandidateExportRow = {
  full_name: "Priya Sharma",
  mobile: "9876543210",
  email: "p@example.test",
  city: "Mohali",
  job: "Medical Coder",
  experience_months: 30,
  expected_ctc: 350000,
  certifications: ["CPC", "COC"],
  ehr_software: ["Epic"],
  night_shift_ok: true,
  voice_process: null,
  token_date: "2026-11-10",
  token: "A-007",
  outcome: "in_progress",
  stage: "HR screen",
  talent_pool: true,
};

describe("export columns", () => {
  it("candidates: fixed columns, money in LPA, lists joined, no photo/file columns", () => {
    expect(CANDIDATE_COLUMNS.map((c) => c.header)).toEqual([
      "Name", "Mobile", "Email", "City", "Position (last visit)", "Experience", "Expected CTC (LPA)", "Certifications",
      "EHR / PM software", "Night / US shift OK", "Voice process OK", "Last visit", "Token", "Status", "Talent pool",
    ]);
    expect(sheetRows(CANDIDATE_COLUMNS, [cand])[0]).toEqual([
      "Priya Sharma", "9876543210", "p@example.test", "Mohali", "Medical Coder", "2 yr 6 mo", 3.5, "CPC, COC", "Epic", "Yes", "", "10 Nov 2026", "A-007", "HR screen", "Yes",
    ]);
    expect(CANDIDATE_COLUMNS.some((c) => /photo|file|cv/i.test(c.header))).toBe(false);
  });
  it("joined employees: the HR onboarding columns", () => {
    const j: JoinedExportRow = { full_name: "A", mobile: "9876543210", email: null, date_of_birth: "1998-04-12", job: "AR Caller", joined_on: "2026-12-01", offered_ctc: 260000 };
    expect(JOINED_COLUMNS.map((c) => c.header)).toEqual(["Name", "Mobile", "Email", "Date of birth", "Position", "Joining date", "Offered CTC (LPA)"]);
    expect(sheetRows(JOINED_COLUMNS, [j])[0]).toEqual(["A", "9876543210", "", "12 Apr 1998", "AR Caller", "01 Dec 2026", 2.6]);
  });
  it("CSV: quoted where needed, formulas neutralised, Excel-readable BOM", () => {
    const csv = toCsv(JOINED_COLUMNS, [{ full_name: '=HYPERLINK("x")', mobile: "9876543210", email: "a,b@x.test", date_of_birth: null, job: "Coder\nII", joined_on: null, offered_ctc: null }]);
    expect(csv.startsWith("﻿Name,Mobile")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a,b@x.test"');
    expect(csv).toContain('"Coder\nII"');
  });
});

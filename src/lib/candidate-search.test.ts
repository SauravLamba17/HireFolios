import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} })); // the builder never touches the database

const { candidateWhere, orderBy, parseFilters, prefixQuery, searchMode, searchTextFor } = await import("./candidate-search");

const dialect = new PgDialect();
const build = (params: Record<string, string>) => dialect.sqlToQuery(candidateWhere(parseFilters(params), "tenant-1"));

describe("search filter parsing", () => {
  it("drops bad or stale URL values instead of failing", () => {
    const f = parseFilters({ q: "  epic ", job: "nope", status: "bogus", from: "yesterday", night: "1", page: "abc" });
    expect(f).toMatchObject({ q: "epic", page: 1, job: undefined, status: undefined, from: undefined, night: undefined });
  });
  it("keeps any list label (the lists live in the database); an unknown one just finds nobody", () => {
    expect(parseFilters({ cert: "XYZ" }).cert).toBe("XYZ");
    expect(parseFilters({ cert: "x".repeat(101) }).cert).toBeUndefined();
  });
  it("keeps good values; repeated params use the first", () => {
    const f = parseFilters({ q: ["cpc", "x"], status: "rejected", cert: "CPC", ehr: "Epic", night: "yes", pool: "yes", from: "2026-11-01", page: "3" });
    expect(f).toMatchObject({ q: "cpc", status: "rejected", cert: "CPC", ehr: "Epic", night: "yes", pool: "yes", from: "2026-11-01", page: 3 });
  });
});

describe("search filter builder", () => {
  it("always starts with the tenant filter", () => {
    for (const p of [{}, { q: "priya" }, { q: "98765" }, { cert: "CPC", pool: "yes" }] as Record<string, string>[]) {
      const q = build(p);
      expect(q.sql.startsWith("c.tenant_id = $1")).toBe(true);
      expect(q.params[0]).toBe("tenant-1");
    }
  });

  it("4+ digits search the mobile (normalised), fewer digits are text", () => {
    expect(build({ q: "43210" }).params).toContain("%43210%");
    expect(build({ q: "+91 98765 43210" }).params).toContain("%9876543210%");
    expect(searchMode("123").kind).toBe("text");
  });

  it("email search escapes LIKE wildcards", () => {
    const q = build({ q: "a_b%@x.test" });
    expect(q.sql).toContain("c.email like");
    expect(q.params).toContain("%a\\_b\\%@x.test%");
  });

  it("text search = fuzzy name OR prefix full-text", () => {
    const q = build({ q: "Epic CPC" });
    expect(q.sql).toContain("word_similarity(");
    expect(q.sql).toContain("to_tsquery('simple'");
    expect(q.params).toContain("epic:* & cpc:*");
  });

  it("tsquery operators typed by a user can't change the query", () => {
    expect(prefixQuery("a & b | !c:* (d)")).toBe("a:* & b:* & c:* & d:*");
    expect(prefixQuery("&|!")).toBeNull();
  });

  it("position and date range must match the same visit", () => {
    const q = build({ job: "7d1c0f5e-3a55-4a51-9a49-5b8a0d1e2f30", from: "2026-11-01", to: "2026-11-30" });
    expect(q.sql.match(/exists \(select 1 from applications a/g)).toHaveLength(1);
    expect(q.sql).toMatch(/a\.job_id = \$\d+ and a\.token_date >= \$\d+ and a\.token_date <= \$\d+/);
  });

  it("maps every filter", () => {
    const q = build({ status: "on_hold", cert: "CPC", ehr: "Epic", night: "yes", voice: "yes", pool: "yes" });
    expect(q.sql).toContain("la.outcome = $");
    expect(q.sql).toContain("= any(c.certifications)");
    expect(q.sql).toContain("= any(c.ehr_software)");
    expect(q.sql).toContain("c.night_shift_ok");
    expect(q.sql).toContain("c.voice_process");
    expect(q.sql).toContain("lk.talent_pool and lk.withdrawn_at is null");
    expect(q.params).toEqual(expect.arrayContaining(["on_hold", "CPC", "Epic"]));
  });
});

describe("ordering", () => {
  // A bare constant in ORDER BY is read by Postgres as a column position ("order by 0" fails).
  it("never orders by a bare number", () => {
    for (const p of [{}, { q: "98765" }, { q: "a@b.test" }, { cert: "CPC" }, { q: "&&" }, { q: "priya" }]) {
      const q = dialect.sqlToQuery(orderBy(parseFilters(p)));
      expect(q.sql.trim()).not.toMatch(/^\d/);
      expect(q.sql).toMatch(/la\.token_date desc nulls last, c\.created_at desc$/);
    }
  });
  it("ranks by name similarity / full-text only for text searches", () => {
    expect(dialect.sqlToQuery(orderBy(parseFilters({ q: "priya" }))).sql).toMatch(/^greatest\(word_similarity/);
    expect(dialect.sqlToQuery(orderBy(parseFilters({ q: "98765" }))).sql).not.toContain("greatest");
  });
});

describe("full-text source", () => {
  it("covers name, city, education, skills, languages, certifications, specialties, software", () => {
    const t = searchTextFor({
      fullName: "Priya Sharma",
      city: "Mohali",
      qualification: "B.Pharm",
      skills: "denials",
      languages: ["Punjabi"],
      certifications: ["CPC"],
      codingSpecialties: ["E/M"],
      ehrSoftware: ["Epic"],
    });
    for (const w of ["Priya Sharma", "Mohali", "B.Pharm", "denials", "Punjabi", "CPC", "E/M", "Epic"]) expect(t).toContain(w);
  });
});

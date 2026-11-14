// Server log lines. LOG_FORMAT=json (AWS: one JSON object per line on stdout, for CloudWatch / docker logs) or text
// (the office PC's service log). Callers pass an event name and ids / counts / codes only — never names, mobiles,
// emails, file keys with personal data, passwords or tokens (CLAUDE.md hard rule 11 applies to logs too).
import { config } from "@/lib/config";

type Fields = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";

function format(): "json" | "text" {
  try {
    return config().LOG_FORMAT;
  } catch {
    return "text"; // configuration not valid yet (start-up prints its own message)
  }
}

function write(level: Level, event: string, fields: Fields = {}) {
  const out = level === "info" ? console.log : console.error;
  if (format() === "json") out(JSON.stringify({ ...fields, time: new Date().toISOString(), level, event })); // a field never hides these
  else {
    const extra = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    out(`${level === "info" ? "" : `${level.toUpperCase()} `}${event}${extra ? ` ${extra}` : ""}`);
  }
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

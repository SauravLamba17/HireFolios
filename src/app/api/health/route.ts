import { systemStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

// For monitoring and Docker health checks: no sign-in, no personal data. 503 when something is wrong.
export async function GET() {
  const s = await systemStatus();
  return Response.json(s, { status: s.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}

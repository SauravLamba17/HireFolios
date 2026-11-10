import { subscribe } from "@/lib/live";
import { can, requireStaffApi } from "@/lib/session";

export const dynamic = "force-dynamic";

const STREAM_MS = 10 * 60 * 1000; // end the stream every 10 minutes so reconnects re-check the session

// Server-Sent Events: "change" pings for the signed-in staff member's tenant only. No data travels here;
// the page re-reads its own tenant-scoped state. EventSource reconnects by itself (retry: 3 s).
export async function GET(req: Request) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  if (!(["drive", "interview", "tv"] as const).some((p) => can(staff.role, p))) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  const enc = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          close();
        }
      };
      send("retry: 3000\n\nevent: ready\ndata: {}\n\n");
      const off = subscribe(staff.tenantId, () => send(`event: change\ndata: {"at":${Date.now()}}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      const stop = setTimeout(() => close(), STREAM_MS);
      close = () => {
        off();
        clearInterval(ping);
        clearTimeout(stop);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => close());
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}

import { z } from "zod";
import { act, badRequest } from "@/lib/api";
import { FlowError } from "@/lib/flow";
import { firstIssue } from "@/lib/intake";
import { clientIp, ipAllowed, validEntry } from "@/lib/net";
import { saveAllowList } from "@/lib/security-settings";
import { requireStaffApi } from "@/lib/session";

const Body = z.object({
  on: z.boolean(),
  entries: z.array(z.string().trim().max(60)).max(100, "At most 100 addresses").refine((l) => l.every(validEntry), "Each line must be an IPv4 address (203.0.113.7), a range (203.0.113.0/24) or an IPv6 address"),
});

// Settings → Security (admin): the office IP allow-list. Refuses to switch it on unless the admin's own address is
// listed, so nobody locks themselves out by mistake (IP_ALLOWLIST_OFF=1 is the emergency switch).
export async function PATCH(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { on, entries } = parsed.data;
  const mine = clientIp(req.headers);
  return act(staff, async (tx) => {
    if (on && !entries.length) throw new FlowError("Add at least one address before switching the list on.");
    if (on && !ipAllowed(mine, entries)) {
      throw new FlowError(mine ? `Your own address (${mine}) is not on the list: add it first, or you would be locked out.` : "Your address is not known here (no proxy in front of the app), so the list can't be switched on from this connection.");
    }
    await saveAllowList(tx, staff, { on, entries });
  });
}

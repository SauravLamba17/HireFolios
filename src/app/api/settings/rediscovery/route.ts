import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { SettingsPatch } from "@/lib/rediscovery/settings";
import { saveSettings } from "@/lib/rediscovery/settings-db";
import { requireStaffApi } from "@/lib/session";

// Settings → Rediscovery (admin): thresholds, templates, weights. Each value checked against its limits; audited (keys only).
export async function PATCH(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = SettingsPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return act(staff, (tx) => saveSettings(tx, staff, parsed.data));
}

// How long a sign-in lasts (STAFF_SESSION_HOURS, DISPLAY_SESSION_DAYS in .env; defaults 12 hours and 30 days).
// Staff: one shift. The lobby TV ("display", which can only open /tv and the live stream): long, so it stays on
// overnight; an admin can sign it out from the Staff page.
import "server-only";
import { config } from "@/lib/config";

export const sessionLengths = () => ({ staff: config().STAFF_SESSION_HOURS * 60 * 60, display: config().DISPLAY_SESSION_DAYS * 24 * 60 * 60 });

export const sessionSeconds = (role: string) => (role === "display" ? sessionLengths().display : sessionLengths().staff);

// How long a sign-in lasts. Staff: one 12-hour shift. The lobby TV ("display", which can only open /tv
// and the live stream): 30 days, so it stays on overnight; an admin can sign it out from the Staff page.
export const SESSION_SECONDS = { staff: 12 * 60 * 60, display: 30 * 24 * 60 * 60 } as const;

export const sessionSeconds = (role: string) => (role === "display" ? SESSION_SECONDS.display : SESSION_SECONDS.staff);

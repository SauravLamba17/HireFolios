import { createAuthClient } from "better-auth/react";

// Same origin as the page, so it works on localhost and on the office LAN IP.
export const authClient = createAuthClient();

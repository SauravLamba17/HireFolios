import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// Same origin as the page, so it works on localhost, the office LAN IP and the public address.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

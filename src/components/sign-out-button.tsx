"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className="btn btn-secondary"
      onClick={async () => {
        setPending(true);
        await authClient.signOut().catch(() => {});
        window.location.assign("/login"); // full load drops any cached staff pages
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

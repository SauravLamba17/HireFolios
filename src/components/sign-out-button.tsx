"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** Sign out; `asMenuItem` renders it as an item of the user menu. */
export function SignOutButton({ asMenuItem = false, className = "btn btn-secondary" }: { asMenuItem?: boolean; className?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      role={asMenuItem ? "menuitem" : undefined}
      tabIndex={asMenuItem ? -1 : undefined}
      className={className}
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

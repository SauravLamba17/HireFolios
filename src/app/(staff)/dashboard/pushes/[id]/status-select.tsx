"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUSH_STATUSES } from "@/lib/rediscovery/rank";
import { send } from "@/lib/send";

export function StatusSelect({ pushId, memberId, value, name }: { pushId: string; memberId: string; value: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor={`st-${memberId}`} className="sr-only">Status of {name}</label>
      <select
        id={`st-${memberId}`}
        value={value}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(await send(`/api/pushes/${pushId}`, "POST", { action: "status", memberId, status: e.target.value }));
          router.refresh();
          setBusy(false);
        }}
        className="input w-auto"
      >
        {Object.entries(PUSH_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

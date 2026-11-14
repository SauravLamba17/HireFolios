import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not allowed from this network" };
export const dynamic = "force-dynamic"; // the security headers carry a per-request nonce

// The lobby TV login is used outside the office while Settings → Security limits it to the office network.
export default function NotAllowedPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="card space-y-3">
        <h1 className="text-2xl font-semibold">Not allowed from this network</h1>
        <p className="text-slate-700">This screen works only from the office network. Ask your admin.</p>
      </div>
    </main>
  );
}

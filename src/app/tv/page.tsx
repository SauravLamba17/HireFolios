import type { Metadata } from "next";
import { LiveRefresh } from "@/components/live-refresh";
import { brand } from "@/lib/brand";
import { lobbyState } from "@/lib/drive";
import { requireStaff } from "@/lib/session";
import { Chime, Clock } from "./tv-parts";

export const metadata: Metadata = { title: "Lobby" };

// Lobby TV (1920×1080, read from ~5 m). Tokens and rooms only: never names, photos or mobile numbers.
// Sign in on the TV with a "Lobby TV (display)" account, which can open this page and nothing else.
export default async function TvPage() {
  const staff = await requireStaff("tv");
  const { calls, waiting, drive } = await lobbyState(staff.tenantId);
  const [now, ...previous] = calls;
  return (
    <main className="flex min-h-dvh flex-col bg-white px-12 py-8 text-slate-900">
      <LiveRefresh quiet />
      <header className="flex items-center justify-between text-4xl font-semibold text-blue-800">
        <span>{brand.name}</span>
        <span className="text-slate-700">
          <Clock />
        </span>
      </header>

      <section aria-label="Now calling" className="flex flex-1 flex-col items-center justify-center text-center">
        {now ? (
          <>
            <p className="text-5xl font-medium text-slate-600">Now calling</p>
            <p className="mt-4 text-[13rem] leading-none font-bold tracking-tight text-blue-800" data-testid="tv-now">
              {now.token}
            </p>
            <p className="mt-6 text-8xl font-semibold" data-testid="tv-room">
              → {now.room}
            </p>
          </>
        ) : (
          <p className="text-6xl font-medium text-slate-600">{drive.closedAt ? "Interviews have finished for today." : "Please wait. Your token will be called here."}</p>
        )}
      </section>

      <footer className="flex items-end justify-between gap-8">
        <div>
          {previous.length > 0 && (
            <>
              <p className="text-3xl text-slate-600">Previous calls</p>
              <ol className="mt-2 flex flex-wrap gap-x-12 gap-y-2 text-6xl font-semibold" data-testid="tv-previous">
                {previous.map((c) => (
                  <li key={c.id}>
                    {c.token} <span className="text-slate-500">→ {c.room}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-4">
          <p className="text-5xl font-semibold" data-testid="tv-waiting">
            Waiting: {waiting}
          </p>
          <Chime latestCallId={now?.id ?? null} />
        </div>
      </footer>
    </main>
  );
}

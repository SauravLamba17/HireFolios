import { OUTCOME_LABELS } from "@/lib/options";

const COLORS: Record<string, string> = {
  in_progress: "bg-blue-50 text-blue-800",
  selected: "bg-green-50 text-green-800",
  rejected: "bg-red-50 text-red-800",
  on_hold: "bg-amber-50 text-amber-900",
  withdrawn: "bg-slate-200 text-slate-700",
  no_show: "bg-slate-200 text-slate-700",
  offer_declined: "bg-slate-200 text-slate-700",
  joined: "bg-emerald-600 text-white",
};

/** Latest visit's status: the stage while in progress, else the outcome. */
export function StatusBadge({ outcome, stage }: { outcome: string | null; stage: string | null }) {
  if (!outcome) return null;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap ${COLORS[outcome] ?? COLORS.withdrawn}`}>
      {outcome === "in_progress" && stage ? stage : (OUTCOME_LABELS[outcome] ?? outcome)}
    </span>
  );
}

export const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-sm font-medium whitespace-nowrap text-violet-800">{children}</span>
);

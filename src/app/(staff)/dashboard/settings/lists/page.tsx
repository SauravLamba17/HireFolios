import type { Metadata } from "next";
import { LIST_KEYS, LIST_META } from "@/lib/lists";
import { getOptionLists } from "@/lib/lists-db";
import { requireStaff } from "@/lib/session";
import { ListEditor } from "./list-editor";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const staff = await requireStaff("settings");
  const lists = await getOptionLists(staff.tenantId);
  const sample = LIST_KEYS.some((k) => lists[k].some((i) => i.sample));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lists</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          The choices HR sees at intake and in the candidate filters. Untick &ldquo;In use&rdquo; to retire an item: it disappears from
          new forms but stays on the candidates who have it. Renaming changes the list for new entries; candidates saved before keep
          the wording they were saved with. Items are never deleted.
        </p>
        {sample && (
          <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            Lists marked <strong>Sample</strong> are starting lists. Check them with your HR team, then save each item (the mark goes away).
          </p>
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {LIST_KEYS.map((k) => (
          <ListEditor key={k} list={k} title={LIST_META[k].title} help={LIST_META[k].help} items={lists[k]} />
        ))}
      </div>
    </div>
  );
}

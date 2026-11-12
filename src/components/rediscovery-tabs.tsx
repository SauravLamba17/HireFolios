"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Rediscovery section (HR, manager, admin). Pages: docs/REDISCOVERY.md.
export const REDISCOVERY_TABS = [
  { href: "/dashboard/pool", label: "Pool" },
  { href: "/dashboard/bulk", label: "Bulk hiring" },
  { href: "/dashboard/pushes", label: "Pushes" },
  { href: "/dashboard/suggestions", label: "Suggestions" },
  { href: "/dashboard/callbacks", label: "Call-backs" },
];

export function RediscoveryTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Rediscovery sections" className="flex flex-wrap gap-1 border-b border-slate-200">
      {REDISCOVERY_TABS.map((t) => {
        const active = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex h-12 items-center border-b-2 px-4 text-base font-medium ${active ? "border-blue-700 text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

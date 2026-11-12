"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/settings", label: "Jobs, rounds & retention" },
  { href: "/dashboard/settings/lists", label: "Lists" },
  { href: "/dashboard/settings/notice", label: "Privacy notice" },
  { href: "/dashboard/settings/company", label: "Company" },
  { href: "/dashboard/settings/rediscovery", label: "Rediscovery" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex flex-wrap gap-1 border-b border-slate-200">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex h-12 items-center border-b-2 px-4 text-base font-medium ${
              active ? "border-blue-700 text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

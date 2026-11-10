"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string; also?: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map((l) => {
        const active = path === l.href || (l.also !== undefined && path.startsWith(l.also));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-12 items-center rounded-lg px-4 text-base font-medium ${
              active ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

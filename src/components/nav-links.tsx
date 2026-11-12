"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type MenuLink } from "./nav-menu";

/** The header's always-visible links (the role's most used pages). */
export function NavLinks({ links }: { links: MenuLink[] }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = isActive(path, l);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-12 items-center rounded-lg px-3 text-base font-medium whitespace-nowrap ${
              active ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}

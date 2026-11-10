import Link from "next/link";
import { brand } from "@/lib/brand";
import { can, ROLE_LABELS, type Permission, type Staff } from "@/lib/session";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

const LINKS: { href: string; label: string; permission: Permission }[] = [
  { href: "/dashboard", label: "Dashboard", permission: "dashboard" },
  { href: "/intake", label: "Intake", permission: "intake" },
  { href: "/dashboard/users", label: "Staff", permission: "users" },
];

export function Header({ staff }: { staff: Staff }) {
  const links = LINKS.filter((l) => can(staff.role, l.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="flex h-12 items-center text-xl font-semibold tracking-tight text-blue-800">
          <span className="sm:hidden">{brand.shortName}</span>
          <span className="hidden sm:inline">{brand.name}</span>
        </Link>
        <NavLinks links={links} />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/account/password"
            className="flex h-12 flex-col justify-center rounded-lg px-3 text-right leading-tight hover:bg-slate-100"
          >
            <span className="text-sm font-medium text-slate-900">{staff.name}</span>
            <span className="text-xs text-slate-500">
              {ROLE_LABELS[staff.role]} · <span className="text-blue-700 underline">Change password</span>
            </span>
          </Link>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

import Link from "next/link";
import { brand } from "@/lib/brand";
import { getCompany } from "@/lib/company";
import { can, ROLE_LABELS, type Permission, type Role, type Staff } from "@/lib/session";
import { NavMenu, type MenuLink } from "./nav-menu";
import { NavLinks } from "./nav-links";
import { QuickLook } from "./quick-look";
import { UserMenu } from "./user-menu";

// Every page reachable from the header, with the permission it needs. `also`: other paths that light it up.
type Item = MenuLink & { permission: Permission };
const I = {
  candidates: { href: "/dashboard", label: "Candidates", permission: "candidates", also: "/dashboard/candidates/" },
  newCandidate: { href: "/intake", label: "+ New candidate", permission: "intake" },
  drive: { href: "/dashboard/drive", label: "Drive", permission: "drive" },
  interview: { href: "/interview", label: "Interview", permission: "interview" },
  reports: { href: "/dashboard/reports", label: "Reports", permission: "reports" },
  privacy: { href: "/dashboard/privacy", label: "Privacy", permission: "privacy" },
  settings: { href: "/dashboard/settings", label: "Settings", permission: "settings", also: "/dashboard/settings/" },
  users: { href: "/dashboard/users", label: "Staff", permission: "users" },
  audit: { href: "/dashboard/audit", label: "Audit", permission: "audit" },
  pool: { href: "/dashboard/pool", label: "Pool", permission: "rediscovery" },
  bulk: { href: "/dashboard/bulk", label: "Bulk hiring", permission: "rediscovery" },
  pushes: { href: "/dashboard/pushes", label: "Hiring pushes", permission: "rediscovery", also: "/dashboard/pushes/" },
  suggestions: { href: "/dashboard/suggestions", label: "Suggestions", permission: "rediscovery" },
  callbacks: { href: "/dashboard/callbacks", label: "Call-backs", permission: "rediscovery" },
  joining: { href: "/dashboard/joining", label: "Joining soon", permission: "rediscovery" },
} satisfies Record<string, Item>;
type Key = keyof typeof I;

// The links each role uses most stay visible; the rest sit in two menus. Nothing here grants access: every page still
// checks its own permission, and items a role lacks the permission for are left out.
const PRIMARY: Record<Role, Key[]> = {
  admin: ["candidates", "newCandidate", "drive"],
  hr: ["newCandidate", "drive", "candidates"],
  manager: ["candidates", "drive", "reports"],
  interviewer: ["interview"],
  display: [],
};
const REDISCOVERY: Key[] = ["pool", "bulk", "pushes", "suggestions", "callbacks", "joining"];
const MORE: Key[] = ["interview", "candidates", "newCandidate", "drive", "reports", "privacy", "settings", "users", "audit"];
const ADMIN_ONLY: Key[] = ["settings", "users", "audit"];

export function headerNav(role: Role) {
  const allowed = (k: Key) => can(role, I[k].permission);
  const primary = PRIMARY[role].filter(allowed);
  const rediscovery = REDISCOVERY.filter(allowed);
  const more = MORE.filter((k) => allowed(k) && !primary.includes(k));
  const pick = (keys: Key[]): MenuLink[] =>
    keys.map((k) => {
      const it: Item = I[k];
      return { href: it.href, label: it.label, also: it.also };
    });
  return {
    primary: pick(primary),
    rediscovery: pick(rediscovery),
    more: pick(more),
    // "Admin" when the menu holds admin tools, otherwise "More"
    moreLabel: more.some((k) => ADMIN_ONLY.includes(k)) ? "Admin" : "More",
  };
}

export async function Header({ staff }: { staff: Staff }) {
  const company = await getCompany(staff.tenantId); // Settings → Company
  // A temporary password unlocks nothing but the password page, so show no links yet.
  const nav = staff.mustChangePassword ? null : headerNav(staff.role);
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 lg:flex-nowrap" data-testid="header-row">
        <Link href="/" className="flex h-12 shrink-0 items-center pr-2 text-xl font-semibold tracking-tight text-blue-800" title={brand.name}>
          <span className="sm:hidden">{brand.shortName}</span>
          <span className="hidden sm:inline">{brand.name}</span>
        </Link>
        {nav && (
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
            <NavLinks links={nav.primary} />
            {nav.rediscovery.length > 0 && <NavMenu label="Rediscovery" links={nav.rediscovery} />}
            {nav.more.length > 0 && <NavMenu label={nav.moreLabel} links={nav.more} />}
          </nav>
        )}
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          {/* Phase 3.6 quick-look: HR, manager, admin only (never interviewers or the lobby TV) */}
          {nav && can(staff.role, "rediscovery") && <QuickLook />}
          {/* Settings → Company: logo and short name, full name on hover */}
          <Link href="/" className="flex h-12 min-w-0 shrink items-center gap-2 rounded-lg px-1" title={company.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private file behind the session cookie */}
            {company.logoUrl && <img src={company.logoUrl} alt="" className="h-8 max-w-16 shrink-0 object-contain" />}
            <span className="max-w-32 truncate text-sm font-medium text-slate-600" data-testid="header-company">{company.shortName}</span>
          </Link>
          <UserMenu name={staff.name} role={ROLE_LABELS[staff.role]} />
        </div>
      </div>
    </header>
  );
}

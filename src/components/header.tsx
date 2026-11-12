import Link from "next/link";
import { brand } from "@/lib/brand";
import { getCompany } from "@/lib/company";
import { can, ROLE_LABELS, type Permission, type Staff } from "@/lib/session";
import { NavLinks } from "./nav-links";
import { QuickLook } from "./quick-look";
import { SignOutButton } from "./sign-out-button";

// `also`: other paths that light up the link (a candidate profile belongs to Candidates).
const LINKS: { href: string; label: string; permission: Permission; also?: string | string[] }[] = [
  { href: "/dashboard", label: "Candidates", permission: "candidates", also: "/dashboard/candidates/" },
  { href: "/intake", label: "+ New candidate", permission: "intake" },
  { href: "/dashboard/drive", label: "Drive", permission: "drive" },
  { href: "/interview", label: "Interview", permission: "interview" },
  // Phase 3.6: one entry for the rediscovery pages (they share a tab bar)
  { href: "/dashboard/suggestions", label: "Rediscovery", permission: "rediscovery", also: ["/dashboard/suggestions"] },
  { href: "/dashboard/reports", label: "Reports", permission: "reports" },
  { href: "/dashboard/privacy", label: "Privacy", permission: "privacy" },
  { href: "/dashboard/settings", label: "Settings", permission: "settings", also: "/dashboard/settings/" },
  { href: "/dashboard/users", label: "Staff", permission: "users" },
  { href: "/dashboard/audit", label: "Audit", permission: "audit" },
];

export async function Header({ staff }: { staff: Staff }) {
  const company = await getCompany(staff.tenantId); // Settings → Company
  // A temporary password unlocks nothing but the password page, so show no links yet.
  const links = staff.mustChangePassword
    ? []
    : LINKS.filter((l) => can(staff.role, l.permission)).map(({ href, label, also }) => ({ href, label, also }));
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="flex h-12 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- private file behind the session cookie */}
          {company.logoUrl && <img src={company.logoUrl} alt="" className="h-9 max-w-20 object-contain" />}
          <span className="flex flex-col leading-tight">
            <span className="text-xl font-semibold tracking-tight text-blue-800">
              <span className="sm:hidden">{brand.shortName}</span>
              <span className="hidden sm:inline">{brand.name}</span>
            </span>
            {/* Settings → Company */}
            <span className="max-w-40 truncate text-xs font-medium text-slate-600" data-testid="header-company">{company.shortName}</span>
          </span>
        </Link>
        <NavLinks links={links} />
        {/* Phase 3.6 quick-look: HR, manager, admin only (never interviewers or the lobby TV) */}
        {!staff.mustChangePassword && can(staff.role, "rediscovery") && <QuickLook />}
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

"use client";

// The signed-in person (name · role) with Change password and Sign out. Long names truncate; the full name is the tooltip.
import { Menu, MenuLinkItem, menuItemClass } from "./nav-menu";
import { SignOutButton } from "./sign-out-button";

export function UserMenu({ name, role }: { name: string; role: string }) {
  return (
    <Menu
      label={`${name}, ${role}: account menu`}
      align="right"
      className="min-w-0"
      button={
        <span className="flex min-w-0 items-center gap-1" title={`${name} · ${role}`}>
          <span className="flex max-w-36 min-w-0 flex-col text-right leading-tight xl:max-w-48">
            <span className="truncate text-sm font-medium text-slate-900" data-testid="header-user">{name}</span>
            <span className="truncate text-xs text-slate-500">{role}</span>
          </span>
          <span aria-hidden="true">▾</span>
        </span>
      }
    >
      <p className="max-w-72 truncate border-b border-slate-100 px-4 pt-1 pb-2 text-sm text-slate-600" title={name}>
        {name} · {role}
      </p>
      <MenuLinkItem link={{ href: "/account/password", label: "Change password" }} />
      <MenuLinkItem link={{ href: "/account/security", label: "Sign-in security (two-factor)" }} />
      <SignOutButton asMenuItem className={menuItemClass(false)} />
    </Menu>
  );
}

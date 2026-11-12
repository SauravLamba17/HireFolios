"use client";

// Header dropdown menus (WAI-ARIA menu button): Enter / Space / ↓ opens on the first item, ↑ on the last; ↑ ↓ Home End
// move; Esc closes and returns to the button; Tab or a click outside closes. Items are links or buttons with
// role="menuitem"; a link closes the menu by navigating (the menu closes on every route change). Focus leaving the
// button and its items also closes it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuLink = { href: string; label: string; also?: string | string[] };

export const isActive = (path: string, l: MenuLink) => path === l.href || [l.also ?? []].flat().some((p) => path.startsWith(p));

export function Menu({
  label,
  button,
  active = false,
  align = "left",
  className = "",
  children,
}: {
  label: string; // accessible name of the button (and of the menu)
  button: ReactNode; // what the button shows
  active?: boolean;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusItem = (i: number) => {
    const list = items();
    if (list.length) list[(i + list.length) % list.length].focus();
  };

  useEffect(() => setOpen(false), [path]); // navigated: close
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const openAt = (i: number) => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(i));
  };
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt(-1);
    } else if (e.key === "Escape") setOpen(false);
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      focusItem(to);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div
      ref={root}
      className={`relative ${className}`}
      // focus left the button and its items (Tab, Shift+Tab, a click elsewhere): close
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btn}
        id={`${id}-b`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-m`}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className={`flex h-12 max-w-full items-center gap-1 rounded-lg px-3 text-base font-medium whitespace-nowrap ${
          active || open ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        {button}
      </button>
      {open && (
        <div
          id={`${id}-m`}
          role="menu"
          aria-labelledby={`${id}-b`}
          onKeyDown={onMenuKey}
          className={`absolute top-full z-40 mt-1 min-w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const itemClass = (on: boolean) =>
  `block w-full px-4 py-2.5 text-left text-base whitespace-nowrap focus:bg-blue-50 focus:outline-none ${on ? "font-semibold text-blue-800" : "text-slate-800 hover:bg-slate-100"}`;

export function MenuLinkItem({ link }: { link: MenuLink }) {
  const path = usePathname();
  const on = isActive(path, link);
  return (
    <Link href={link.href} role="menuitem" tabIndex={-1} aria-current={on ? "page" : undefined} className={itemClass(on)}>
      {link.label}
    </Link>
  );
}

/** A labelled group of links ("Rediscovery ▾", "Admin ▾"); lit when the current page is one of them. */
export function NavMenu({ label, links }: { label: string; links: MenuLink[] }) {
  const path = usePathname();
  return (
    <Menu label={label} active={links.some((l) => isActive(path, l))} button={<>{label} <span aria-hidden="true">▾</span></>}>
      {links.map((l) => (
        <MenuLinkItem key={l.href} link={l} />
      ))}
    </Menu>
  );
}

export { itemClass as menuItemClass };

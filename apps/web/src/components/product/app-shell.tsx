"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CanalisLogo } from "../brand/canalis-logo";

const navigation = [
  { href: "/dashboard", label: "Dashboard", glyph: "⌂" },
  { href: "/tasks", label: "Tasks", glyph: "T" },
  { href: "/channels", label: "Channels", glyph: "C" },
  { href: "/providers", label: "Providers", glyph: "P" },
  { href: "/transactions", label: "Transactions", glyph: "↗" },
  { href: "/policies", label: "Policies", glyph: "◇" },
  { href: "/analytics", label: "Analytics", glyph: "A" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
] as const;

const searchItems = [
  ...navigation,
  { href: "/tasks/demo", label: "Run reference task", glyph: "▶" },
  { href: "/channels", label: "Devnet channel proof", glyph: "◎" },
  { href: "/transactions", label: "Settlement evidence", glyph: "✓" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

function breadcrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: part === "demo" ? "Reference task" : part.charAt(0).toUpperCase() + part.slice(1),
    href: `/${parts.slice(0, index + 1).join("/")}`,
  }));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    setQuery("");
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return searchItems;
    return searchItems.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [query]);

  const crumbs = breadcrumbs(pathname);

  return (
    <div className="product-shell">
      <aside className={`product-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand-row">
          <Link className="sidebar-brand" href="/dashboard" aria-label="Canalis dashboard">
            <CanalisLogo />
          </Link>
          <button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation">×</button>
        </div>

        <div className="environment-chip"><span />Devnet workspace</div>

        <nav className="product-nav" aria-label="Product navigation">
          <p className="nav-section-label">Workspace</p>
          {navigation.slice(0, 5).map((item) => (
            <Link className={`product-nav-link ${isActive(pathname, item.href) ? "active" : ""}`} href={item.href} key={item.href}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          <p className="nav-section-label nav-section-spaced">Control</p>
          {navigation.slice(5).map((item) => (
            <Link className={`product-nav-link ${isActive(pathname, item.href) ? "active" : ""}`} href={item.href} key={item.href}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-proof-card">
          <span className="proof-dot" />
          <div><strong>Devnet proof verified</strong><span>100k ceiling · 30k settled</span></div>
          <Link href="/channels" aria-label="Open devnet proof">→</Link>
        </div>
      </aside>

      {menuOpen ? <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <div className="product-main">
        <header className="product-topbar">
          <div className="topbar-left">
            <button className="menu-trigger" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">☰</button>
            <div className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/dashboard">Canalis</Link>
              {crumbs.map((crumb) => <span key={crumb.href}><i>/</i><Link href={crumb.href}>{crumb.label}</Link></span>)}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="command-trigger" type="button" onClick={() => setSearchOpen(true)}>
              <span>Search workspace</span><kbd>⌘ K</kbd>
            </button>
            <Link className="topbar-task-link" href="/tasks/demo">Run task</Link>
            <span className="network-badge"><i />DEVNET</span>
          </div>
        </header>
        <main className="product-content">{children}</main>
      </div>

      <nav className="mobile-tabbar" aria-label="Mobile product navigation">
        {navigation.slice(0, 5).map((item) => (
          <Link className={isActive(pathname, item.href) ? "active" : ""} href={item.href} key={item.href}>
            <span>{item.glyph}</span><small>{item.label}</small>
          </Link>
        ))}
      </nav>

      {searchOpen ? (
        <div className="command-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <div className="command-panel" role="dialog" aria-modal="true" aria-label="Search workspace" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-input-row"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a page, task, or proof…" aria-label="Search workspace" /><kbd>ESC</kbd></div>
            <div className="command-results">
              {filteredItems.map((item) => <Link href={item.href} key={`${item.href}-${item.label}`}><span className="command-glyph">{item.glyph}</span><span>{item.label}</span><small>Open →</small></Link>)}
              {filteredItems.length === 0 ? <p className="command-empty">No matching destination.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CanalisLogo } from "../brand/canalis-logo";
import { useWalletIdentity, WalletAccountControl } from "../wallet/wallet-identity";
import { NotificationCenter } from "./notification-center";
import { ModalSurface, ProductUxRuntime } from "./product-ux";
import { WorkspaceSwitcher } from "./workspace-switcher";

const navigation = [
  { href: "/dashboard", label: "Dashboard", glyph: "⌂" },
  { href: "/tasks", label: "Tasks", glyph: "T" },
  { href: "/channels", label: "Channels", glyph: "C" },
  { href: "/providers", label: "Providers", glyph: "P" },
  { href: "/transactions", label: "Transactions", glyph: "↗" },
  { href: "/policies", label: "Policies", glyph: "◇" },
  { href: "/analytics", label: "Analytics", glyph: "A" },
  { href: "/activity", label: "Activity", glyph: "◉" },
  { href: "/developers", label: "Developers", glyph: "{ }" },
  { href: "/workspace", label: "Workspace", glyph: "W" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
] as const;

const searchItems = [
  ...navigation,
  { href: "/tasks/new", label: "Create governed task", glyph: "＋" },
];

type RuntimeSettings = {
  environment: "local" | "devnet" | "mainnet";
  solanaNetwork: "localnet" | "devnet" | "mainnet-beta";
  defaultAssetSymbol: string;
};

const defaultRuntime: RuntimeSettings = { environment: "devnet", solanaNetwork: "devnet", defaultAssetSymbol: "USDC" };

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

function breadcrumbLabel(part: string) {
  const decoded = decodeURIComponent(part);
  if (decoded.length > 22) return `${decoded.slice(0, 10)}…${decoded.slice(-5)}`;
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

function breadcrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: breadcrumbLabel(part),
    href: `/${parts.slice(0, index + 1).join("/")}`,
  }));
}

function networkLabel(runtime: RuntimeSettings) {
  return runtime.solanaNetwork === "mainnet-beta" ? "MAINNET" : runtime.solanaNetwork.toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useWalletIdentity();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [runtime, setRuntime] = useState<RuntimeSettings>(defaultRuntime);

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
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime() {
      if (!session) {
        setRuntime(defaultRuntime);
        return;
      }
      try {
        const response = await fetch("/api/settings", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { settings: RuntimeSettings };
        if (!cancelled) setRuntime(body.settings);
      } catch {
        // Keep the safe devnet display fallback if settings cannot be loaded.
      }
    }
    function onSettings(event: Event) {
      const detail = (event as CustomEvent<RuntimeSettings>).detail;
      if (detail?.environment && detail?.solanaNetwork) setRuntime(detail);
    }
    void loadRuntime();
    window.addEventListener("canalis:settings-updated", onSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("canalis:settings-updated", onSettings);
    };
  }, [session]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return searchItems;
    return searchItems.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [query]);

  const crumbs = breadcrumbs(pathname);

  return (
    <div className="product-shell" data-environment={runtime.environment}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ProductUxRuntime />

      <aside id="product-navigation" className={`product-sidebar ${menuOpen ? "open" : ""}`} aria-label="Primary product navigation">
        <div className="sidebar-brand-row">
          <Link className="sidebar-brand" href="/dashboard" aria-label="Canalis dashboard">
            <CanalisLogo />
          </Link>
          <button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation">×</button>
        </div>

        <div className="environment-chip"><span aria-hidden="true" />{runtime.environment} workspace · {runtime.defaultAssetSymbol}</div>
        <WorkspaceSwitcher />

        <nav className="product-nav" aria-label="Product navigation">
          <p className="nav-section-label">Workspace</p>
          {navigation.slice(0, 5).map((item) => (
            <Link className={`product-nav-link ${isActive(pathname, item.href) ? "active" : ""}`} href={item.href} key={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          <p className="nav-section-label nav-section-spaced">Control</p>
          {navigation.slice(5).map((item) => (
            <Link className={`product-nav-link ${isActive(pathname, item.href) ? "active" : ""}`} href={item.href} key={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-proof-card">
          <span className="proof-dot" aria-hidden="true" />
          <div><strong>{networkLabel(runtime)} runtime</strong><span>{runtime.defaultAssetSymbol} · {runtime.environment}</span></div>
          <Link href="/settings" aria-label="Open runtime settings">→</Link>
        </div>
      </aside>

      {menuOpen ? <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <div className="product-main">
        <header className="product-topbar">
          <div className="topbar-left">
            <button
              className="menu-trigger"
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              aria-controls="product-navigation"
            >☰</button>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/dashboard">Canalis</Link>
              {crumbs.map((crumb) => <span key={crumb.href}><i aria-hidden="true">/</i><Link href={crumb.href} aria-current={crumb.href === pathname ? "page" : undefined}>{crumb.label}</Link></span>)}
            </nav>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-expanded={searchOpen}
              aria-controls="workspace-command-panel"
            >
              <span>Search workspace</span><kbd aria-hidden="true">⌘ K</kbd>
            </button>
            <NotificationCenter />
            <Link className="topbar-task-link" href="/tasks/new">New task</Link>
            <Link className="network-badge" href="/settings" title={`${runtime.environment} workspace · ${runtime.solanaNetwork}`} aria-label={`Runtime network ${networkLabel(runtime)}. Open settings.`}><i aria-hidden="true" />{networkLabel(runtime)}</Link>
            <WalletAccountControl />
          </div>
        </header>
        <main id="main-content" className="product-content" tabIndex={-1}>{children}</main>
      </div>

      <nav className="mobile-tabbar" aria-label="Mobile product navigation">
        {navigation.slice(0, 5).map((item) => (
          <Link className={isActive(pathname, item.href) ? "active" : ""} href={item.href} key={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <span aria-hidden="true">{item.glyph}</span><small>{item.label}</small>
          </Link>
        ))}
      </nav>

      {searchOpen ? (
        <ModalSurface
          onClose={() => setSearchOpen(false)}
          backdropClassName="command-backdrop"
          panelClassName="command-panel"
          ariaLabel="Search workspace"
        >
          <div id="workspace-command-panel">
            <div className="command-input-row"><span aria-hidden="true">⌕</span><input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a workspace…" aria-label="Search workspace" /><kbd aria-hidden="true">ESC</kbd></div>
            <div className="command-results">
              {filteredItems.map((item) => <Link href={item.href} key={`${item.href}-${item.label}`}><span className="command-glyph" aria-hidden="true">{item.glyph}</span><span>{item.label}</span><small>Open →</small></Link>)}
              {filteredItems.length === 0 ? <p className="command-empty" role="status">No matching destination.</p> : null}
            </div>
          </div>
        </ModalSurface>
      ) : null}
    </div>
  );
}

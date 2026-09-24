import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()}
      {...props}
    />
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`.trim()} {...props} />;
}

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section
      className={`ui-card ${interactive ? "ui-card-interactive" : ""} ${className}`.trim()}
    >
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Tabs({
  items,
  activeId,
  onChange,
  ariaLabel = "Sections",
}: {
  items: Array<{ id: string; label: string }>;
  activeId: string;
  onChange(id: string): void;
  ariaLabel?: string;
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          aria-selected={activeId === item.id}
          className="ui-tab"
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DialogFrame({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="ui-dialog-head">
        <h2 id="dialog-title">{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="ui-dialog-body">{children}</div>
      {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
    </div>
  );
}

export function Toast({
  title,
  detail,
  tone = "neutral",
}: {
  title: string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`ui-toast ui-toast-${tone}`} role="status">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-glyph" aria-hidden="true">◇</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`ui-skeleton ${className}`.trim()} />;
}

export function NavItem({
  href,
  active = false,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <a className={`ui-nav-item ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      {children}
    </a>
  );
}

export function TableShell({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="ui-table-shell" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

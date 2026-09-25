"use client";

import {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && !element.hasAttribute("inert");
  });
}

export function ModalSurface({
  children,
  onClose,
  backdropClassName,
  panelClassName,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  role = "dialog",
}: {
  children: ReactNode;
  onClose: () => void;
  backdropClassName?: string;
  panelClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  role?: "dialog" | "alertdialog";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const preferred = panel.querySelector<HTMLElement>("[data-autofocus]");
    const first = preferred ?? focusableElements(panel)[0] ?? panel;
    window.requestAnimationFrame(() => first.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = focusableElements(panel!);
      if (nodes.length === 0) {
        event.preventDefault();
        panel!.focus();
        return;
      }
      const firstNode = nodes[0]!;
      const lastNode = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && active === firstNode) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && active === lastNode) {
        event.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <div
      className={backdropClassName ?? "ux-dialog-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName ?? "ux-dialog-panel"}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "neutral";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;

  return (
    <ModalSurface
      onClose={() => {
        if (!busy) onCancel();
      }}
      role="alertdialog"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
    >
      <div className="ux-confirm-copy">
        <span className="ux-confirm-kicker">Confirm action</span>
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="ux-confirm-description">{description}</div>
      </div>
      <div className="ux-confirm-actions">
        <button type="button" data-autofocus disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button
          type="button"
          className={`ux-confirm-button ux-confirm-${tone}`}
          disabled={busy}
          onClick={() => void onConfirm()}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </ModalSurface>
  );
}

export function FieldMessage({
  id,
  children,
  tone = "error",
  ...props
}: {
  id: string;
  children: ReactNode;
  tone?: "error" | "help" | "success";
} & Omit<HTMLAttributes<HTMLElement>, "id">) {
  return <small id={id} className={`ux-field-message ux-field-${tone}`} {...props}>{children}</small>;
}

export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

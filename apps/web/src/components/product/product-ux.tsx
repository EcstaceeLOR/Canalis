"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
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

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

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
        data-ux-managed="true"
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

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "warning" | "neutral";
};

function normalizedButtonText(button: HTMLButtonElement) {
  return button.innerText.replace(/\s+/g, " ").trim().toLowerCase();
}

function confirmationFor(pathname: string, button: HTMLButtonElement): Confirmation | null {
  const text = normalizedButtonText(button);
  if (button.disabled || button.dataset.uxConfirmBypass === "true" || button.closest('[data-ux-managed="true"]')) return null;

  if (pathname.startsWith("/tasks") && text === "cancel") {
    return {
      title: "Cancel this task?",
      description: "This stops the task from continuing. Persisted receipts and payment evidence remain available for audit and recovery.",
      confirmLabel: "Cancel task",
      tone: "danger",
    };
  }
  if (pathname.startsWith("/tasks") && text === "archive") {
    return {
      title: "Archive this task?",
      description: "The task will leave the active workspace. Historical receipts, policy snapshots, and settlement evidence are preserved.",
      confirmLabel: "Archive task",
      tone: "danger",
    };
  }
  if (pathname.startsWith("/policies") && text === "archive") {
    return {
      title: "Archive this policy?",
      description: "New tasks will no longer be able to select it. Existing tasks keep their immutable policy snapshots.",
      confirmLabel: "Archive policy",
      tone: "danger",
    };
  }
  if ((pathname.startsWith("/providers") || pathname.startsWith("/settings")) && text === "disable") {
    return {
      title: "Disable this integration?",
      description: "Canalis will stop selecting this provider for new task execution until it is verified and enabled again.",
      confirmLabel: "Disable integration",
      tone: "danger",
    };
  }
  if ((pathname.startsWith("/channels") || pathname.startsWith("/activity")) && text.startsWith("finalize")) {
    return {
      title: "Finalize this payment channel?",
      description: "Finalization is a terminal settlement action. Canalis will use the persisted authorized amount and reconcile the resulting Solana evidence.",
      confirmLabel: "Finalize channel",
      tone: "warning",
    };
  }
  if ((pathname.startsWith("/channels") || pathname.startsWith("/activity")) && text.startsWith("recover")) {
    return {
      title: "Recover unused escrow?",
      description: "This is a terminal recovery action. Only the amount Canalis currently marks as recoverable will be returned; ambiguous terminal states remain blocked from automatic replay.",
      confirmLabel: "Recover escrow",
      tone: "warning",
    };
  }
  return null;
}

function labelTables(root: ParentNode = document) {
  root.querySelectorAll<HTMLTableElement>("#main-content table").forEach((table) => {
    table.dataset.uxTable = "true";
    const headerNodes = table.querySelectorAll<HTMLTableCellElement>("thead th");
    const headers = Array.from(headerNodes).map((header, index) =>
      header.textContent?.trim() || (index === headerNodes.length - 1 ? "Actions" : `Column ${index + 1}`),
    );
    table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell instanceof HTMLTableCellElement) cell.dataset.label = headers[index] ?? `Column ${index + 1}`;
      });
    });
  });
}

function normalizeControls(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const text = button.innerText.trim();
    if (!button.getAttribute("aria-label") && text === "×") {
      button.setAttribute("aria-label", button.closest('[role="alert"], [role="status"]') ? "Dismiss message" : "Close dialog");
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".tasks-view-toggle button").forEach((button, index) => {
    button.setAttribute("aria-label", index === 0 ? "Show tasks as a table" : "Show tasks as cards");
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
  });

  root.querySelectorAll<HTMLElement>('[class*="notice"]').forEach((element) => {
    if (!element.getAttribute("role")) element.setAttribute("role", "status");
    if (!element.getAttribute("aria-live")) element.setAttribute("aria-live", "polite");
  });
  root.querySelectorAll<HTMLElement>('[class*="error"]').forEach((element) => {
    if (!element.getAttribute("role") && element.textContent?.trim()) element.setAttribute("role", "alert");
  });
}

function fieldLabel(control: FormControl) {
  const label = control.closest("label");
  if (!label) return "";
  const direct = label.querySelector<HTMLElement>(":scope > span");
  return (direct?.textContent ?? label.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function fieldValidationMessage(control: FormControl) {
  if (control.disabled || (control instanceof HTMLInputElement && control.readOnly)) return null;
  const label = fieldLabel(control);
  const value = control.value.trim();
  const positiveAmount = /(budget|max per call|maximum per call|total task ceiling|fixed price|channel ceiling|duration)/.test(label);

  if ((label === "name" || label.startsWith("name ")) && value.length < 2) return "Enter at least 2 characters.";
  if (label.startsWith("provider id") && value.length < 2) return "Enter a stable provider ID with at least 2 characters.";
  if (label.startsWith("payee") && !value) return "Enter the provider wallet or recipient.";
  if (label.startsWith("default asset symbol") && !value) return "Enter the workspace asset symbol.";
  if (label.startsWith("default asset mint") && document.querySelector(".product-shell")?.getAttribute("data-environment") === "mainnet" && !value) {
    return "A specific asset mint is required for a mainnet workspace.";
  }
  if (label.startsWith("endpoint") && !label.includes("optional")) {
    if (!value) return "Enter the provider endpoint.";
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return "Use an HTTP or HTTPS endpoint.";
      if (document.querySelector(".product-shell")?.getAttribute("data-environment") === "mainnet" && url.protocol !== "https:") {
        return "Mainnet provider endpoints must use HTTPS.";
      }
    } catch {
      return "Enter a valid absolute endpoint URL.";
    }
  }
  if (label.startsWith("credential header") && !value) return "Enter the HTTP header used for this API key.";
  if (positiveAmount) {
    const numeric = Number(value);
    if (!value || !Number.isFinite(numeric) || numeric <= 0) return "Enter a value greater than 0.";
  }
  return null;
}

function validateControl(control: FormControl) {
  const message = fieldValidationMessage(control);
  const existing = control.parentElement?.querySelector<HTMLElement>(":scope > [data-ux-validation]") ?? null;
  if (!message) {
    control.removeAttribute("aria-invalid");
    if (existing) {
      const id = existing.id;
      existing.remove();
      const describedBy = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((value) => value && value !== id);
      if (describedBy.length) control.setAttribute("aria-describedby", describedBy.join(" "));
      else control.removeAttribute("aria-describedby");
    }
    return;
  }

  control.setAttribute("aria-invalid", "true");
  const controlId = control.id || `ux-field-${Math.random().toString(36).slice(2, 10)}`;
  if (!control.id) control.id = controlId;
  const messageId = `${controlId}-error`;
  let messageNode = existing;
  if (!messageNode) {
    messageNode = document.createElement("small");
    messageNode.dataset.uxValidation = "true";
    messageNode.className = "ux-field-message ux-field-error";
    control.insertAdjacentElement("afterend", messageNode);
  }
  messageNode.id = messageId;
  messageNode.textContent = message;
  const describedBy = new Set((control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
  describedBy.add(messageId);
  control.setAttribute("aria-describedby", [...describedBy].join(" "));
}

function focusLegacyDialog(dialog: HTMLElement, previous: WeakMap<HTMLElement, HTMLElement | null>) {
  if (dialog.dataset.uxManaged === "true" || dialog.dataset.uxRuntimeFocused === "true") return;
  dialog.dataset.uxRuntimeFocused = "true";
  previous.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
  const preferred = dialog.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
  const first = preferred ?? focusableElements(dialog)[0] ?? dialog;
  window.requestAnimationFrame(() => first.focus());
}

export function ProductUxRuntime() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pendingButton = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const legacyFocus = useRef(new WeakMap<HTMLElement, HTMLElement | null>());
  const touched = useRef(new WeakSet<FormControl>());

  useEffect(() => {
    labelTables();
    normalizeControls();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          labelTables(node);
          normalizeControls(node);
          if (node.matches('[role="dialog"][aria-modal="true"]')) focusLegacyDialog(node, legacyFocus.current);
          node.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]').forEach((dialog) => focusLegacyDialog(dialog, legacyFocus.current));
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const dialogs = [
            ...(node.matches('[role="dialog"][aria-modal="true"]') ? [node] : []),
            ...Array.from(node.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')),
          ];
          dialogs.forEach((dialog) => {
            const previous = legacyFocus.current.get(dialog);
            if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus());
          });
        });
      }
      labelTables();
      normalizeControls();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.uxConfirmBypass === "true") {
        delete target.dataset.uxConfirmBypass;
        return;
      }
      const config = confirmationFor(window.location.pathname, target);
      if (!config) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingButton.current = target;
      previousFocus.current = target;
      setConfirmation(config);
    }

    function onKeyDown(event: KeyboardEvent) {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]:not([data-ux-managed="true"])'));
      const dialog = dialogs.at(-1);
      if (!dialog) return;
      if (event.key === "Escape") {
        const close = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
          const label = button.getAttribute("aria-label")?.toLowerCase() ?? "";
          const text = button.innerText.trim().toLowerCase();
          return label.includes("close") || text === "×" || text === "close" || text === "cancel";
        });
        if (close) {
          event.preventDefault();
          close.click();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusableElements(dialog);
      if (!nodes.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusOut(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      if (!target.closest("#main-content")) return;
      touched.current.add(target);
      validateControl(target);
    }

    function onFieldChange(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      if (!target.closest("#main-content") || !touched.current.has(target)) return;
      validateControl(target);
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("input", onFieldChange, true);
    document.addEventListener("change", onFieldChange, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("input", onFieldChange, true);
      document.removeEventListener("change", onFieldChange, true);
    };
  }, []);

  function cancelConfirmation() {
    pendingButton.current = null;
    setConfirmation(null);
    window.requestAnimationFrame(() => previousFocus.current?.focus());
  }

  function confirmAction() {
    const button = pendingButton.current;
    pendingButton.current = null;
    setConfirmation(null);
    if (!button || !button.isConnected || button.disabled) return;
    button.dataset.uxConfirmBypass = "true";
    window.requestAnimationFrame(() => button.click());
  }

  return (
    <ConfirmDialog
      open={Boolean(confirmation)}
      title={confirmation?.title ?? "Confirm action"}
      description={confirmation?.description ?? "Confirm this action before continuing."}
      confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
      tone={confirmation?.tone ?? "danger"}
      onCancel={cancelConfirmation}
      onConfirm={confirmAction}
    />
  );
}

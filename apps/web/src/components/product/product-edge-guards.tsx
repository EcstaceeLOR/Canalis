"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./product-ux";

function text(button: HTMLButtonElement) {
  return button.innerText.replace(/\s+/g, " ").trim().toLowerCase();
}

function clearPending(button: HTMLButtonElement) {
  if (button.dataset.uxPending !== "true") return;
  delete button.dataset.uxPending;
  button.removeAttribute("aria-busy");
  button.removeAttribute("aria-disabled");
  button.style.removeProperty("pointer-events");
  button.style.removeProperty("opacity");
}

function markPending(button: HTMLButtonElement) {
  button.dataset.uxPending = "true";
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-disabled", "true");
  button.style.pointerEvents = "none";
  button.style.opacity = "0.58";
}

export function ProductEdgeGuards() {
  const [confirmContainment, setConfirmContainment] = useState(false);
  const pendingContainment = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onCaptureClick(event: MouseEvent) {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;

      if (button.dataset.uxPending === "true") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (button.dataset.uxContainBypass === "true") {
        delete button.dataset.uxContainBypass;
        return;
      }

      if (window.location.pathname.startsWith("/tasks") && text(button) === "contain task") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        pendingContainment.current = button;
        setConfirmContainment(true);
      }
    }

    function onBubbleClick(event: MouseEvent) {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      if (!window.location.pathname.startsWith("/channels")) return;
      const label = text(button);
      if (label.startsWith("finalize") || label.startsWith("recover")) markPending(button);
    }

    function clearTerminalPending() {
      document.querySelectorAll<HTMLButtonElement>('button[data-ux-pending="true"]').forEach(clearPending);
    }

    const feedbackObserver = new MutationObserver(() => {
      const feedback = Array.from(document.querySelectorAll<HTMLElement>('#main-content [role="alert"], #main-content [role="status"]'))
        .some((element) => Boolean(element.textContent?.trim()));
      if (feedback) clearTerminalPending();
    });
    const main = document.getElementById("main-content");
    if (main) feedbackObserver.observe(main, { childList: true, subtree: true, characterData: true });

    document.addEventListener("click", onCaptureClick, true);
    document.addEventListener("click", onBubbleClick, false);
    return () => {
      feedbackObserver.disconnect();
      document.removeEventListener("click", onCaptureClick, true);
      document.removeEventListener("click", onBubbleClick, false);
      clearTerminalPending();
    };
  }, []);

  function cancelContainment() {
    const button = pendingContainment.current;
    pendingContainment.current = null;
    setConfirmContainment(false);
    window.requestAnimationFrame(() => button?.focus());
  }

  function confirmContainmentAction() {
    const button = pendingContainment.current;
    pendingContainment.current = null;
    setConfirmContainment(false);
    if (!button || !button.isConnected || button.disabled) return;
    button.dataset.uxContainBypass = "true";
    window.requestAnimationFrame(() => button.click());
  }

  return (
    <ConfirmDialog
      open={confirmContainment}
      title="Contain this partially executed task?"
      description="Canalis will cancel further execution while preserving the provider work, receipts, and payment evidence already recorded. You can then create a fresh recovery run from the stored task snapshot."
      confirmLabel="Contain task"
      tone="warning"
      onCancel={cancelContainment}
      onConfirm={confirmContainmentAction}
    />
  );
}

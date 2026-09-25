import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const failures = [];
const requireText = (content, needle, label) => {
  if (!content.includes(needle)) failures.push(`${label}: missing ${needle}`);
};
const requireFile = (path) => {
  if (!existsSync(new URL(`../${path}`, import.meta.url))) failures.push(`missing file: ${path}`);
};

const shell = read("apps/web/src/components/product/app-shell.tsx");
const ux = read("apps/web/src/components/product/product-ux.tsx");
const channels = read("apps/web/src/components/product/channels-workspace.tsx");
const css = read("apps/web/src/app/production-ux.css");
const loading = read("apps/web/src/app/(product)/loading.tsx");
const error = read("apps/web/src/app/(product)/error.tsx");
const quality = read("docs/production-ux-quality.md");

requireText(shell, 'className="skip-link"', "shell");
requireText(shell, 'id="main-content"', "shell");
requireText(shell, 'aria-current=', "shell");
requireText(shell, "ProductUxRuntime", "shell");
requireText(shell, "ModalSurface", "shell");
if (/reference task|reference proof|run demo/i.test(shell)) failures.push("shell: demo/reference-only search affordance returned");

requireText(ux, "ConfirmDialog", "UX runtime");
requireText(ux, "role=\"alertdialog\"", "UX runtime");
requireText(ux, "labelTables", "UX runtime");
requireText(ux, "confirmationFor", "UX runtime");
requireText(ux, "fieldValidationMessage", "UX runtime");
requireText(ux, 'setAttribute("aria-invalid", "true")', "UX runtime");
requireText(ux, 'text.startsWith("finalize")', "UX runtime");
requireText(ux, 'text.startsWith("recover")', "UX runtime");
requireText(ux, 'text === "archive"', "UX runtime");
requireText(ux, 'text === "disable"', "UX runtime");
requireText(ux, 'event.key === "Tab"', "UX runtime");
requireText(ux, 'event.key === "Escape"', "UX runtime");

requireText(channels, "networkLabel(channel.network)", "channels");
requireText(channels, 'fetch("/api/providers"', "channels");
if (channels.includes("● Devnet") || channels.includes("cluster=devnet`;")) failures.push("channels: hard-coded devnet presentation returned");

requireText(css, "[data-ux-table]", "production UX CSS");
requireText(css, "safe-area-inset-bottom", "production UX CSS");
requireText(css, "prefers-reduced-motion: reduce", "production UX CSS");
requireText(css, ":focus-visible", "production UX CSS");
requireText(css, ".skip-link", "production UX CSS");

requireText(loading, 'aria-busy="true"', "route loading");
requireText(error, 'className="error-page"', "route error");
requireFile("apps/web/src/app/(product)/not-found.tsx");

requireText(quality, "360 × 800", "quality baseline");
requireText(quality, "Accessibility | >= 95", "quality baseline");
requireText(quality, "WCAG 2.2 AA", "quality baseline");

if (failures.length) {
  console.error("Production UX contract check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Production UX contract check passed.");

import { notFound } from "next/navigation";

export default function AccessibilitySmokePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="page-stack" aria-labelledby="a11y-smoke-title">
      <h1 id="a11y-smoke-title">Accessibility smoke surface</h1>
      <p>This development-only route exists for manual keyboard and screen-reader checks. It is not exposed in production navigation.</p>
      <button type="button">Focusable control</button>
    </main>
  );
}

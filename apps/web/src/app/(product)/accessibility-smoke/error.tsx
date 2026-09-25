"use client";

export default function AccessibilitySmokeError({ reset }: { reset: () => void }) {
  return <div role="alert"><p>Accessibility smoke route failed.</p><button type="button" onClick={reset}>Retry</button></div>;
}

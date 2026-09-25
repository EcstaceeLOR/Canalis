# Canalis production UX quality baseline

Issue #37 establishes a product-wide usability and accessibility contract for the authenticated Canalis application.

## Responsive baseline

Primary workflows must remain usable at these representative widths without horizontal page scrolling:

- phone: 360 × 800
- large phone: 430 × 932
- tablet: 768 × 1024
- compact desktop: 1024 × 768
- desktop: 1440 × 900

Semantic data tables are automatically converted to labeled record cards at widths up to 760px. The bottom product navigation respects `env(safe-area-inset-bottom)`, modal surfaces become mobile sheets, and long identifiers must wrap rather than expand the viewport.

## Keyboard and screen-reader contract

- a visible-on-focus skip link targets `#main-content`
- the active primary navigation item exposes `aria-current="page"`
- modal and command surfaces trap focus, close with Escape, and restore the previous focus target
- legacy product dialogs are normalized by the shared UX runtime until they are migrated to `ModalSurface`
- destructive and terminal task/provider/policy/channel actions require an `alertdialog` confirmation
- asynchronous success messages use polite status announcements; errors use alert semantics
- icon-only close/view controls receive accessible names and task view toggles expose pressed state
- focus-visible styling must remain clearly visible against the dark product surfaces
- `prefers-reduced-motion: reduce` disables non-essential animation and smooth scrolling

The target is WCAG 2.2 AA behavior for primary product flows. Automated checks do not replace manual keyboard and assistive-technology review.

## Async and non-happy-path contract

Every data workspace must provide a first-load/loading treatment, empty state, recoverable error state, and explicit success feedback for mutations. Route-level loading, error, and not-found states remain available when a page itself cannot render.

No production navigation/search control may point to a demo-only destination or pretend that unsupported mainnet execution exists. Runtime environment and network are shown from persisted settings.

## Lighthouse targets

Run Lighthouse against an authenticated production or preview deployment at mobile and desktop emulation after a release candidate is deployed. These are release targets rather than fabricated local measurements:

| Category | Mobile target | Desktop target |
| --- | ---: | ---: |
| Accessibility | >= 95 | >= 95 |
| Best Practices | >= 90 | >= 90 |
| Performance | >= 80 | >= 90 |
| SEO (public landing) | >= 90 | >= 90 |

Performance exceptions must be documented with the affected route and the largest blocking resource before release.

## CI enforcement

`pnpm ux:check` statically enforces the shared production UX contracts that are practical to verify without a running authenticated browser: skip navigation, focus/modal primitives, destructive confirmation coverage, mobile table conversion, reduced motion, safe-area support, route loading/error/not-found states, and removal of demo-only command-palette affordances.

The normal CI gate remains authoritative for production build, tests, TypeScript, security checks, and the UX contract check.

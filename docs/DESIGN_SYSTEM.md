# Canalis design system

Canalis uses one visual idea throughout the product: **many autonomous payment routes entering one governed channel**.

## Brand mark

The Canalis mark is a confluence symbol:

- three independent routes enter from the left,
- a central governed junction represents policy and payment orchestration,
- one controlled flow exits to the right.

It is intentionally not a lettermark and should not be redrawn as a boxed `C`.

Assets:

- `apps/web/public/canalis-mark.svg` — primary gradient mark for dark/product surfaces
- `apps/web/public/canalis-mark-mono.svg` — monochrome mark for light, print, or constrained contexts
- `apps/web/src/app/icon.svg` — application/favicon treatment
- `apps/web/src/components/brand/canalis-logo.tsx` — reusable mark + wordmark component with `brand`, `mono`, and `muted` tones

Keep clear space around the mark equal to roughly one terminal-node diameter. Do not stretch, rotate, recolor individual routes, add drop shadows inside the mark, or combine it with Solana's logo.

## Color system

Brand colors are intentionally distinct from Solana while remaining technical and high-contrast:

- `--color-brand-400: #8b7cff` — primary governed-flow indigo
- `--color-brand-500: #7565ff` — interaction/active indigo
- `--color-accent-400: #43e6c8` — successful route/output accent

Product surfaces and text use semantic tokens such as `--color-bg-canvas`, `--color-surface-1`, `--color-text-primary`, and `--color-border-default`. New pages should use semantic tokens rather than raw hex values.

Semantic status colors are:

- success: `--color-success`
- warning: `--color-warning`
- danger: `--color-danger`
- info: `--color-info`

## Typography

The product uses the system-first `--font-sans` stack for speed and consistent rendering. Type sizes are tokenized from `--text-xs` through `--text-display` and scale down responsively on small screens.

Headlines should be short and high-signal. Product controls, tables, receipts, and metadata should prioritize legibility over decorative typography.

## Spacing and shape

Use the spacing scale `--space-1` through `--space-20`. Prefer `--radius-md` for controls, `--radius-lg` for cards/tables, and `--radius-xl` for dialogs or major floating surfaces.

Avoid inventing page-local spacing/radius values unless the layout cannot be represented by the shared scale.

## Shared primitives

`apps/web/src/components/ui/primitives.tsx` provides the baseline product primitives:

- `Button` — primary, secondary, ghost, and danger variants; small/medium/large sizing
- `Input` — standard product field treatment
- `Card` — static and interactive surfaces
- `Badge` — neutral/brand/success/warning/danger states
- `Tabs` — keyboard-focusable route/section tabs
- `DialogFrame` — consistent modal/dialog content shell
- `Toast` — transient operational feedback
- `EmptyState` — actionable no-data state
- `Skeleton` — loading placeholder with reduced-motion support
- `NavItem` — application navigation item
- `TableShell` — accessible horizontally-scrollable data container

Issue #23 and subsequent product pages should compose these primitives instead of creating independent button/card/table systems.

## Interaction rules

Every interactive control must have:

- visible keyboard focus,
- hover treatment where a pointer exists,
- disabled treatment when unavailable,
- explicit error state for invalid form values,
- semantic status copy instead of color-only communication.

Animations must respect `prefers-reduced-motion`.

## Light/dark usage

The current application is dark-first. The primary gradient mark is optimized for dark surfaces. Use the monochrome mark or `CanalisLogo tone="mono"` on light/neutral surfaces. Do not place the gradient mark on visually noisy backgrounds.

## Product voice

Canalis should feel like financial infrastructure for software agents: controlled, technical, transparent, and calm. Avoid casino/trading aesthetics, excessive neon, meme styling, and generic Web3 gradients used without functional meaning.

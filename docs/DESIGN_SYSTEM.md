# Canalis design system

Canalis is financial infrastructure for autonomous software agents: controlled, technical, transparent, and calm.

## Brand mark — Flow

The approved Canalis identity is **Flow**: two ribbon-like lanes moving through a shared direction with a distinct terminal node.

The mark represents:

- autonomous value moving continuously rather than transaction-by-transaction UI chrome,
- multiple paid operations sharing one governed financial layer,
- a clear destination/settlement point without turning the logo into a literal architecture diagram.

The silhouette must remain identifiable in one color. Gradient is an optional brand treatment, never the thing that makes the logo recognizable.

### Assets

- `apps/web/public/canalis-mark.svg` — primary color Flow mark
- `apps/web/public/canalis-mark-mono.svg` — monochrome Flow mark for light, print, or constrained contexts
- `apps/web/src/app/icon.svg` — dark application/favicon treatment
- `apps/web/src/components/brand/canalis-logo.tsx` — reusable Flow mark + `Canalis` wordmark component with `brand`, `mono`, and `muted` tones

Keep clear space around the mark equal to roughly the terminal-node diameter. Do not stretch, rotate, add internal shadows, outline individual ribbons, or combine the mark with Solana's logo.

### Wordmark

Use `Canalis` in title case for primary product lockups. All-caps `CANALIS` may remain only in small legacy metadata until those surfaces are replaced by the multi-page product shell.

## Color system

Brand colors are intentionally distinct from Solana while remaining technical and high-contrast:

- `--color-brand-400: #8b7cff` — primary indigo
- `--color-brand-500: #7565ff` — interaction/active indigo
- `--color-accent-400: #43e6c8` — routed-flow accent

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
- `Input` — standard product field treatment with disabled/error states
- `Field` — label, hint, and validation-message wrapper
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

The current application is dark-first. The primary color mark is optimized for dark surfaces. Use the monochrome mark or `CanalisLogo tone="mono"` on light/neutral surfaces. The mark must remain legible without gradient color.

## Product voice

Canalis should feel like financial infrastructure for software agents: controlled, technical, transparent, and calm. Avoid casino/trading aesthetics, excessive neon, meme styling, and generic Web3 gradients used without functional meaning.

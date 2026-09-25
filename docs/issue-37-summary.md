# Issue #37 implementation summary

The authenticated Canalis product now uses a shared production UX layer for responsive data presentation, accessible focus behavior, destructive-action confirmation, async announcements, and inline field feedback.

Key contracts:

- skip navigation and active-page semantics in the product shell
- command palette focus trapping/restoration
- legacy dialog keyboard containment while workspaces migrate to the shared modal primitive
- route-aware confirmation for task cancel/archive, policy archive, provider/integration disable, and channel finalize/recovery
- automatic semantic-table labeling and mobile card conversion
- safe-area-aware mobile navigation and sheets
- reduced-motion support and visible focus states
- route loading/error/not-found treatments
- environment-aware channel network/Explorer presentation and registry-backed provider filtering
- development-only accessibility smoke surface plus documented manual review matrix
- `pnpm ux:check` enforced in CI alongside build/tests/typecheck/security

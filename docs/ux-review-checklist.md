# Canalis release UX review checklist

Use this checklist on an authenticated preview or production candidate after CI is green.

## Viewports

- 360 × 800: dashboard, tasks, task detail, channels, transactions, providers, policies, activity, settings
- 768 × 1024: same primary pages with keyboard navigation
- 1440 × 900: same primary pages with dense tables and command search

## Primary flows

- connect/reconnect wallet and recover from an expired session
- create and save a governed task, then revisit it from Tasks
- filter and paginate tasks, channels, transactions, and activity
- open command search with keyboard, navigate, Escape, and confirm focus returns
- add/edit a provider and verify inline invalid-field feedback
- archive a task/policy and disable an integration only after confirmation
- finalize/recover an eligible channel only after confirmation
- verify an ambiguous terminal channel remains inspect-only
- change runtime settings and confirm network/environment badges update

## Accessibility spot checks

- Tab order follows visual order and no modal leaks focus behind the overlay
- focus indicators remain visible on dark surfaces
- success/error messages are announced and dismiss controls have names
- mobile table cards expose a visible label for each value
- reduced-motion OS preference removes shimmer/smooth transitions
- zoom to 200% does not introduce horizontal page scrolling for primary flows

## Release evidence

Record the deployment URL, commit SHA, Lighthouse scores, viewport/browser used, and any accepted exception in the release notes. Do not invent Lighthouse measurements when the authenticated deployment cannot be tested.

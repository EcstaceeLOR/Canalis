# Lighthouse baseline policy

Canalis does not fabricate Lighthouse scores in CI because authenticated product routes require wallet/session state and durable backend services. The release target floors are defined in `docs/production-ux-quality.md` and must be measured against a deployed release candidate.

For each release candidate, record:

- deployed URL and exact commit SHA
- mobile and desktop Lighthouse Accessibility, Best Practices, and Performance scores
- public landing SEO score
- browser/Lighthouse version and viewport preset
- any accepted regression with owner and follow-up issue

The CI-enforced `pnpm ux:check` protects the static accessibility/responsive contracts that can be verified deterministically without pretending a synthetic score is a real deployed measurement.

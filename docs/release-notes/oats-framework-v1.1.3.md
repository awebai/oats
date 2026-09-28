# oats.framework 1.1.3 · aweb 1.11.2 — helper composition for every edition

Packaging fix: `oats.core` and `oats.aweb` shipped an `inject` without a
`helperInjection` policy, so preparation refused with `needs-configuration: new
helper injection requires an explicit capability policy`, no edition's OKF
harvest helper could compose, and no edition could publish a resolution.

- **`oats.core` 1.0.1** (in oats.framework 1.1.3): `helperInjection: {version:
  1, mode: inherit}`; a helper keeps the "you run on OATS" briefing.
- **aweb 1.11.2**: `helperInjection: {version: 1, mode: omit}`; a harvest
  helper has no messaging identity. Manifest-only.
- Catalog: `oats.aweb` → `v1.11.2`, `oats.framework` →
  `oats-framework/v1.1.3`; six editions and workspace imports repinned.

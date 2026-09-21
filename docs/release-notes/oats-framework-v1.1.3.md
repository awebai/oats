# oats.framework 1.1.3 · aweb 1.11.2 — helper composition for every edition

Packaging fix found by the independent second operator on the 0.24.4 wave: behind the operator's `responsibleHuman` requirement, preparation refused with `needs-configuration: new helper injection requires an explicit capability policy`. `oats.okf` had adopted the helper-injection contract (`omit`); its siblings **`oats.core`** and **`oats.aweb`** shipped an `inject` without a `helperInjection` policy, so no edition's OKF harvest helper could compose and **no edition could publish a resolution**. Both remaining blockers were packaging, not operator input.

- **`oats.core` 1.0.1** (in oats.framework 1.1.3): `helperInjection: {version: 1, mode: inherit}` — a helper is still an OATS instance and keeps the "you run on OATS" briefing.
- **aweb 1.11.2**: `helperInjection: {version: 1, mode: omit}` — a harvest helper has no messaging identity. Manifest-only; code identical to 1.11.0.
- **Release check**: `test/release-packaging.test.mjs` now asserts every framework-shipped capability with an `inject` declares a `helperInjection` policy; the theory-package check pins core's `inherit`. The framework's own packages must pass the contracts the kernel imposes.
- Catalog: `oats.aweb` → `v1.11.2`, `oats.framework` → `oats-framework/v1.1.3`; six editions and workspace imports repinned.
- Still open (kernel, 0.25 unless a 0.24.5 is cut): this early refusal is a bare top-level error with no `details`/attribution — it must route through the same problem shape as every other preparation problem. Also noted: `responsibleHuman` is a captured accountability claim the code validates only by shape.

Decision: `agents/oats-expert/soul/knowledge/decisions/helper-injection-policy-on-every-injecting-capability.md`.

---
type: Decision
title: Every capability that ships an `inject` declares a `helperInjection` policy; the framework's own do so first
status: accepted
description: `oats.core` declares `helperInjection: {version: 1, mode: inherit}` and `oats.aweb` declares `mode: omit`, closing the gap the second operator found where a helper composition refused because siblings of OKF had never adopted the helper-injection contract. Adoption is a release-time check on the framework's own packages, and early helper-policy refusals must carry attribution.
tags: [kernel, capabilities, helper-injection, packaging, second-operator, oats.core, oats.aweb]
timestamp: 2026-09-21
---

Decided 2026-09-21 by the lead from the independent second operator's
finding on the published 0.24.4 wave.

# Context

The helper/input contract (2026-09-17) says a capability that ships an
`inject` must declare how a *helper* composition treats it
(`helperInjection`: `inherit` / `omit` / `file`); a missing declaration is a
typed `needs-configuration` refusal, never a silent guess. OKF adopted it
(`omit`, so the harvest helper does not recurse). `oats.core` (oats.framework
1.1.x) and `oats.aweb` (1.11.x) ship injections and never adopted it. Since
every framework soul edition declares `oats.core`, **no edition could publish
a resolution** once its OKF harvest helper composed — a packaging gap
sitting behind the `responsibleHuman` requirement, which the operator only
saw by supplying a synthetic identity. The refusal was a bare top-level
error with no `details`, so it bypassed the attribution machinery.

# Decision

1. **`oats.core` → `inherit`.** A helper is still an OATS instance; the "you
   run on OATS" briefing belongs in it.
2. **`oats.aweb` → `omit`.** A harvest helper has no messaging identity and
   must not be told it can mail; provider-side helper skip already exists.
3. **Framework release check.** The packaging test on this repo asserts that
   every bundled or exported capability with `inject` also declares
   `helperInjection` — the framework's own packages are the first that must
   pass the contract they impose.
4. **Early refusals are attributed.** `captureHelperInjectionChoices` must
   raise its `needs-configuration` with the offending capability id (and
   slot where applicable) in the same problem shape preparation uses, so it
   renders like every other problem. Kernel change, 0.25 unless a 0.24.5 is
   cut for the retirement defect, in which case it rides along.
5. **Guard rule generalised.** Any new manifest contract that a kernel
   refuses on absence is adopted by the framework's own capabilities in the
   same release that introduces the refusal; a test enforces it. Recorded so
   the fourth "sibling never adopted the contract" finding is the last.

# Consequences

- `oats.framework` 1.1.3 (core manifest) and aweb 1.11.2 (manifest-only) —
  no code change; floors unchanged (the field is read by every kernel that
  has the helper contract, 0.24.0+).
- Edition pins and imports move again; the operator's acceptance sequence is
  re-run unchanged.
- `responsibleHuman` remains recorded as a captured accountability claim the
  code does not verify beyond shape — convention, not enforcement. Noted; a
  verification step, if wanted, is a separate Decision.

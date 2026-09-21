---
type: Lesson
title: Captured launch compilation treats `ifInstalled` runtime requirements as hard blocks and refuses without attribution
description: `compileCapturedLaunchRequest` calls `applicableRequirements`, which returns every `requires[]` row whose `runtime`/`when` match — including rows marked `ifInstalled: true` (a version floor that applies only when the package happens to be present). Any non-empty list refuses with one bare `needs-configuration` and no `details`, so a Pi launch with aweb `delivery: session` can never publish a resolution even though the same request without `launch` publishes fine.
tags: [lessons, kernel, captured-launch, runtime-requirements, ifInstalled, attribution, second-operator]
timestamp: 2026-09-21
---

# What happened

After the helper-injection packaging fix (oats.framework 1.1.3 / aweb 1.11.2),
the lead's end-to-end probe from the published 0.24.4 tarball got past every
binding and helper step and then refused at launch compilation:

    needs-configuration: runtime package requirements need retained runtime
    roots and a qualified loader; no ambient package discovery was used

Same request **without** the `launch` block → `status: prepared`, resolution
and execution binding published. So the whole graph resolves; only the
captured launch recipe blocks.

# Why

`lib/captured-launch-request.mjs` `compileCapturedLaunchRequest`:

    const required = kernel.runtimeRequirements(runtime, providers);
    if (required.length) throw oatsError('needs-configuration', '…');

`kernel.runtimeRequirements` is `applicableRequirements` (`core.mjs`), which
keeps every row with matching `runtime` and satisfied `when`, ignoring
`ifInstalled`. aweb declares for `pi` + `delivery: session`:
`{package: npm:@awebai/pi, minVersion: 0.3.10, ifInstalled: true}` — "if an
ambient extension exists it must be ≥0.3.10; none at all is fine". The
legacy start path (`core.mjs` ~5372) honours `ifInstalled` and skips absent
packages; the captured path does not, so the optional floor becomes a hard
block with no way for an operator to satisfy it (there are no "retained
runtime roots" to supply for a package that need not exist).

`delivery: channel` (a genuinely required, uninstalled package) produces the
byte-identical message — so the text cannot distinguish "install X" from
"nothing to do", and there is no `details`, `capability` or `package`.

# Fix (kernel, lifecycle lane)

1. In the captured path, drop rows with `ifInstalled: true` whose package is
   not retained (mirror the legacy start path); retained-root verification
   still applies to rows that are present.
2. Refuse the remaining hard requirements through the preparation problem
   shape: `slot`/`capability`, `package`, `runtime`, and the row's `install`
   remedy as a fixed provider-declared string — the same attribution every
   other problem has. No bare top-level refusals from `prepare`.
3. Regression: aweb `session` + Pi launch, no ambient extension → prepared;
   `channel` + Pi, package absent → one attributed problem naming
   `npm:@awebai/pi` and `oats.aweb`.

# Rule

`prepare` must never end in a bare `needs-configuration` with no `details`:
every refusal after selection is a problem with a slot/capability, or it is
a kernel defect. The helper-injection refusal and this one are the two known
offenders; audit `oatsError('needs-configuration'` call sites reachable from
preparation for others before 0.25.

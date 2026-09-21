---
type: Lesson
title: The catalog bundled in a kernel release is a snapshot; onboarding a current workspace edition against it fails as integrity drift
description: `oats onboard --workspace` copies the workspace's pinned setup-expert edition and requires its same-repository `oats-package` to hash-match the `oats.framework` the official catalog acquires. A kernel tarball ships the catalog as of its tag, so any later `oats.framework` release makes the bundled entry lag the editions; the refusal is correct, the remedy is pointing the kernel at the reviewed list (`OATS_PACKAGE_CATALOG`) — not editing either side.
tags: [lessons, onboarding, catalog, oats.framework, integrity-drift, release]
timestamp: 2026-09-21
---

# What happened

First `~/OATS` onboarding on kernel 0.24.4 against the public workspace
definition refused with `integrity-drift: selected edition's same-repository
package differs from the official acquisition`. Both trees (the edition's
revision and the `oats.framework` tag) hashed identically when checked by
hand. The kernel's *bundled* `package-catalog.json` still listed
`oats-framework/v1.1.1` — the entry at the time 0.24.4 was tagged — while the
workspace's editions were pinned to a revision whose `oats-package` is 1.1.3.
The kernel acquired 1.1.1, compared it with the edition's 1.1.3 payload, and
refused. Correct behaviour; misleading first read.

# Lesson

- The **reviewed list on main is the marketplace**; the copy inside a kernel
  release is a convenience snapshot that lags every distribution-tag release
  made after the kernel tag. `oats.framework` releases are deliberately
  decoupled from kernel releases, so lag is the normal state, not a defect.
- **Remedy at onboarding**: point the kernel at the reviewed list
  (`OATS_PACKAGE_CATALOG=<path to main's package-catalog.json>`), or pass the
  explicit selector. Never "fix" it by repinning editions backwards or by
  editing the bundled copy.
- **Design consequence (proposed, not decided)**: onboarding from a workspace
  should read the catalog *from the workspace's repository at the observed
  revision* — the workspace already names its own framework revision — or the
  kernel should surface "bundled catalog entry lags the edition's package" as
  the reason instead of a bare integrity mismatch. Either removes the trap for
  the second operator, who has no main checkout to point at.

# Related

- Release-order lesson: source → tag → pin; the kernel tarball snapshot is a
  fourth consumer of the pin that moves only with kernel releases.

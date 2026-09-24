---
type: Lesson
title: Path-keyed owner registries break under per-commit soul copies
description: A provider owner registry keyed by resolved soul paths breaks when workspace-model kernels materialize the same soul in per-commit directories, so persistent owner identity must use logical soul identity rather than realpath.
tags: [okf, oats, workspace-model, identity]
timestamp: 2026-09-23
---

OKF 2.1.x recorded `owner UUID -> realpath(home/soul)` in its state directory and refused a spawn whose soul resolved to a different path for the same owner. That guard was sound while a soul lived at one canonical path.

Under the workspace model, the kernel fetches a member soul into `agents/<name>/souls/<commit>/` and links each home to its own commit's directory. Every member commit changes the resolved soul path, so the next spawn for the same owner can roll back with "stable owner ID already identifies a different soul" even though the logical soul is unchanged.

The two designs are individually right and jointly wrong: immutable per-commit copies protect running instances, while a path-keyed registry assumes the path is the identity. Registries that persist owner mappings must key them by the soul's stable identity, such as repository key plus soul name or the logical pointer path before resolving links, and the kernel must hand that identity to the provider. Test any provider that records paths with a member commit followed by a second spawn before calling a workspace-model rebuild ready.

# Related

* [OKF state directory must sit outside every work tree](/lessons/okf-state-directory-must-sit-outside-every-work-tree.md) records a separate OKF/workspace placement gotcha.
* [Workspace model v2](/decisions/workspace-model-v2.md) describes the broader workspace model this failure depends on.

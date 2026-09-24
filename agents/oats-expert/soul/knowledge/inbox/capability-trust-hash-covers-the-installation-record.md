---
type: Lesson
title: Capability trust hash covers the installation record
description: Two deployments of the same package commit can show different trusted capability hashes when only .oats-installation.json differs, so compare package integrity and the tree before calling it drift.
tags: [oats, trust, capabilities, verification]
timestamp: 2026-09-21
---

The kernel's capability integrity (`capabilityIntegrity` in `lib/core.mjs`) hashes every managed byte under the installed capability directory except the root lock file. That includes `.oats-installation.json`, which records how the package was acquired. Installing with `oats update <pkg> --to vX` writes `source: catalog:<pkg>@vX`, while a bare install writes `source: catalog:<pkg>`; the payloads are byte-identical but the trusted artifact hash differs.

The lock's package row (`packages.<pkg>.integrity`, plus `commit`) is the payload digest and is what to compare across deployments. When a reviewer reports a trust-hash mismatch, run `diff -r` on the two installed trees before treating it as a different package: if the only difference is the installation record, the reviewed executable surface is the same.

Acquire packages the same way in every deployment that is meant to be compared (same `--to` form), so the trust hashes match and the check stays mechanical.

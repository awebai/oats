---
type: Decision
title: OATS package repositories select an explicit payload root
description: A Git repository may contain arbitrary development content while OATS copies, hashes, locks, and installs only a configured package subtree whose official convention is oats-package/.
tags: [packages, distribution, integrity, git, repository-layout]
timestamp: 2026-07-28
---

# OATS package repositories select an explicit payload root

The founder superseded the proposed special-case exclusion for top-level `agents/`. A package source now selects one contained payload root inside its Git checkout. The recommended and official directory is `oats-package/`; custom paths and an explicit repository-root package remain supported.

The selected directory contains `oats-package.json` and is the integrity/materialization boundary. OATS fetches one exact commit, resolves the configured path inside that checkout, and copies, hashes, locks, and installs only that subtree. Repository-level owner souls, CI, docs, and other development files are not distributed and cannot churn package integrity. Multiple catalog entries may select different package roots from one repository.

Catalog and Git source provenance must carry the package path explicitly, and lock v2 records it alongside the exact commit and integrity. Bare install restores that exact tuple; catalog or branch movement does not update it. `oats update <package-id>` remains the explicit operation that resolves a newer source and rewrites the lock.

This follows the locally verified Claude Code marketplace pattern: marketplace entries select local plugin directories or structured Git subdirectories rather than treating an entire marketplace repository as one installed plugin. OATS keeps its stricter exact-lock, containment, trust, and independently targetable capability contracts.

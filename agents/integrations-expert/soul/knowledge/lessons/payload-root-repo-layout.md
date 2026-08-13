---
type: Lesson
title: OATS payload-root repository layout (oats-package/) for official packages
description: How to split an official OATS package repo into a distributed oats-package/ payload root and repo-only dev tooling under the merged PR57 configurable-path kernel contract.
tags: [packaging, payload-root, oats-package, distribution, integration-craft]
timestamp: 2026-07-28
---

# OATS payload-root repository layout

Under the merged PR57 kernel contract, a public OATS package repository separates
its **distributed payload** from **repo-only tooling**. The kernel constant
`DEFAULT_PACKAGE_PATH = "oats-package"` (lib/core.mjs) makes `oats-package/` the
default contained package root selected inside a Git/catalog source; local
`path:` sources point at the EXACT `oats-package/` directory (which must contain
`oats-package.json`).

## What goes where

Inside `oats-package/` (the installed bytes — packageIntegrity hashes this subtree,
excluding .git/node_modules/oats-lock.json):
- `oats-package.json` (distribution manifest — marks the package root)
- the enumerated capability dir (`capabilities/<name>/`), or for a flat
  single-capability package (`"capabilities": ["."]`) the `oats.json` + `skills/`
  sit directly in `oats-package/`
- declared config profiles (`configs/<profile>/oats-config.yaml`)
- the distribution-required MIT `LICENSE`

Repo root, OUTSIDE the payload (never installed): `schemas/` (dev/CI copies of the
canonical package-engine schemas), `scripts/` (validate-manifests, sync tools,
catalog-selectors), `test/`, `.github/`, `README.md`, `SCHEMA-STATUS.md`, dev
`package.json`, and later `agents/<pkg>-expert/soul` (owner soul — NEVER inside
oats-package/).

## Path-resolution rules that bite

- Repo tooling (`validate-manifests.mjs`) resolves `repoRoot = script/..` then
  `payloadRoot = repoRoot/oats-package`; manifests + capability/config resources
  validate against the PAYLOAD root and the symlink-containment boundary is the
  payload root, but schemas are read from `repoRoot/schemas`. It is fine for
  repo-only tooling to know its payload dir name; runtime package CONTENT must
  never hardcode it (resource paths are payload-relative).
- Standalone tests: `REPO = test/..`, `ROOT = REPO/oats-package`. Read payload
  from ROOT, read schemas/scripts/test-fixtures from REPO. Negative manifest
  fixtures must mirror the `oats-package/` layout (write the synthetic manifest to
  `fixture/oats-package/oats-package.json`, schemas+scripts at fixture root).
- Co-located local dependencies point at sibling PAYLOAD roots. From
  `packaging/oats-dev/oats-package/`, the sibling okf payload is
  `../../oats-okf/oats-package` (up out of oats-package/, up out of oats-dev/, into
  the sibling repo's oats-package/). A deterministic catalog-selector script reads
  each sibling's own release version for the publication swap.

## Consumer-probe evidence (real engine, no shim)

`oats install path:<repo>/oats-package` and `oats install file://<repo>[#oats-package]`
both acquire; installed artifact = payload only; v2 lock records `path="."` for a
local exact dir and `path="oats-package"` for git/default, each with sha256
integrity. `file://<repo>#.` (repo root) fails `invalid-package-manifest` because
there is no oats-package.json at the root — proving the repo root is NOT a package
root. Packages above the running kernel floor fail-closed `incompatible-oats`
(release-pending), never silently.

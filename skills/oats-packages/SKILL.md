---
name: oats-packages
description: >-
  Use when someone asks how OATS packages are acquired, trusted, locked,
  updated or removed, or about the classic installed store, lock v1/v2 or
  package migration. In the workspace model a package is declared in
  oats-workspace.yaml and `oats sync` fetches and locks it; there is no
  installed store. For the full procedure load oats-package-pins (oats.setup).
---

# Packages in the workspace model

A **package** is a capability distribution: the `oats-package/` directory of a
repository, with an `oats-package.json` listing its capabilities. Packages are
the only versioned things in a workspace. Nothing is installed: each spawn
copies the capabilities a soul selects into that instance's home. The classic
`install`, `restore`, `list`, `catalog`, `remove` and `migrate` verbs, and a
bare `trust <id>`, answer `E_UNKNOWN_COMMAND` with their replacement. Contract:
`docs/packages.md` in the installed kernel (`"$(oats root)/docs/"`).

## Declare, sync, lock

```yaml
# oats-workspace.yaml, in the workspace's host repository
packages:
  oats.okf: v2.1.5                                   # bare version: resolved through the official catalog
  acme.tools: git:github.com/acme/tools@v0.4.0       # outside the catalog: git:<repo>@<tag or full commit>
```

```bash
oats package add <id> <version|git:<repo>@<ref>>    # edits packages: when the host repo is the current checkout; else prints the line
oats package remove <id>
oats sync                                           # resolve, fetch, verify integrity, write oats-lock.json
```

- **Declaring a package is the trust decision.** Its commands and hooks run at
  spawn on every machine that uses it, so review them before adding the pin.
- A pin names a version, a tag or a full commit; a reference that resolves to a
  branch is refused.
- `oats-lock.json` (lockfileVersion 3) pins each package's commit and
  integrity. A moved tag or drifted content is `E_PACKAGE_INTEGRITY`; a new
  version needs a new version string. Never edit the lock by hand.
- A soul selects a package capability with `{ from: package }`; the version is
  never in the soul.

## Where the old concepts went

| Classic concept | Workspace model |
|---|---|
| installed store under `.agents/capabilities/` | none; modules are copied per instance at spawn |
| lock v1 / v2 | lock v3, written only by `oats sync` |
| per-capability trust | declaring the package in `packages:` |
| config templates adopted from a package | none; souls and defaults are declared in the workspace |
| migrating a deployment | a rebuild (`docs/rebuild-to-v2.md`; the oats.setup capability's oats-rebuild skill) |

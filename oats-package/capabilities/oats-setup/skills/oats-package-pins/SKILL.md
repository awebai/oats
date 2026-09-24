---
name: oats-package-pins
description: >-
  Use when adding, bumping or removing a package in a workspace, choosing
  between a catalog version and a git reference, reading or approving the lock,
  or diagnosing a package that will not resolve or a spawn refused for an
  unapproved package. Member capabilities need no approval; this skill is only
  about packages.
---

# Packages, pins and approval

Packages are the only versioned things in a workspace. A package is a
capability distribution read from `oats-package/` in its repository, pinned
**once** in the workspace file's `packages:`; souls say `{ from: package }`
and never a version. Contract: `docs/workspaces.md` ("Packages, lock,
approval, catalog") and `docs/packages.md` in the installed kernel
(`"$(oats root)/docs/"`).

## Two forms of pin

```yaml
packages:
  oats.okf: v2.1.4                                    # bare version: resolved through the official catalog
  acme.tools: git:github.com/acme/tools@v0.4.0        # outside the catalog: git:<repo>@<tag or full commit>
```

- A **bare version** works only for ids in the official catalog
  (`package-catalog.json` in the OATS repository — the reviewed marketplace).
- A **git reference** names a tag or a full commit. A reference that resolves
  to a branch is refused: versions must not move. A tag that moved fails
  integrity on the next sync and asks again.
- A repository can be a workspace member **and** publish a package; the two
  never collapse. `from: package` reads only the lock; `from: <repo>` reads
  only that member's `capabilities/`. Never "fix" a package by pointing a soul
  at the publisher's repository.

## Change a pin

The workspace file is shared through Git, so a pin change is a reviewed
change to the host repository:

```bash
oats package add <id> <version|git:<repo>@<ref>>   # edits packages: when the host repo is the current checkout; else prints the line
oats package remove <id>
```

Commit, open the pull request, and after it merges run `oats sync` on each
deployment. A bump affects only new spawns; running instances keep what they
were given (`oats status` shows them as moved).

## Sync, lock and approval

```bash
oats sync                                        # resolve every pin to a commit + integrity, write oats-lock.json
oats sync --json                                 # approvalNeeded[] lists id, version, commit, executables
oats sync --approve <id>@<version>               # approve exactly that locked entry, no terminal needed
```

- On a terminal, `oats sync` shows each package's executables (commands and
  hooks) and asks per version. Show them to the operator; approval is theirs.
- `--approve` names the id and the version **as the lock records it**
  (`approvalNeeded[].version`; for a git pin by commit, that is the full
  commit id). The digest is always computed over the fetched tree, never
  typed. Pass one flag per package; an id or version the resolution does not
  contain is an error.
- Declining, end-of-input at the prompt, or a non-terminal run leaves the entry
  unapproved: exit code 2, and spawns of souls that use it are refused until
  it is approved.
- The approval is re-verified at spawn: the executables at the locked commit
  must still match what was approved.
- Never edit `oats-lock.json` by hand; it is written by `oats sync` only and
  is identical on every machine that synced the same workspace commit.

## Diagnose

| Symptom | Meaning |
|---|---|
| the package id is not in the catalog | use `git:<repo>@<ref>` or add it to the catalog through review |
| the pin resolves to a branch | pin a tag or a full commit |
| a soul's spawn is refused, package missing | the lock lacks a provider of that capability — run `oats sync` |
| a soul's spawn is refused, package unapproved | approve it (above) |
| a capability exists only inside a member's package | it is package-tier: `{ from: package }` plus a pin |

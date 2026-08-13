---
name: oats-packages
description: >-
  How to acquire, lock, restore, trust, update, remove, and migrate OATS
  distribution packages with the oats CLI. Use for package sources (git/local/
  official catalog), oats-lock.json v2, all-or-nothing scope migration, exact restore,
  per-capability executable trust, runtime dependency closures, or package
  doctor failures. Triggers: "install a package", "oats install", "oats list",
  "oats update", "oats remove", "oats migrate", "oats trust", "lockfileVersion",
  "integrity drift", "package won't restore".
---

# OATS distribution packages

A **package** is the install/update/review unit: one git repo (or local dir)
with an `oats-package.json` exporting one or more **capabilities** (the
activation unit) and optional config templates. Acquiring a package activates
NOTHING — activation stays in `oats-config.yaml` (see the oats-config skill).
Never hand-edit `oats-lock.json` or the stores; every operation below is a CLI
command, and all of them take `--json` (one stdout envelope, stable error
codes) and `--dir <scope>`.

## Sources

```
oats install git:github.com/org/repo@v1.0.0    # git shorthand (ref optional; resolved once, exact-locked)
oats install https://host/org/repo.git@v1.0.0  # raw HTTPS/SSH git URL
oats install ../my-package                     # local path (dev escape hatch)
oats install <catalog-id>                      # official catalog short id (identity only — no auto-trust)
```

### Which directory in the repo is the package?

A git repository CONTAINS a package; it is not one. The package root is the
directory carrying `oats-package.json`, and a git source selects it with a
`#<path>` fragment after any `@ref`:

```
oats install git:github.com/org/repo@v1.0.0            # → repo's oats-package/   (the DEFAULT)
oats install git:github.com/org/repo@v1.0.0#dist/oats   # → repo's dist/oats/
oats install git:github.com/org/repo@v1.0.0#.          # → the repository ROOT
```

- **Omit it and you get `oats-package/`.** Every official example, scaffold and
  convention uses `oats-package/` — never a generic `package/`. A repo whose
  manifest sits at the root needs `#.`; the error message says so.
- **Only the selected subtree is installed and hashed.** Repository docs, CI
  config, owner souls and sibling packages never become installed bytes and
  never affect `integrity` — so editing them cannot invalidate approvals, and
  editing the payload (including a nested capability-agent soul) always does.
- **One repo can ship several packages** at different paths; install each by
  its own source. Two contained roots claiming the SAME package identity still
  fail with `duplicate-package-identity`.
- **Catalog ids take no fragment** — the catalog entry carries `path` itself.
- **Local paths take no fragment either**: `oats install /repo/custom-root`
  treats that exact directory as the package root whatever it is named. There
  is no `oats-package` default for local sources.

The lock records the selected root in its own `path` field, in canonical form
(`.` for a root selection). A bare `oats install` restores the locked
source + commit + **path** + integrity even if upstream moved the directory or
the catalog repointed; only `oats update <package>` may adopt a new path, and it
reports the move. Attempting to move it with a plain `oats install` is refused
with `integrity-drift`.

Local capability development is untouched by all of this:
`.agents/capabilities/owned/<id>` (`from: owned`) and `from: path:<dir>` are
not package sources and are never routed through package paths.

Installing a package MATERIALIZES each capability it exports into
`<scope>/.agents/capabilities/installed/<id>/` (gitignored). There is no
persistent package store. Dependencies declared in `oats-package.json` must be
pinnable (official selector, tag/commit, or path). The whole closure is
exact-locked in the scope's `oats-lock.json` (`lockfileVersion: 2`), which
records two maps: `packages` (source, exact commit, selected path, payload
integrity, dependencies) and `capabilities` (each artifact's version, provider
package, path, integrity, trust).

## Everyday operations

```
oats install                    # bare: EXACT restore of this chain's locks (never advances refs)
oats list [--json]              # packages, exported capabilities, scopes, trust state
oats update <package>           # transactional: temp fetch, closure validation, diff,
                               # artifact+lock replaced together; approvals of every
                               # CHANGED-integrity package are invalidated (unchanged
                               # packages in the closure keep theirs)
oats remove <package>           # refuses while config or dependent packages reference it
```

## Trust

Executable surfaces (commands/hooks) are blocked until approved at each
capability artifact's EXACT integrity:

```
oats trust <capability>                     # approve only that capability
oats trust <package> --all-capabilities     # explicit bulk; prints the full executable surface first
```

Any artifact integrity change (update, drift) resets that capability's trust —
re-review, then re-trust. Skill/instruction/config-only capabilities need lock
integrity but no approval. Official-catalog identity is NOT executable trust.

## Runtime dependencies

A capability may check in `package.json` + `package-lock.json`; OATS materializes
it with `npm ci --omit=dev --omit=peer --ignore-scripts` — production tree only,
no lifecycle scripts. The package payload hash EXCLUDES `node_modules`. The
materialized `node_modules` is instead part of that capability's own artifact
integrity, so tampering with materialized deps resets the capability's trust
just like source drift, and restore re-verifies it. Closures must be
platform-invariant. Host peer APIs are reached only through the supported
runtime boundary, never auto-installed.

## Migration from v1 locks

```
oats migrate --dry-run          # plan: which v1 capability locks map to packages
oats migrate                    # convert this scope to revised v2 — all-or-nothing
```

`oats migrate` is all-or-nothing per scope. It converts a scope to the revised v2
lock only when EVERY entry maps to a package. If any entry cannot be mapped yet
(a marketplace id the catalog does not resolve, an unknown source), the whole
scope stays byte-identical v1 and keeps working — re-run when it can map. A
successful run writes a fresh v2 lock for the scope. There is NO residue
container: a converted lock never carries leftover v1 entries. Approvals never
carry over — re-trust after migrating.

### Upgrading a 0.18 deployment (bundled official capabilities → packages)

```
oats migrate --official --recursive --dry-run --dir <team-root>   # plan every scope
oats migrate --official --recursive --dir <team-root>             # apply, scope by scope
```

Guided mode for existing users. It plans every visible lock-owning scope first
(ancestor chain incl. outer/laptop locks, team boundary, pruned descendants;
path order, ancestors first), then applies each scope transactionally.

- Which package supplies a legacy capability is CATALOG data: identity by
  default, plus aliases (`oats.review` → package `oats.dev`). Never a hardcoded
  URL or tag, and no ref is guessed from the v1 capability version.
- Config files are never rewritten — exported ids are unchanged, so activation,
  layers, targets, settings and exclusions stay valid.
- No mapping yet at a scope → that scope is HELD and left byte-identical v1
  (nonzero exit, `--dry-run` included); legacy capabilities keep working. A
  converting scope moves whole to revised v2 — there is no residue container, so
  a converted lock never carries leftover v1 entries.
- `git:`/`path:`/unknown entries are never acquired by guided mode. A scope
  containing only those entries is skipped with their IDs under `retained`; a
  scope mixing them with official capabilities is blocked whole and stays v1.
  Plain `oats migrate` can convert custom sources only when every entry maps.
- After it runs: `oats trust <capability> --dir <scope>` for each executable
  surface it names (approvals never transfer), then `oats install --dir <scope>`
  — already-installed host requirements verify, nothing is reinstalled.
- `--json` emits one envelope; an aggregate failure is `ok:false` with
  `error.code = E_MIGRATE_FAILED` and the complete per-scope report (including
  the scopes that DID migrate) under `error.details`.

`oats doctor` detects the upgradeable state and prints the exact command
(`officialMigration` in `--json`), or says migration is not available yet while
confirming the legacy capabilities remain supported.

## Troubleshooting

`oats doctor [dir] [--json]` distinguishes: missing locked package (run
`oats install`), integrity drift (reacquire/update explicitly — approvals are
already invalid), a capability whose `.oats-installation.json` disagrees with
the lock, untrusted executable surface (`oats trust <capability>`), and a legacy
v1 lock pending migration (`legacyLockFiles[]` plus `officialMigration`
readiness). A refused lock — including the superseded transitional v2 shape —
is reported as the single `lockError` diagnosis and is never partially
interpreted.

Source of truth beyond this skill: `oats --help` output,
`docs/oats-package.schema.json`, `docs/oats-lock.schema.json`, and
`docs/design/package-engine-contract.md` (+ `package-runtime-api.md`) in the
framework repo; `docs/capabilities.md` for the user-level walkthrough.

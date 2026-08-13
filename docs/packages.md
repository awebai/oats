# Distribution packages — capabilities, config templates, and host requirements

An **OATS distribution package** is the acquire, update, and review unit above
capabilities. It is *transport*, not the installed entity. A package is one
`oats-package.json` at a package root that declares one or more **capabilities**
and, optionally, one or more reference **config templates**.

Acquisition stages the package in a temporary transaction directory, validates
the whole selected payload, **materializes each declared capability** into
`.agents/capabilities/installed/<id>/`, writes the exact lock, and discards the
staging directory. There is no persistent package store. The engine side
(acquisition, materialization, lock, per-capability trust) has its own contract
in [`design/package-engine-contract.md`](design/package-engine-contract.md);
this document covers the config side — adopting templates, whole-workspace
reconciliation, and consented host-requirement installs.

A Git repository **contains** a package rather than being one. Which directory
holds it is part of the source contract:

```bash
oats install git:github.com/org/repo@v1.0.0            # → repo's oats-package/  (the DEFAULT)
oats install git:github.com/org/repo@v1.0.0#dist/oats   # → repo's dist/oats/
oats install git:github.com/org/repo@v1.0.0#.          # → the repository ROOT
oats install /repo/custom-root                         # local: that EXACT directory
```

Official examples, scaffolds, and conventions use `oats-package/`. Catalog
entries carry their own `path`. Local paths take no fragment and never apply the
default. Only the selected subtree is installed and hashed, so repository docs,
CI configuration, owner souls, and sibling packages stay outside the package's
payload and integrity. One repository may ship several packages at different
paths. The lock pins the selected root in its own `path` field, and only an
explicit `oats update <package>` may move it. See
[`design/package-engine-contract.md` §1.1](design/package-engine-contract.md).

Ground truth for the contract: [`oats-package.schema.json`](oats-package.schema.json),
[`oats-lock.schema.json`](oats-lock.schema.json), and
[`design/package-engine-contract.md`](design/package-engine-contract.md).

## Package is transport; capability is the installed entity

Installing a package materializes **every** capability it exports. Each installed
capability is a self-contained, independently hashable directory at
`.agents/capabilities/installed/<capability-id>/`, containing that capability's
own `oats.json`, skills, injections, commands, hooks, and any runtime closure.
That directory is where you inspect installed behavior, and it is the only thing
executable trust binds to.

Every package must export at least one capability. Config-only and empty
packages are rejected. A capability ID is unique at a scope, so two packages may
not both supply the same capability there.

```text
<scope>/
  oats-config.yaml                                # zero or one active config
  oats-lock.json                                  # committed provenance
  .agents/
    capabilities/
      owned/<capability-id>/                     # authored source; committed
      installed/<capability-id>/                 # materialized artifact; gitignored
    config-templates/
      adopted/<package-id>/<template-name>/
        oats-config.yaml                          # the exact adopted base; commit-safe
        adoption.json                            # source/version/commit/path/hash
```

At a Git-backed scope, OATS keeps `.agents/capabilities/.gitignore` ignoring only
`installed/`. Authored `owned/` capabilities and everything under
`.agents/config-templates/adopted/` are meant to be reviewed and committed, so
they are never ignored. Non-Git scopes use the same layout without pretending
Git owns their durability.

## Package config templates (`oats init --package`)

A **config template** is a complete reference `oats-config.yaml` a package ships,
named in `oats-package.json` under `configTemplates`. It is a recommended
starting point, not installed policy. Adopting one is explicit and always
separate from installing capabilities:

```bash
oats init --package example.engineering                 # official catalog id (latest)
oats init --package example.engineering@1.2.0           # catalog id + pinned selector
oats init --package ../engineering-oats --config minimal # local path + named template
oats init --package https://example.invalid/pkg.git     # git URL (default branch)
```

`oats install <package>` never adopts a template — it materializes capabilities
and reports available templates as optional follow-ups. Only `oats init --package`
(and the guided `oats config adopt`) adopt one.

New packages ship templates under a `config-templates/` directory and name them
with the manifest's `configTemplates` map. Each package must also give every
capability a dedicated self-contained root. The legacy `configs` manifest
spelling and a `.` (package-root) capability root stay readable only so
already-published tags remain consumable — new authoring never emits them.

Behavior:

- **Preview and validation first.** The template must be valid against the
  config schema. Every `from: installed` capability it references must be
  supplied by the package or its dependency closure. Layer bindings must agree
  with the capability manifests. Agent types must be syntactically valid. No
  path — injection overrides, work-mode setup scripts — may escape the target
  scope. A failing template is never written, and the scope is left untouched.
- **Default selection.** A template marked `"default": true` is chosen when
  `--config` is omitted. A single template is chosen implicitly. Several
  unmarked templates require `--config <name>`, and refusing to guess is the
  point.
- **Overwrite refusal.** `oats init --package` refuses when an `oats-config.yaml`
  already exists at the scope. Use `oats config adopt` to switch an existing
  scope to another template.
- **The adopted base is recorded.** Adoption writes the exact template as a
  commit-safe base under `.agents/config-templates/adopted/<package>/<template>/`,
  alongside an `adoption.json` recording source, version, commit, path, and hash.
  Commit it — `oats config diff` and `oats config sync` compare against it. For a
  local `path:` source, `adoption.json` records `source: null` with
  `localSource: true`, so no absolute machine path leaks into the committed
  metadata; the exact source stays only in the authoritative lock.

### Your config is yours (adopter sovereignty)

The adopted config is an **ordinary scoped config**. It is not live inheritance
and not ambient package policy. `oats use`, `oats type`, `oats inject eject`, and
hand edits keep their meaning, and package updates never rewrite it or the
adopted base. Every capability an installed package exports stays individually
addressable, so you may

- **retarget** a capability from global to an agent type or soul
  (`oats use example.review --type reviewers`);
- **disable** something the template enabled
  (`oats use example.review --global --disable`, or `knowledge: none` for a
  layer);
- **re-set settings** per family (`oats use example.review --soul dev
  --settings depth=high`);
- **replace** an exclusive-layer provider with another capability; and
- **override from a nested repository** — a closer repo's `oats-config.yaml`
  wins per the normal cascade:

  ```yaml
  # member-repo/oats-config.yaml — this repo opts out of the workspace default
  name: member
  capabilities:
    layers:
      knowledge: none
  ```

Nothing a package ships is mandatory. Every copied setting is fully locally
editable, and the resolved local config is always authoritative.

### Guided template sync (`oats config diff | sync | adopt`)

Your config and a package's template drift as you edit locally and as the
package updates. Three commands manage that, and all three share one three-way
comparison — the recorded **adopted base**, your current local
`oats-config.yaml`, and the selected template read from the currently locked
package.

```bash
oats config diff                          # report only; nothing is written
oats config sync                          # apply upstream changes; keep local edits
oats config sync --accept <id>=local      # resolve one conflict region in favor of local
oats config sync --accept <id>=package    # resolve one conflict region in favor of the template
oats config sync --reset --yes            # discard local changes; take the template verbatim
oats config adopt other.package --config default   # switch to a different base
```

- **`oats config diff`** reports how your config, the adopted base, and the
  package's current template differ. It classifies each region as
  upstream-only, local-only, or a conflict, and writes nothing.
- **`oats config sync`** applies upstream-only changes and keeps local-only
  edits. It presents the complete plan before touching anything, preserves the
  untouched bytes, comments, order, and formatting of your file, and advances
  the adopted base only after a successful write. A recoverable `.bak` backup
  survives the run.
- **Conflicts require an explicit choice.** A region changed both locally and
  upstream is a conflict. `oats config sync` never picks a side for you.
  Interactively it prompts per region. Noninteractively (or with `--json`) it
  fails with `E_SYNC_AMBIGUOUS` unless you pass `--accept <regionId>=local` or
  `--accept <regionId>=package` for each one.
- **`oats config sync --reset`** is the exact-template replacement path. It
  previews every local change region it will discard, backs up the current
  config, then replaces both the config and the adopted-base metadata. It
  demands strong confirmation interactively, and `--yes` to accept the loss
  noninteractively.
- **`oats config adopt <package> --config <name>`** switches the one local config
  to a different base. It rebases your config against the new template rather
  than creating a second config, and exactly one adopted base remains afterward.

## Workspace reconciliation (bare `oats install`)

At a config scope that declares `team:`, bare `oats install` reconciles the whole
workspace instead of only the ancestor chain:

1. prints the chosen boundary **before any network or host work**;
2. restores the boundary scope's locked graph;
3. discovers descendant scopes containing `oats-config.yaml` or `oats-lock.json`,
   in deterministic path order, pruning `.git`, generated stores (`.agents/`),
   dependency/vendor directories (`node_modules`, `vendor`, virtualenvs), agent
   instances/worktrees, `local-agents/`, and **nested team boundaries** (each is
   its own reconciliation unit);
4. restores each descendant scope once;
5. validates that every config-referenced installed capability is supplied by a
   visible locked package (or capability lock); and
6. aggregates missing requirements and failures **by scope**.

At a non-team scope, bare `oats install` keeps current-chain behavior. Pass
`--recursive` to request descendant reconciliation outside a team boundary — the
boundary is still printed first. OATS never scans downward from the laptop/home
config by default.

## Host requirements — a separate consent gate

A capability `requires` entry may declare structured, platform-aware install
methods (the legacy `install: "https://…"` docs URL still works):

```json
{
  "command": "example-cli",
  "why": "send and receive team messages",
  "install": {
    "docs": "https://example.invalid/install",
    "methods": [
      { "platform": "darwin", "manager": "npm-global", "package": "@example/cli@1.2.3" }
    ]
  }
}
```

Rules (all enforced):

- **Allowlisted managers only**: `npm-global` and `brew`
  (download-with-checksum is declared but not implemented yet). Recipes are
  data — argv arrays, never shell snippets, no sudo, no shell metacharacters, no
  authentication.
- **Informed, per-requirement consent.** Interactive `oats install` shows the
  exact command, source, version, and whether it changes user- or machine-level
  state, then asks per requirement. A plan may take more than one command — a
  runtime package can need its source registered first — so both the human and
  `--json` renderings carry `steps`, the ordered argv sequence that will run,
  alongside `argv` (its final command). What you consent to is the whole
  sequence. Nothing runs that the plan did not show.
- **Aggregation is scoped**: only capabilities *activated somewhere in the
  reconciled scopes* are considered, deduplicated by required command, and the
  report names which capabilities requested each command.
- **Noninteractive runs never install by default.** Automation names each
  accepted requirement: `oats install --accept-requirement example-cli`.
  `--no-requirements` restores packages only (CI). A **consented** install that
  fails (manager error, or the command still absent from PATH) makes
  `oats install` exit nonzero so automation can detect it. Unaccepted or skipped
  requirements stay non-fatal.
- **PATH verification** runs after each install. A tool that does not land on
  PATH is reported honestly.
- **Skipping is safe**: `oats doctor` keeps an actionable warning (the consent
  command to run) until the command is on PATH.
- **Trust and requirement consent are distinct gates.** Installing a binary
  neither activates nor approves any capability, and capability trust never
  authorizes host installs.

When no safe recipe matches the host, OATS prints the documented install URL.

## Lock, trust, and restore

The scope's `oats-lock.json` uses `lockfileVersion: 2` and records both levels of
the model in separate top-level maps:

```json
{
  "lockfileVersion": 2,
  "packages": {
    "example.engineering": {
      "source": "git:https://example.invalid/engineering.git@v3.0.0",
      "version": "3.0.0",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "path": "oats-package",
      "integrity": "sha256-…",
      "dependencies": []
    }
  },
  "capabilities": {
    "example.review": {
      "version": "2.1.0",
      "package": "example.engineering",
      "path": "capabilities/example-review",
      "integrity": "sha256-…",
      "trusted": false
    }
  }
}
```

- The `packages` map proves **where the bytes came from** — exact source,
  commit, selected root path, payload integrity, and package-identity
  dependencies. It does not describe an installed directory, because there is no
  persistent package store.
- The `capabilities` map proves **each materialized artifact** — its version,
  its provider package (a key of the `packages` map), its dedicated root path
  inside that package, its artifact integrity, and its executable trust.
- **Trust binds to the capability artifact integrity, never to package
  identity.** `oats trust <capability>` approves that capability's commands and
  hooks at exactly its current artifact integrity. Any integrity change,
  including `oats update`, resets `trusted` to false and forces re-review.
  Official catalog identity grants no executable trust, and there is no
  package-level approval.
- Bare `oats install` fetches the exact locked source, verifies package
  integrity, re-materializes any missing capability artifact, verifies its
  individual integrity, and never advances source, version, or commit.

## Upgrading a 0.18 deployment to the official packages

Deployments created before official packages existed hold ordinary
`oats-config.yaml` files, **v1** `oats-lock.json` files, and acquired capability
artifacts under `.agents/capabilities/installed/`. Those keep working. A valid
v1 lock still restores, activates, trusts, and spawns, and installing this
release migrates nothing on its own.

The upgrade is one explicit, guided command, and it lands directly in the
revised `lockfileVersion: 2`:

```bash
oats migrate --official --recursive --dry-run --dir <team-root>   # plan first
oats migrate --official --recursive --dir <team-root>             # apply
```

- **Scope discovery** is deterministic and covers every *visible* lock-owning
  scope: the explicit scope's ancestor chain (so an outer repo/laptop lock the
  deployment actually reads is migrated too), the team boundary, and descendant
  config/lock scopes found with reconciliation's pruning (nested team boundaries
  stay self-owned). Scopes are planned and applied in path order, ancestors
  first. Without `--recursive` only the named scope is migrated.
- **Plan first, always.** The complete per-scope plan is printed (and available
  as stable JSON) before anything is applied. `--dry-run` stops after it.
- **Which package supplies which capability is catalog data**, never code. The
  catalog maps identity by default (capability `oats.okf` → package `oats.okf`)
  and carries explicit aliases for capabilities a package exports under another
  identity (`oats.review` → package `oats.dev`). See the catalog shape below.
- **Config files are not rewritten.** Packages export the same capability IDs,
  so activation, layer bindings, targets, settings, exclusions, and injection
  overrides remain valid byte-for-byte.
- **Held, never half-converted.** If any official capability cannot map, the
  whole scope stays byte-identical v1 and the run is nonzero. A `--dry-run`
  reports the same blocked status, so readiness cannot be mistaken for success.
- **Custom entries block a mixed guided scope.** `git:`/`path:`/unknown v1
  sources are never acquired by `--official`. A scope containing only those
  entries is skipped and reports their IDs under `retained`; a scope mixing them
  with official capabilities is refused before any write. Plain `oats migrate`
  can convert custom sources only when every entry in the scope maps to a
  package. There is no residue container.
- **One package, several capabilities.** When catalog aliases map more than one
  legacy capability onto the same package, all of them convert together and the
  package is acquired once.
- **Per scope transactional.** Each scope acquires its package closure, writes
  a fresh revised v2 lock, and only then removes the superseded v1 artifacts. A
  failing scope is rolled back byte-identically. Other scopes keep their
  (truthfully reported) result, and the aggregate exit is nonzero.
- **Trust is re-earned, never transferred.** A capability's materialized
  integrity is not its v1 artifact's integrity, so approvals do not carry over.
  The run prints the exact `oats trust <capability> --dir <scope>` commands, then
  the bare `oats install --dir <scope>` pass (already-installed host requirements
  verify and are not reinstalled; anything missing gets its
  `oats install --accept-requirement <cmd>` consent command).

Rerunning the command after a successful migration changes nothing.

### The transitional v2 lock is not migrated

An earlier, unreleased shape of `lockfileVersion: 2` stored capability lists and
trust on the package rows and used a persistent `.agents/packages/installed/`
store. That transitional shape receives no product migration path. The reader
rejects it centrally as `invalid-lock` with actionable guidance. It is recreated
by a fresh acquisition, never converted or partially interpreted. There is no
`lockfileVersion: 3`. Because the transitional contract had no external
adoption, the founder chose to replace it in place rather than carry a migration
for it.

### Catalog shape

The official catalog is data (`package-catalog.json`, or the file named by
`OATS_PACKAGE_CATALOG`):

```json
{
  "packages": {
    "oats.okf": { "url": "https://github.com/awebai/oats-okf.git", "ref": "v1.4.1", "path": "oats-package" },
    "oats.dev": { "url": "https://github.com/awebai/oats-dev.git", "ref": "v1.0.0", "path": "oats-package" }
  },
  "capabilities": { "oats.review": "oats.dev" }
}
```

`packages` is identity and discovery only — resolving through it never advances
a lock and never grants executable trust. The released kernel bundles the
official awebai entries. Once a short id appears there, `oats install <id>`
prefers the distribution package over the legacy bundled capability marketplace.
Existing v1 locks and artifacts remain supported until you run guided migration.
`capabilities` is the legacy-capability → package alias map the guided migration
reads; identity mappings need no entry. An alias value may also be spelled
`{ "package": "<id>" }`.

## Doctor

`oats doctor` reports, in addition to its capability diagnostics:

- **Distribution packages** visible in the lock (`packages:` in
  `oats-lock.json`), with source and the capabilities each supplies;
- **adopted config templates** in the chain — the package and template each
  scope adopted, its recorded base, and whether local changes have drifted from
  it;
- **available-but-unadopted templates** — a locked, installed package exporting
  config templates that no scope has adopted;
- **missing host commands** for active capabilities, with the exact consent
  command when a safe installer exists;
- **official capability migration** (`officialMigration` in `--json`) when the
  chain still holds legacy `marketplace:` locks: each capability with the
  package that supplies it, and either `ready` with the exact
  `oats migrate --official --recursive --dir <boundary>` command, or `unavailable`
  with the reason — the catalog has no mapping yet and the legacy capabilities
  remain supported.

## Engine integration

The package engine (acquisition, capability materialization, revised v2 lock,
exact restore, capability indexing, per-capability trust — see
[`design/package-engine-contract.md`](design/package-engine-contract.md) and
[`design/package-runtime-api.md`](design/package-runtime-api.md)) is merged.
`oats init --package` acquires and exact-locks the full closure through the
engine's `acquirePackage` for every source kind (git, catalog, local path), then
adopts exactly one template. The team-boundary reconciliation above wraps the
engine's exact-restore primitive (integrity, capability, and runtime-closure
verification) per scope. Legacy v1 capability locks keep restoring via the
capability path and are reported as LEGACY with the `oats migrate` pointer.

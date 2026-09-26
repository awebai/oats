# Packages — the versioned tier

A **package** is a place to fetch capabilities from *with a version attached*.
It is one of the two kinds of capability source in the
[workspace model](workspaces.md); the other — a member repo — is never
versioned. Nothing is installed: a package is resolved to an exact commit by
`oats sync`, recorded in `oats-lock.json`, and **copied whole into each instance at spawn** (`<home>/.oats/modules/<cap>/`).

Ground truth: [`oats-package.schema.json`](oats-package.schema.json) (the
package manifest), the [lock v3 format](#lock-v3) below (`validateLock` in
`lib/packages.mjs` is its authority; it has no JSON schema), and the module contract
[design/2026-09-23-workspace-module-contracts.md §4](design/2026-09-23-workspace-module-contracts.md).

## What a package is

A Git repository **contains** a package at `oats-package/`:

```
<repo>/
└── oats-package/
    ├── oats-package.json                # { "package": "acme.tools", "version": "0.4.0", "capabilities": ["capabilities/acme-lint", "capabilities/acme-deploy"] }
    └── capabilities/
        ├── acme-lint/oats.json          # ordinary capability manifests (docs/capabilities.md)
        └── acme-deploy/
            ├── oats.json
            └── bin/acme-deploy.mjs      # an executable — trusted by declaring the package
```

`oats-package.json` must declare `package` and `capabilities` (a list of
directories relative to the package root, each holding an `oats.json`). It may
also declare `souls` (0.28.0): soul directories the package ships, see
[Package souls](#package-souls). A
directory entry need not equal the capability's name
(`capabilities/oats-okf` → capability `oats.okf`). A package declaring one
capability name twice, a listed directory without a manifest, or a manifest
without `capability` is `E_PACKAGE_MANIFEST`. Catalog entries may name another
`path` than `oats-package`; a `git:` ref always reads `oats-package/`.

## Declaring packages — two forms, in one place

The workspace file's `packages:` map is the **only** list of versions in the
whole organisation:

```yaml
packages:
  oats.framework: v1.1.3                              # bare version → the official catalog
  oats.okf: v2.1.3
  acme.tools: git:github.com/acme/tools@v0.4.0        # direct ref: git:<repo>@<tag or full OID>
```

- **Bare version** (`v2.1.3`, `2.1.3`, `1.0.0-rc.1`): the id is looked up in
  the official catalog — `package-catalog.json` in the `oats` repo, or the file
  named by `OATS_PACKAGE_CATALOG` — which supplies the repo url, the tag
  convention (`v2.1.3` or `oats-framework/v1.1.3`) and the payload path. An id
  the catalog does not know is `E_PACKAGE_MISSING` ("use `git:<repo>@<ref>` for
  a package outside the catalog"). The catalog is the reviewed official list
  ([official-catalog.md](official-catalog.md)) and the only way a
  package becomes pinnable *by id*.
- **`git:<repo>@<ref>`**: `<repo>` is any repo ref the kernel understands
  (`github.com/org/repo`, `https://…`, `git@host:…`, `/abs/bare.git`,
  `file:///…`); `<ref>` is a tag name or a full 40-hex commit. The package is
  read at `oats-package/`.

A whole workspace file pinning the current official packages — its bare
versions are kept equal to `package-catalog.json` by
`test/docs-catalog-pins.test.mjs`, so a catalog pin round updates this example
in the same change:

<!-- catalog-pins -->
```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/agents
  - git:github.com/acme/platform
packages:
  oats.framework: v1.3.0
  oats.okf: v4.0.0
  oats.aweb: v1.15.0
teams:
  global: { description: Org-wide }
  engineering: { description: Platform }
defaults:
  capabilities: { oats.core: { from: package } }
  knowledge: { oats.okf: { from: package } }
  messaging: { oats.aweb: { from: package } }
  tasks: none
stores:
  org: git:github.com/acme/knowledge
messaging:
  private: per-human
```

There is no third form; `lib/packages.mjs#classifyPackageValue` is the one
grammar, used by workspace validation and by `sync`. A `<ref>` (or catalog ref)
that resolves to a **branch** is refused: `E_PACKAGE_INTEGRITY { why: "branch" }`
— versions are immutable.

Souls never name versions. A soul says `acme-deploy: { from: package }`; which
package provides `acme-deploy`, and at which version, is the workspace's
decision recorded in the lock.

## `oats sync` — the one command for the common path

```
$ oats sync
workspace  acme  (github.com/acme/agents @ 3f2a9c1e)
members    agents ✓↔ (@ 3f2a9c1e)   platform ✓↔ (@ 77c0a1b2)   tools ✓↔ (@ 47f4b816)   billing ✗ (no-backlink)
packages   acme.tools 0.4.0 ✓ (@ 47f4b816)   oats.framework 1.1.3 ✓ (@ 9c3e27aa)   oats.okf 2.1.3 ✓ (@ b2e16f2e)
changed    acme.tools  — → 0.4.0 (@ 47f4b816)
souls      7 discovered (6 members, 1 external, 0 disabled here) · 0 private capabilities
teams      engineering 4 souls, 3 capabilities · global 2 souls, 2 capabilities · unassigned 1 soul

lock       oats-lock.json
```

`sync` (run from the deployment — where `oats-local.yaml` is, or `--dir`):

1. discovers the workspace over the remotes and confirms every member;
2. resolves each `packages:` entry to a commit (`observeRemote`), reads its
   manifests, computes the **integrity** (content digest of the package tree)
   and records `url`, `path`, `version`, `commit`, `integrity`, `capabilities`;
3. for an entry already locked at the same version/source/path: the commit must
   be unchanged (else `E_PACKAGE_INTEGRITY` — "the tag moved; a version string
   must change when its content does") and the integrity must match
   (`E_PACKAGE_INTEGRITY`);
4. writes `oats-lock.json` and reports the diff. Entries dropped from
   `packages:` are dropped from the lock.

There is **no approval step** (human decision, 2026-09-24): declaring a package
in the workspace's `packages:` is the trust decision, so `sync` asks nothing,
exits `0` on success, and `--approve` is `E_BAD_ARGS`. `--json` emits the
`syncApi: 1` envelope documented in
[desktop-cli-api.md](desktop-cli-api.md#workspace-model-workspaceapi-2).

## `oats package add | remove`

```bash
oats package add oats.aweb v1.11.2                         # a catalog version
oats package add acme.tools git:github.com/acme/tools@v0.4.0
oats package remove acme.tools
```

Both edit `packages:` in `oats-workspace.yaml` **when the file is tracked by
the Git checkout the command runs in** (the workspace host repo); the edit is
validated against the full workspace schema before it is written, and the
receipt tells you to commit and `oats sync`. Anywhere else — a deployment folder,
a member clone — the command prints the line to add (`--json`: `edited: false`,
`line`) because the workspace file is shared through Git, not through this
machine. Nothing network-bound happens in `package add`; `sync` resolves.

## Lock v3

`oats-lock.json` lives beside `oats-local.yaml`. Two operators who synced the
same workspace commit hold identical locks.

```json
{
  "lockfileVersion": 3,
  "packages": {
    "oats.okf": {
      "source": "catalog:oats.okf",
      "url": "https://github.com/awebai/oats-okf.git",
      "path": "oats-package",
      "version": "2.1.3",
      "commit": "b2e16f2ea1555be519db76fda30cd0bea06f8609",
      "integrity": "sha256-1c34dbe9c1cc3826dbe6ecbafbd9a1e189ed36a74bfb2ba8fb6f46a382e95c2d",
      "capabilities": ["oats.okf"]
    },
    "acme.tools": {
      "source": "git:github.com/acme/tools@v0.4.0",
      "url": "https://github.com/acme/tools.git",
      "path": "oats-package",
      "version": "0.4.0",
      "commit": "47f4b81660e4cc9701d373088de52462762585a3",
      "integrity": "sha256-4cd126a7…",
      "capabilities": ["acme-deploy", "acme-lint"],
      "souls": [{ "name": "release-reviewer", "path": "souls/release-reviewer", "digest": "sha256-9a0f…" }]
    }
  }
}
```

| field | meaning |
|---|---|
| `source` | `catalog:<id>` or `git:<repo key>@<ref>` — how the workspace asked for it |
| `url` | the repo url the package was read from; travels in the lock so spawn needs no catalog |
| `path` | the package root inside the repo |
| `version` | the version string without a leading `v` (a `git:…@<OID>` pin records the OID) |
| `commit` | full 40-hex OID the version resolved to |
| `integrity` | `sha256-<hex>` content digest of the package tree at `path` |
| `capabilities` | the capability names the package provides (sorted) — what `from: package` looks up |
| `souls` | the package souls (0.28.0), sorted by name: `name`, `path` (inside the package) and `digest` (`sha256-<hex>` of the soul directory); absent when the package ships none |

A capability provided by **two** locked packages is ambiguous and fails
closed (`E_PACKAGE_MISSING { ambiguous: [ids] }`): keep one of them in
`packages:`. A lock that is not v3 (a 0.24 lock, an unreadable file) is
`E_LOCK_SCHEMA`; it is never auto-repaired — delete it and `oats sync`. A v3
lock written before 0.26.0 may carry an `approved` record per entry: it is read
with the field ignored, and the next write drops it. The reverse does not hold:
a kernel before 0.26.0 refuses a lock 0.26.0 wrote (`E_LOCK_SCHEMA "approved:
must be null or { executables, at }"`) — keep every kernel that reads one
deployment on 0.26.0 or later. Agents never hand-edit the lock.

## Trust

Member capabilities are trusted by membership; **a package is trusted by its
declaration in the workspace's `packages:`** (human decision, 2026-09-24) —
people install a package only when they trust it, so there is no second,
per-version approval step. The lock is reproducibility, not approval: it pins
the exact commit and the content integrity, a moved tag or drifted content is
`E_PACKAGE_INTEGRITY`, and at spawn the lock's capability list must match what
the package declares at the locked commit (`E_PACKAGE_INTEGRITY { why:
"capabilities" }`).

## Materialization from a package

At spawn a `from: package` module is fetched at the lock's commit from the
lock's `url`, at the manifest-listed directory (`oats-package.json#capabilities[]`
entry), into `<home>/.oats/modules/<cap>/`; the copy's digest is verified
against what the fetch reported; skills are copied to
`<home>/.agents/skills/<cap>/<skill>/`. `instance.json.modules.<cap>.from` is
`{ kind: "package", package, version, commit, integrity, repoKey }`. Bumping
`packages:` and syncing affects **only new spawns**; `oats status` shows a
running instance's package module as `moved` once the lock points elsewhere.

## Package souls

A package may ship **souls** as well as capabilities (0.28.0). One pin in
`packages:` then versions both: nothing drifts, unlike an `external:` soul's
commit pin.

```
oats-package/
├── oats-package.json      # { …, "capabilities": ["capabilities/acme-review"], "souls": ["souls/release-reviewer"] }
├── capabilities/acme-review/oats.json
└── souls/release-reviewer/
    ├── soul.yaml          # an ordinary soul: name = the directory's name
    ├── AGENTS.md
    └── skills/…
```

- **Locked.** `oats sync` records each soul's `name`, `path` and `digest` in
  the lock entry. A soul without `soul.yaml` or `AGENTS.md`, or whose
  directory is not a soul name, is `E_PACKAGE_MANIFEST`. On a later sync at
  the same version the souls must still match (`E_PACKAGE_INTEGRITY { why:
  "souls" }`); a lock written before 0.28.0 has its `souls` filled in.
- **Listed.** `oats souls` lists a package soul with `kind: "package"`,
  `package`, `version`, `qualifiedName` and `origin: "package <id>
  v<version>"`; `oats sync` / `oats workspace status` list each package's
  `souls`. Only packages the workspace still declares are listed.
- **Named.** The qualified name is `<package>/<soul>` (`oats.okf/knowledge-maintainer`).
  A bare name works when it is unique across member, external and package
  souls; otherwise `E_SOUL_AMBIGUOUS` names each qualified form
  (`details.qualified`). A member soul's qualified form is `<member name>/<soul>`.
- **Resolved** like any soul: the workspace and team defaults apply, `off` and
  `<slot>: none` work, every `team:` label must be declared (`E_TEAM_UNKNOWN`
  in discovery), and `from: here` means **this package** at the locked commit
  (a capability it does not provide is `E_CAPABILITY_MISSING`).
- **Spawned** at the locked commit: the soul is fetched into the per-commit
  soul cache and its digest must equal the lock's (`E_PACKAGE_INTEGRITY
  { why: "soul-digest" }`). A package soul homes in its own agent directory,
  `agents/<package>--<soul>/` (the package id with `.` as `-`:
  `agents/oats-okf--knowledge-maintainer/`), which is also its agent name
  (`OATS_AGENT`, the `oats status` row); its instances are named from it
  (`oats-okf-knowledge-maintainer-<purpose>`). That prefix counts toward the
  64-character instance-name limit, so a package soul's purposes are short:
  `oats-okf-knowledge-maintainer-` is 30 characters, which leaves 34 for the
  purpose (fewer when a `-2` suffix de-duplicates it). A longer one is
  `E_INSTANCE_NAME_INVALID { prefix, purpose, maxPurpose }`, naming the budget;
  a trigger's or schedule's purpose template obeys the same limit when it
  renders. A soul name never holds `--`,
  so a member soul of the same bare name keeps its own `agents/<soul>/`.
  Two packages whose ids sanitise alike (`a.b`, `a-b`) and that ship a
  same-named soul would share a directory: both are listed with an
  `E_SOUL_AMBIGUOUS` problem, and spawning either is `E_SOUL_AMBIGUOUS
  { agentDir, qualified }` — keep one of the packages.
  `instance.json.workspace.soul` records `name`, `qualifiedName`, `package:
  { id, version, commit, digest, path }` and the soul id `package:<id>#<soul>`;
  in `oats status` the soul is `moved` once the package pin moves.
- **Disabled** by `oats-local.yaml` `souls.disabled` by its qualified or bare
  name (`E_SOUL_DISABLED` at spawn).
- **Trusted** as the package's capabilities are: declaring the package is the
  trust decision.

## Trigger templates

A package may also ship **trigger templates** (0.28.0): `triggers: [{ id,
file }]` in `oats-package.json`, each file `{ parameters, definition }`.
`oats trigger add --from <package>:<id> --set <name>=<value>` instantiates one
at the locked commit; see [schedules.md#triggers](schedules.md#triggers).

## Compatibility floors

A soul may state floors on package versions — constraints, not sources:

```yaml
compatibility:
  oats.okf: ">=2.1"
```

Checked at resolution against the locked version (`E_COMPATIBILITY`,
naming capability, package, version and range). A package pinned by OID has no
version to check (`why: "unversioned"`): pin a tagged version.

Separately, each capability's own `compatibility.oats` (its manifest's kernel
range) must admit the running kernel, for package and member capabilities
alike (`E_CAPABILITY_INCOMPATIBLE`); see [capabilities.md](capabilities.md).

## Publishing a package from a member repo

A repo can be a **member** of the workspace **and** publish a package; the two
roles never collapse (see [workspaces.md](workspaces.md#member-tier-vs-package-tier-the-non-collapse-rule)):

1. Put the package under `oats-package/` with its `oats-package.json` and
   capability directories. Everything under `capabilities/` at the repo root
   stays member-tier (latest state, for people working *on* the package —
   typically a `<name>-dev` capability); everything under `oats-package/` is
   package-tier.
2. Add a member soul that is the expert in the package (`souls/<name>-expert/`),
   ordinary and discoverable, the natural owner of the package's PRs. It eats
   its own published food: `acme-lint: { from: package }` at the pinned version,
   plus `acme-tools-dev: { from: here }`.
3. Tag a release (`v0.4.0`). Tags are immutable: a new content needs a new tag.
4. Consumers pin it: `oats package add acme.tools git:github.com/acme/tools@v0.4.0`
   → commit → `oats sync`. Discovery shows the member row with
   `publishes: { package: "acme.tools", version: "0.4.0" }`.
5. To become pinnable by id, open a PR adding the package to
   `package-catalog.json` in the `oats` repo ([official-catalog.md](official-catalog.md)).

A soul that names one of the package's capabilities with
`from: github.com/acme/tools` fails: `E_CAPABILITY_MISSING` with the hint
`provided by package acme.tools; use from: package`.

## Catalog shape

```json
{
  "policy": "docs/official-catalog.md",
  "packages": {
    "oats.okf":       { "url": "https://github.com/awebai/oats-okf.git", "ref": "v2.1.3", "path": "oats-package" },
    "oats.framework": { "url": "https://github.com/awebai/oats.git", "ref": "oats-framework/v1.1.3", "path": "oats-package" }
  }
}
```

`ref` carries the tag convention: a workspace's `oats.framework: v1.3.0`
resolves to tag `oats-framework/v1.3.0`. Resolving through the catalog never
advances a lock by itself — `oats sync` does, and
says so.

## Removed verbs

`oats install`, `restore`, `init`, `use`, `trust`, `list`, `catalog`, `remove`,
`migrate`, `config` are gone; each answers `E_UNKNOWN_COMMAND` naming its
replacement (`details.removed` / `details.replacement` in `--json`). There is
no installed-capability directory, no config template adoption, no host
requirement installer. A manifest's `requires` still describes what must exist
on the host (harness packages are verified at spawn; host commands are the
operator's to install).

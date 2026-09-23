# Packages — the versioned tier

A **package** is a place to fetch capabilities from *with a version attached*.
It is one of the two kinds of capability source in the
[workspace model](workspaces.md); the other — a member repo — is never
versioned. Nothing is installed: a package is resolved to an exact commit by
`oats sync`, recorded in `oats-lock.json`, approved once per version, and
**copied whole into each instance at spawn** (`<home>/.oats/modules/<cap>/`).

Ground truth: [`oats-package.schema.json`](oats-package.schema.json) (the
package manifest), [`oats-lock-v3.schema.json`](oats-lock-v3.schema.json) (the
lock), and the module contract
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
            └── bin/acme-deploy.mjs      # an executable → approved once per version
```

`oats-package.json` must declare `package` and `capabilities` (a list of
directories relative to the package root, each holding an `oats.json`). A
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
  a package outside the catalog"). The catalog is the reviewed marketplace
  ([official-marketplace.md](official-marketplace.md)) and the only way a
  package becomes pinnable *by id*.
- **`git:<repo>@<ref>`**: `<repo>` is any repo ref the kernel understands
  (`github.com/org/repo`, `https://…`, `git@host:…`, `/abs/bare.git`,
  `file:///…`); `<ref>` is a tag name or a full 40-hex commit. The package is
  read at `oats-package/`.

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
packages   acme.tools 0.4.0 ✓ (approval needed)   oats.framework 1.1.3 ✓ (approved)   oats.okf 2.1.3 ✓ (approved)
changed    acme.tools  — → 0.4.0 (@ 47f4b816)
souls      7 discovered (6 members, 1 external, 0 disabled here) · 1 private (platform-reviewer, platform only)
teams      engineering 4 souls, 3 capabilities · global 2 souls, 2 capabilities · unassigned 1 soul

acme.tools 0.4.0 @ 47f4b816 needs executable approval (2 executables, digest sha256-7923…):
  acme-deploy: command apply → bin/acme-deploy.mjs
  acme-deploy: command plan → bin/acme-deploy.mjs
approve acme.tools 0.4.0? [y/N]
```

`sync` (run from the deployment — where `oats-local.yaml` is, or `--dir`):

1. discovers the workspace over the remotes and confirms every member;
2. resolves each `packages:` entry to a commit (`observeRemote`), reads its
   manifests, computes the **integrity** (content digest of the package tree)
   and records `url`, `path`, `version`, `commit`, `integrity`, `capabilities`;
3. for an entry already locked at the same version/source/path: the commit must
   be unchanged (else `E_PACKAGE_INTEGRITY` — "the tag moved; a version string
   must change when its content does"), the integrity must match, and a
   recorded approval must still describe the package's executables (else
   `E_PACKAGE_UNAPPROVED` — approve again);
4. for every unapproved entry, prints the exact executables (every `commands.*`
   target and every `hooks.*.command` target of every capability manifest —
   hooks run unattended at spawn/retire) and asks **once** on a terminal;
5. writes `oats-lock.json` and reports the diff. Entries dropped from
   `packages:` are dropped from the lock.

Exit status `2` means the lock is written but approvals are pending
(non-interactive, or declined). Spawns of souls using an unapproved package are
refused (`E_PACKAGE_UNAPPROVED`) until `oats sync` is run in a terminal and the
approval given. `--json` emits the `syncApi: 1` envelope documented in
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
same workspace commit and approved the same versions hold identical locks.

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
      "capabilities": ["oats.okf"],
      "approved": { "executables": "sha256-0d7615fa…", "at": "2026-09-24T09:02:11.000Z" }
    },
    "acme.tools": {
      "source": "git:github.com/acme/tools@v0.4.0",
      "url": "https://github.com/acme/tools.git",
      "path": "oats-package",
      "version": "0.4.0",
      "commit": "47f4b81660e4cc9701d373088de52462762585a3",
      "integrity": "sha256-4cd126a7…",
      "capabilities": ["acme-deploy", "acme-lint"],
      "approved": null
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
| `approved` | `{ executables: "sha256-<hex>", at }` — the digest of the approved executables — or `null` |

A capability provided by **two** locked packages is ambiguous and fails
closed (`E_PACKAGE_MISSING { ambiguous: [ids] }`): keep one of them in
`packages:`. A lock that is not v3 (a 0.24 lock, an unreadable file) is
`E_LOCK_SCHEMA`; it is never auto-repaired — delete it and `oats sync`. Agents
never hand-edit the lock.

## Approval

Member capabilities are trusted by membership; **package executables are
approved once per version**, and every instance that materializes that version
inherits the approval. What is approved is a digest over the bytes of every
executable a manifest can make the kernel run — `commands.*` targets and
`hooks.*.command` targets — in canonical order; a hook object without
`command` is `E_PACKAGE_MANIFEST`, never an invisible no-op. Skills, injects
and other files are covered by `integrity`, not by the approval.

The approval lives next to the commit it approved. A new version starts
unapproved; a moved tag fails integrity and asks again; an approval whose digest
no longer matches the tree is refused. `oats spawn` re-checks `approved` on the
way to `from: package`: reaching materialization means approved.

## Materialization from a package

At spawn a `from: package` module is fetched at the lock's commit from the
lock's `url`, at the manifest-listed directory (`oats-package.json#capabilities[]`
entry), into `<home>/.oats/modules/<cap>/`; the copy's digest is verified
against what the fetch reported; skills are copied to
`<home>/.agents/skills/<cap>/<skill>/`. `instance.json.modules.<cap>.from` is
`{ kind: "package", package, version, commit, integrity, repoKey }`. Bumping
`packages:` and syncing affects **only new spawns**; `oats status` shows a
running instance's package module as `moved` once the lock points elsewhere.

## Compatibility floors

A soul may state floors on package versions — constraints, not sources:

```yaml
compatibility:
  oats.okf: ">=2.1"
```

Checked at resolution against the locked version (`E_COMPATIBILITY`,
naming capability, package, version and range). A package pinned by OID has no
version to check (`why: "unversioned"`): pin a tagged version.

## Publishing a package from a member repo

A repo can be a **member** of the workspace **and** publish a package; the two
roles never collapse (see [workspaces.md](workspaces.md#member-tier-vs-package-tier--the-non-collapse-rule)):

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
   → commit → `oats sync` → approve once. Discovery shows the member row with
   `publishes: { package: "acme.tools", version: "0.4.0" }`.
5. To become pinnable by id, open a PR adding the package to
   `package-catalog.json` in the `oats` repo ([official-marketplace.md](official-marketplace.md)).

A soul that names one of the package's capabilities with
`from: github.com/acme/tools` fails: `E_CAPABILITY_MISSING` with the hint
`provided by package acme.tools; use from: package`.

## Catalog shape

```json
{
  "policy": "docs/official-marketplace.md",
  "packages": {
    "oats.okf":       { "url": "https://github.com/awebai/oats-okf.git", "ref": "v2.1.3", "path": "oats-package" },
    "oats.framework": { "url": "https://github.com/awebai/oats.git", "ref": "oats-framework/v1.1.3", "path": "oats-package" }
  }
}
```

`ref` carries the tag convention: a workspace's `oats.framework: v1.2.0`
resolves to tag `oats-framework/v1.2.0`. Resolving through the catalog never
grants approval and never advances a lock by itself — `oats sync` does, and
says so.

## Removed verbs

`oats install`, `restore`, `init`, `use`, `trust`, `list`, `catalog`, `remove`,
`migrate`, `config` are gone; each answers `E_UNKNOWN_COMMAND` naming its
replacement (`details.removed` / `details.replacement` in `--json`). There is
no installed-capability directory, no config template adoption, no host
requirement installer. A manifest's `requires` still describes what must exist
on the host (runtime packages are verified at spawn; host commands are the
operator's to install). See [rebuild-to-v2.md](rebuild-to-v2.md).

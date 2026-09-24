# Workspace model — module contracts (the spec the implementation is built against)

**Status:** normative for implementation · **Decision:** `agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md` · **Example:** [2026-09-23-simplified-workspace-model.md](2026-09-23-simplified-workspace-model.md) · **Plan:** [2026-09-23-workspace-v2-implementation-plan.md](2026-09-23-workspace-v2-implementation-plan.md)

These are the canonical kernel modules. There is no `lib/v2/`. Each module below replaces the v1 code named under *Supersedes*; when a phase lands, the superseded module is deleted and its tests rewritten. All modules: ESM, Node ≥ 22, no new runtime dependencies beyond `yaml` (already present) and `node:*`. Errors are `oatsError(code, message, details?)` from `lib/errors.mjs` with the codes listed here — stable, machine-readable, never raw stderr.

Conventions: every path returned is absolute and normalized; every commit is a full 40-hex OID; every digest is `sha256-<hex>`; `at` timestamps are ISO-8601 UTC; functions are synchronous unless marked `async`; nothing shells out except `lib/remote.mjs` (to `git`) and the launch path.

---

## 1. `lib/remote.mjs` — observe Git remotes in the operator's access context

Supersedes: `repository-observation.mjs` (v1 parts), `source-spec.mjs`.

```js
export function parseRepoRef(text)
// "git:github.com/org/repo" | "git:github.com/org/repo.git" | "https://github.com/org/repo(.git)" | "git@github.com:org/repo.git"
// → { host: "github.com", path: "org/repo", url: "https://github.com/org/repo.git", key: "github.com/org/repo" } | throws E_REPO_REF
// key is the canonical identity used everywhere else ("<host>/<path>", lowercase host, no .git).

export async function observeRemote(ref, { at } = {})
// at: undefined → the remote's default branch (git ls-remote --symref HEAD); or a full OID; or a tag/branch name.
// → { key, url, commit, ref: "<resolved symbolic ref or null>", observedAt }
// throws E_REMOTE_UNREADABLE { url, reason: "auth"|"not-found"|"network"|"timeout" } — NEVER half-succeeds; NEVER prompts.

export async function readRemoteFile(ref, commit, path)
// → { bytes: Buffer, size } | throws E_REMOTE_UNREADABLE | E_REMOTE_PATH_MISSING { path }
// Bounded: size > 4 MiB → E_REMOTE_FILE_OVERSIZE { path, size, budget }.

export async function listRemoteTree(ref, commit, dir, { depth = 2 } = {})
// → [{ path, type: "blob"|"tree"|"symlink", size? }] relative to dir, depth-bounded; missing dir → [];
// submodule gitlinks are omitted. Unsafe entry names → E_REMOTE_TREE_UNSAFE { why: "path" } (see below).

export async function fetchRemoteTree(ref, commit, dir, destDir)
// Copies the subtree at <dir> of <commit> into destDir (created; must not exist, not even as a dangling symlink).
// Regular files and dirs only; everything is inspected BEFORE any write:
//   symlinks / submodules / odd modes → E_REMOTE_TREE_UNSAFE { path, why: "symlink"|"device" }; total > 64 MiB → "oversize";
//   an entry-name component that is "", ".", "..", ".git" (any case) or contains "\"/NUL → why: "path";
//   two entries equal under NFC+case folding (README.md/readme.md, NFC/NFD) → why: "collision".
// → { files, bytes, digest }  digest = sha256 over (relpath, git-normalized mode "755"|"644", size, bytes) in
//   byte-wise relpath order — the "content hash" (umask-independent: a checkout digests like the fetched tree).

export function contentDigest(dir)
// Same digest computation over a local directory (used by materialize to verify a copy); a top-level `.git/` is ignored.
```

Every module that takes a remote accepts `{ remote, remoteOptions }`: `remote` defaults to this module,
`remoteOptions` (`cacheDir`, `exec`, …) is threaded into every remote call (tests never touch `~/.cache`).
`observeRemote`'s `at` is a full OID or a plain ref name (no `-` prefix, no `^{}`/`~`/`:` revision syntax,
no globs) → else `E_REPO_REF`; the resolved object MUST be a commit (a tag/OID naming a tree or blob →
`E_REMOTE_UNREADABLE not-found`). Operations on one cache repo are serialized in-process; a fetch that
loses an on-disk `.lock` race is retried; a pinned commit whose objects were wiped is refetched, never
reported from the stale pin. ssh runs in BatchMode ALWAYS — `-o BatchMode=yes` is appended to the
operator's `GIT_SSH_COMMAND`/`core.sshCommand` (or to `ssh`).

Implementation: `git ls-remote`, shallow `git fetch --depth 1 --filter=blob:none` into a **content-addressed cache** under `os.homedir()/.cache/oats/remotes/<key-hash>/` (invisible plumbing; may be wiped at any time; never referenced by any other module). Uses the operator's own git configuration and credential helpers; sets `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/usr/bin/false` (or equivalent) so nothing ever prompts. Timeout 30 s per git call. Local paths (`file:///…` or an absolute path to a bare repo) are valid refs (`key: "local/<abs-path>"`) — this is how tests build remotes.

---

## 2. `lib/workspace.mjs` — declarations, membership, discovery

Supersedes: `workspace-definition.mjs`, `workspace-discovery.mjs`, `portable-*.mjs` (declaration parts), `capability-provenance.mjs` (v1), `config-data.mjs` activation parsing.

### Files (schemas in `docs/*.schema.json`, validated with the existing validator style)

`oats-workspace.yaml` (schemaVersion 2):
```yaml
schemaVersion: 2
name: <slug>
members: [<repo ref>, …]                    # no revisions permitted → E_WORKSPACE_SCHEMA
packages: { <package-id>: <version-or-ref> } # e.g. oats.okf: v2.1.3 ; oats.dev: git:github.com/x/y@<ref>
teams: { <label>: { description } }
defaults:
  capabilities: { <cap>: { from: <repo key|package> } }
  knowledge: { <cap>: { from } } | none      # one entry max per slot
  messaging: … | none
  tasks: … | none
  byTeam: { <label>: { capabilities: { <cap>: { from } | off } } }
stores: { <name>: <repo ref> }                # a REPOSITORY; the root inside it is the provider's (OKF `root`) — no `#path`
messaging: <opaque provider payload>         # may carry byTeam: { <label>: <payload> } — merged base ⊕ byTeam[soul.team], stripped
external: [ { source: <repo ref>@<full OID>, soul: <path> } ]   # revision REQUIRED
```
Schema refuses: absolute paths anywhere; `@revision` on members; unknown top-level keys.
*(clarified Phase B)* "Absolute paths" means bare filesystem paths as VALUES (`/Users/x/store`, `C:\…`) — host state that belongs in `oats-local.yaml`. A repo ref in `file:///…` or `git:/abs/bare.git@<ref>` form is a **repo ref** (§1 accepts it; it is how tests build remotes), not an absolute path, and is accepted wherever a repo ref is. The JSON schemas encode only what a JSON schema can (shapes, grammars); domain rules — declared teams, duplicate members, canonical `from:` keys, one form per `packages:` value — live in `validateWorkspace`/`validateSoul`, which are the authority; a consumer validating against the schema alone accepts a superset.
*(refined Phase C, decisions 23–25)* `messaging.byTeam.<label>` must name a label in `teams:` (`E_WORKSPACE_SCHEMA`). Standalone resolution (`standaloneRepo`) adds `oats.core: { from: package }` unless the soul says `off`; the package resolves through the operator's lock exactly as in a workspace (`E_PACKAGE_UNAPPROVED` until approved). `stores` values are repo refs only.

*(clarified Phase B)* A `from:` value is `package`, `here` (souls only — a workspace default has no referent for `here` → `E_WORKSPACE_SCHEMA`), or a **canonical** repo key exactly as `parseRepoRef(ref).key` spells it (lowercase host, no scheme, no `git:`, no `.git`; `local/<abs-path>` for file remotes). Any other spelling is a schema problem at validation, never a late `E_NOT_A_MEMBER`. `soul.yaml` requires `name`, `description` and `work`.

`oats-membership.yaml`: `{ schemaVersion: 2, workspace: <repo ref>, team?: <label> }` — nothing else.

`soul.yaml` (schemaVersion 2):
```yaml
schemaVersion: 2
name, description, work: worktree|checkout|directory|workspace
team?: <label>
private?: true
capabilities: { <cap>: { from: <repo key|here|package> } | off }
knowledge | messaging | tasks: <opaque provider payload> | none
compatibility?: { <cap>: <semver range> }
```
`capabilities/<name>/oats.json` — unchanged manifest; may carry `private: true` and `team: <label>`. Discovery
relies on `capability` (the `capabilityName` grammar `^[a-z0-9][a-z0-9._-]*$` — the same grammar every
`capabilities:` key uses, so a discoverable name is always referenceable; no `/`), `version`, `private`, `team`,
`layer`; a manifest failing that is a problem, not listed. Two souls or two capabilities declaring one name in
a repo: the first (by path) is listed, the second is a problem. `external[].team` overrides the soul's `team`.
`loadLocal` throws `E_WORKSPACE_SCHEMA` for an invalid `oats-local.yaml`.

`oats-local.yaml`: `{ schemaVersion: 2, workspace: <repo ref>, clones?: { <repo key>: <abs path> }, settings?: { <cap>: { <key>: <value> } }, souls?: { disabled: [<name>] } }`.

### API

```js
export function loadLocal(dir)                       // walks up from dir to find oats-local.yaml → { path, local } | E_LOCAL_MISSING
export async function observeWorkspace(ref, { at } = {})
// → { key, commit, workspace: <parsed+validated>, observedAt }   E_REMOTE_UNREADABLE | E_WORKSPACE_SCHEMA { path, problems[] }
// A repo without oats-workspace.yaml is E_WORKSPACE_SCHEMA (it is not a workspace host), never a leaked E_REMOTE_PATH_MISSING.

export async function confirmMembership(workspaceObs, memberRef)
// Reads the member's oats-membership.yaml at its default branch in the SAME access context.
// → { key, commit, confirmed: true, team } |
//   { key, confirmed: false, reason: "not-listed"|"no-backlink"|"backlink-elsewhere"|"cannot-read", detail }
// Never throws for an unconfirmed member (ANY E_REMOTE_* about the member's file — oversize, symlink, unsafe
// tree — is an unconfirmed row; an unparseable memberRef is "not-listed"); throws only on schema errors of the
// WORKSPACE file. Repo keys are case-sensitive in the path part; a backlink that differs only by case is
// "backlink-elsewhere" with `caseOnly: true` and a hint in `detail`.

export async function discoverWorkspace(ref, { at, local } = {})
// The whole picture, in one access context:
// → { workspace, members: [{ key, commit, confirmed, reason?, team, souls: [SoulEntry], capabilities: [CapEntry],
//                             publishes: { package, version } | null }],
//     external: [{ source, commit, soul: SoulEntry }], problems: [{ code, path, message }] }
// A remote failure on ONE member's directory listing is a problem of that member, never an abort.
// SoulEntry = { name, path, repoKey, commit, team, private, definition }   (definition = validated soul.yaml)
// CapEntry  = { name, path, repoKey, commit, team, private, manifest }
// Unconfirmed members contribute nothing but their row. `private` items are included with private:true (callers filter).
// Unknown team labels on items → problems[] E_TEAM_UNKNOWN (the item is still listed).

export function standaloneRepo(ref, commit, discovery?)
// For a readable member whose workspace cannot be read: souls with from:here capabilities only.
```

---

### Member vs package tier — the non-collapse rule (decisions 19–21)

A repository may be a **member** (it completed the handshake; its `souls/*` and `capabilities/*` are member-tier, latest state) **and** a **package publisher** (its `oats-package/` is consumed only through `packages:`, versioned, locked, approved). The two never collapse:

- `from: <repo key>` looks ONLY under `<repo>/capabilities/<name>/oats.json` at the member's latest state. It never looks inside `oats-package/`. A capability that exists only inside the repo's package → `E_CAPABILITY_MISSING` with `details.hint: "provided by package <id>; use from: package"`.
- `from: package` looks ONLY in the lock (`packageProviding`). It never looks at member capabilities, even when the package's repo is a member.
- `discoverWorkspace` lists a member's `oats-package/` presence as `publishes: { package, version }` on the member row (informational) and does NOT enumerate the package's capabilities as member capabilities.
- `packages:` values: a **bare version** (`v2.1.3`) resolves through the official catalog (`package-catalog.json` in the workspace's `catalog:` source, default the `oats` repo's); a **`git:<repo>@<ref>`** value is a direct package ref, where `<repo>` is any ref §1 understands — `github.com/org/repo`, `https://…`, `git@host:…`, `/abs/bare.git`, `file:///…` — and `<ref>` a tag name or full OID. Both are packages. There is no third form: `lib/packages.mjs#classifyPackageValue` is the one grammar, used by `validateWorkspace` and `resolvePackages`. A `<ref>` (or catalog ref) that resolves to a **branch** is refused (`E_PACKAGE_INTEGRITY { why: "branch" }`) — versions are immutable.

## 3. `lib/resolve.mjs` — from a soul to an immutable resolution

Supersedes: `resolution-shape.mjs`, `prepared-resources.mjs`, `prepare-composition.mjs` (declaration parts), the `capabilities.layers/additive` derivation in `core.mjs`.

```js
export function resolveSoul(discovery, soulEntry, { local, lock, spawn = {} })
// spawn = { providers?: { <cap>: { <k>: <v> } }, work?, model?, … }   (instance-level payload, decision 14)
// → Resolution (immutable, JSON-serializable):
// {
//   resolutionApi: 1,
//   soul: { name, repoKey, commit, team, path },
//   modules: [ { name, from: { kind: "member", repoKey, commit } | { kind: "package", package, version, commit, integrity },
//               manifest, layer: "knowledge"|"messaging"|"tasks"|null, private } ],
//   slots: { knowledge: <module name>|null, messaging, tasks },
//   payloads: { <cap>: <merged provider payload: soul ⊕ local.settings[cap] ⊕ spawn.providers[cap]> },
//   skills: [ { module, name, path } ],            // composed skill set; duplicates → E_SKILL_DUPLICATE { name, modules }
//   injects: [ { module, path } ],
//   revision: "<sha256 of the canonical JSON of everything above>[0:24]"
// }
// Order: workspace.defaults.capabilities ⊕ defaults.byTeam[soul.team] ⊕ soul.capabilities (soul wins; `off` removes).
// from:here → soul.repoKey. from:<repo> → must be a confirmed member (E_NOT_A_MEMBER) that has the capability
//   (E_CAPABILITY_MISSING), not private unless same repo (E_CAPABILITY_PRIVATE). from:package → lock.packages must
//   provide it (E_PACKAGE_MISSING) and be approved (E_PACKAGE_UNAPPROVED).
// Slots: a module with manifest.layer fills that slot; two → E_SLOT_CONFLICT; soul `none` empties; else workspace default.
// compatibility floors checked against package versions → E_COMPATIBILITY.
```

*(clarified Phase B)*
- **Membership gate.** `soulEntry` must be a soul discovery listed: a soul of a **confirmed** member row (same `repoKey`, `name`, `commit`), an `external[]` soul, or (standalone) the repo's own. A soul of an unconfirmed member → `E_MEMBERSHIP_UNCONFIRMED { repoKey, reason }`; a soul of a repo the workspace does not list → `E_NOT_A_MEMBER`; an entry the row does not carry (stale/fabricated) → `E_MEMBERSHIP_UNCONFIRMED { reason: "stale" }`. Resolve is the gate; it does not trust the caller.
- **Slot defaults.** `defaults.<slot>` must name a capability whose manifest declares `layer: <slot>`; no layer or another layer → `E_SLOT_CONFLICT { reason: "layer-mismatch" }`. Soul `<slot>: none` drops the workspace's `defaults.<slot>` only; a layered capability still arriving through `defaults.capabilities`/`byTeam`/the soul is a loud `E_SLOT_CONFLICT { reason: "none" }` (spell `<cap>: off` to remove it) — never a silent empty slot.
- **Payload keys.** A provider payload (soul, `workspace.messaging`, `local.settings`, `spawn.providers`) may not carry `__proto__`, `constructor` or `prototype` as a key at any depth → `E_WORKSPACE_SCHEMA { reason: "poison-key" }` (YAML/JSON produce them as own keys; merged, `__proto__` would set the prototype of the payload — invisible to the recorded JSON and the revision, visible to every reader).
- **Compatibility floors** need a version: a package pinned by OID (`git:<repo>@<OID>` records the OID as its version) or any non-version string → `E_COMPATIBILITY { why: "unversioned", capability, package, version, range }`; every `E_COMPATIBILITY` names `capability` and `package`.
- **Recorded for materialize** (extra fields, part of the revision): `module.dir` — the capability directory as the manifest lists it (repo-relative; a package's `oats-package.json#capabilities[]` entry, which need not equal the capability name), and `from.repoKey` on package modules. An in-memory `lock` is validated like one read from disk (`E_LOCK_SCHEMA`); `approved` must be a well-formed `{ executables: sha256-…, at }`, not merely truthy.

---

## 4. `lib/packages.mjs` — versions, lock v3, approval (rewritten in place)

Supersedes itself (v1: installed tier, `install/restore/use`, lock v2).

```js
export function readLock(dir) / writeLock(dir, lock)      // oats-lock.json lockfileVersion 3
// lock = { lockfileVersion: 3, packages: { <id>: { source: "catalog:<id>"|"git:<key>@<ref>", url, path, version, commit,
//          integrity, capabilities: [<cap names>], approved: { executables: "sha256-…", at } | null } } }
// (clarified Phase B) `url` is the repo url the package was read from (observeRemote's `url`): the package's repo
// identity travels in the lock, so resolveSoul/materialize of a catalog-locked package need no catalog at spawn time.

export async function resolvePackages(workspace, { catalog, lock })
// For each workspace.packages entry: catalog lookup or git ref → observeRemote → commit; read oats-package.json at
// path; enumerate its capability manifests; integrity = contentDigest of the package tree.
// → { lock: <updated>, changes: [{ id, from: <old version|null>, to: <version>, commit, approvalNeeded: bool }] }
// A locked entry whose (version → commit) changed → E_PACKAGE_INTEGRITY unless the version string also changed.
// An unchanged entry keeps its approval ONLY if executablesDigest(tree) still equals approved.executables
// (else E_PACKAGE_UNAPPROVED). A catalog `path` change at the same version is a new (unapproved) entry.
// `remote` defaults to lib/remote.mjs; `remoteOptions` is threaded through.

export function executablesDigest(packageTree)             // sha256 over every manifest's `commands` targets' AND
                                                            // `hooks.*.command` targets' bytes (hooks run unattended at
                                                            // spawn/retire), codepoint order, locale-independent
                                                            // (clarified Phase B) a hook object without `command` is
                                                            // E_PACKAGE_MANIFEST — never an invisible no-op
export function approve(lock, id, digest, at)              // records approval; returns new lock
export function packageProviding(lock, capName)            // → { id, entry } | null; two providers → E_PACKAGE_MISSING { ambiguous }
                                                            // (a package declaring one capability twice → E_PACKAGE_MANIFEST)
```

`oats-lock.json` is the only persisted state at the deployment besides `oats-local.yaml`.

---

## 5. `lib/materialize.mjs` — copy whole, compose, record

Supersedes: the module/skill assembly in `core.mjs` spawn (`prepared` copies, symlinked skill sets, ambient exclusion), `capability-artifacts.mjs`.

```js
export async function materialize(resolution, home, { fetch = fetchRemoteTree } = {})
// For each module: fetch its capability dir — the resolver-recorded module.dir (the manifest-listed directory: member
//   <repo>@<commit>/<dir>; package <pkg>@<commit>/<dir> where <dir> is the oats-package.json#capabilities[] entry, which
//   need not equal <name>: capabilities/oats-okf → oats.okf) (clarified Phase B) —
//   into <home>/.oats/modules/<name>/ ; verify contentDigest === module.digest (recorded); copy skills/* into
//   <home>/.agents/skills/<name>/<skill>/ (full copy, not symlink).
// Compose <home>/AGENTS.md = soul AGENTS.md + each module inject (existing kernel composer; marker comments unchanged).
// Keep aliases: CLAUDE.md → AGENTS.md ; .claude/skills → ../.agents/skills (relative symlinks, as today).
// Write instance.json.modules = { <name>: { from, commit, digest, materializedAt } } and instance.json.providers = resolution.payloads.
// → { modules: […], skills: […], agentsMd: <path> }   Any failure → nothing left behind (staging dir + rename).
// (clarified Phase B) The transaction includes the aliases and the AGENTS.md/instance.json swap: a failure at any
//   commit step rolls back everything placed and restores the previous files (E_MATERIALIZE_HOME { why }); the home's
//   shape (.oats, .agents, .claude and module targets: real directories or absent) is re-checked immediately before
//   the renames; staging is unique per call; two materializations racing on one home → E_MATERIALIZE_HOME { why: "busy" }.
// (clarified Phase B) The soul body is the LOCAL soul directory — options.soulAgentsMd / options.soulDir, else
//   <home>/soul/AGENTS.md through the instance's `soul` link into the member clone (decision 9: the work target is
//   the only thing that needs a clone). fetchRemoteTree is not a soul-copy primitive; a soul's CLAUDE.md → AGENTS.md
//   alias never crosses the remote.

export function driftOf(instanceJson, discovery)
// → [{ module, recorded: { repoKey, commit }, current: { commit } | null, status: "current"|"moved"|"missing" }]
```

Launch (in `core.mjs`, edited): the harness is started with cwd = home and **no** skill-exclusion arguments/profile keys; model/provider pinning is untouched.

---

## 6. CLI (in `bin/oats.mjs`, edited) and DTOs

- `oats sync [--dir]` — discover, confirm, resolve packages, ask approval (interactive) or list what needs it, write lock, report diff. `--json` → `{ syncApi: 1, workspace, members[], packages[], changes[], approvalNeeded[] }`.
- `oats package add <id> <version> | remove <id>` — edits `packages:` in the workspace file **when the workspace repo is the current checkout**; otherwise prints the line to add (the workspace file is shared through Git).
- `oats spawn <soul> …` — preview/apply unchanged in shape; the decision now embeds `resolution.revision`; `--provider <cap> k=v` (repeatable). Preview lists `modules[]` with `changedSince` (previous instance of the soul) and `team`.
- `oats capabilities` / `oats souls` — every non-private item of every confirmed member + packages, with `origin` (`member <key> @ <commit>` | `package <id> v<ver>`) and `team`. `--json`.
- `oats workspace status` — membership table (`confirmed` / `no-backlink` / `cannot-read` …), packages, approval state.
- `oats status` — per instance `modules` with `driftOf`.
- `oats version --json` — `workspaceApi: 2`, features `+workspace-v2`, `+instance-modules`, `+spawn-provider-payload`. Removed: `init`, `use`, `install`, `restore`.
  *(clarified Phase B)* A feature string is listed only once the binary implements it: `instance-modules` and `spawn-provider-payload` appear when `oats spawn` runs on resolve/materialize (Phase C), not before. A removed verb answers `E_UNKNOWN_COMMAND` naming its replacement in BOTH text and `--json` (`details.removed`/`replacement`), checked before capability dispatch. `oats status` without a deployment is `E_NO_DEPLOYMENT` in both modes.
  *(clarified Phase B)* `oats package add|remove` edits the file only when it is **tracked** by the checkout it sits in (`git ls-files`); an untracked copy gets "the line to add".

Errors introduced by this model (all `E_*`, all with `details`): `E_REPO_REF`, `E_REMOTE_UNREADABLE`, `E_REMOTE_PATH_MISSING`, `E_REMOTE_FILE_OVERSIZE`, `E_REMOTE_TREE_UNSAFE`, `E_WORKSPACE_SCHEMA`, `E_MEMBERSHIP_UNCONFIRMED`, `E_LOCAL_MISSING`, `E_TEAM_UNKNOWN`, `E_NOT_A_MEMBER`, `E_CAPABILITY_MISSING`, `E_CAPABILITY_PRIVATE`, `E_PACKAGE_MISSING`, `E_PACKAGE_MANIFEST` (a package's own files are malformed or missing), `E_PACKAGE_INTEGRITY`, `E_PACKAGE_UNAPPROVED`, `E_LOCK_SCHEMA` (oats-lock.json unreadable or not v3), `E_SLOT_CONFLICT`, `E_SKILL_DUPLICATE`, `E_COMPATIBILITY`; `E_REMOVED` is thrown by the phase-A shims for deleted v1 APIs.

---

## 7. Test fixture — `test/fixtures/northwind/build.mjs`

```js
export async function buildNorthwind(baseDir)
// Creates FIVE bare Git repos under baseDir/remotes/{agents,platform,data,marketing,knowledge}.git plus
// baseDir/remotes/experts.git (the external one) and TWO package repos baseDir/remotes/pkg-{okf,framework}.git
// with the exact contents of the worked example (three teams, private items, byTeam defaults, a package with an
// executable) PLUS baseDir/remotes/nw-tools.git: a MEMBER (oats-membership team engineering; soul tools-expert;
// member capability nw-tools-dev) that ALSO publishes package nw.tools under oats-package/ (capabilities nw-lint,
// nw-deploy with bin/, tag v0.4.0). The workspace file pins it as `nw.tools: git:<nw-tools ref>@v0.4.0`. Returns { refs: { agents: "<abs path>", … }, commits: { … }, catalog: <object mapping ids → {url, ref, path}> }.
// Deterministic (fixed author/date; hermetic git config incl. core.excludesFile/attributesFile) so digests are stable
// across runs and machines. A baseDir containing whitespace or "@" is refused (E_FIXTURE_BASEDIR: repo keys embed it).
// Also exports scenario helpers:
export async function moveMember(fixture, name, mutate)      // commits a change to a member's default branch
export async function dropBacklink(fixture, name)            // removes oats-membership.yaml (→ no-backlink)
export async function makeUnreadable(fixture, name)          // chmod 000 the bare repo (→ cannot-read)
```

Every module's tests use this fixture and only this fixture; no test invokes bare `oats setup` (standing rule).

---

## Clarifications — Phase C adversarial-review fix round (2026-09-23)

Appended, not edited in place; each item names the section it refines. Decision record: `workspace-model-v2.md` decisions 10, 23, 25.

**§2 `standaloneRepo` / `discoverOrStandalone` — standalone requires membership (M6/M7).** A standalone view is a **member** whose workspace cannot be read: the repo MUST carry an `oats-membership.yaml` (`discoverRepo(ref).membership` non-null). A repo with no backlink is not a workspace host and not a member → `E_WORKSPACE_SCHEMA` (the original "not a host" error is rethrown), never a standalone view. The fallback engages **only** when reading the host fails for **access** reasons — `E_REMOTE_UNREADABLE` with `reason: "auth"` (which is also how a permission denial classifies) | `"not-found"`; a `"network"` or `"timeout"` failure propagates unchanged (an offline operator is not a public contributor). The discovery it returns carries `standalone: true`, `workspace: null`, one member row (the repo's own, `confirmed: false, reason: "cannot-read"`) and `standaloneReason: { code, reason, url }` — the access failure that triggered it — so `sync`/`status`/`spawn` can report *why* the view is standalone. `oats-local.yaml` `standalone: <repo ref>` asks for the view explicitly (no host lookup); it too requires the repo to be a member.

**§2/§3 `oats.core` default (S4).** In the standalone view the kernel adds `oats.core: { from: package }` only when the soul's `capabilities:` says **nothing** about `oats.core`. Any mention — any `from:` (`package`, `here`, a repo key) or `off` — suppresses the default and the soul's own line is what resolves.

**§3 payload keys — `byTeam` is reserved (decision 23).** `byTeam` is legal ONLY at the top level of `workspace.messaging` (merged `base ⊕ byTeam[soul.team]`, then stripped). In every other payload layer — a soul's `knowledge:` / `messaging:` / `tasks:`, `oats-local.yaml` `settings.<cap>`, `spawn.providers[cap]` / `--provider` — at **any depth**, it is `E_WORKSPACE_SCHEMA { reason: "reserved-key", path, key: "byTeam" }`, alongside the existing `poison-key` rule. A provider never receives a `byTeam`.

**§5/§6 `instance.json.workspace.standalone`.** A prepared spawn writes `instance.json.workspace = { key, commit, resolution, standalone: <boolean>, soul: { repoKey, commit, team } }` next to `modules{}`, `providers{}` and `capabilities[]` (the `toCapabilityRows(resolution, home)` rows). `standalone` is `true` exactly when `prepared.discovery.standalone === true` (then `key` is the member repo's key); `false` on a workspace spawn. `oats sync --json` marks the same view `standalone: true` with `workspace.name = "standalone:<repo>"`; `oats status`/`workspace status` show it in their workspace field.

**§6 `oats onboard [<dir>] --workspace <repo ref> [--json]` → `onboardApi: 2` (M13).** The bootstrap (decision 9): writes `<dir>/oats-local.yaml` `{ schemaVersion: 2, workspace: <ref> }` and `<dir>/agents/`, then runs exactly the `sync` body (§6 `oats sync`) over that directory. Result `{ onboardApi: 2, local, dir, agents, lock, sync: <syncApi 1 report>, hosting: { host, hostIsMember, rule }, next: { clone: [{ key, name, url, dir }], spawn: "<setup-expert spawn command>" } }`; exit `2` with `ok: true` when `sync.approvalNeeded` is non-empty. `--workspace` is parsed (`E_REPO_REF`) before anything is written; a second onboard of the same directory is `E_ALREADY_ONBOARDED { local, dir }` (only THIS directory's file counts — an enclosing deployment is a different deployment); a failure before the workspace has been read (unreadable remote, not a host, package/lock errors of the first resolve) removes what onboarding created and carries `details.rolledBack: true, details.dir`; a failure after the read keeps the files (a lock may exist) and carries `details.dir, details.local`. Creates no soul, installs nothing, spawns nothing, writes no `oats-config.yaml`.

**§6 `oats package remove <id>` (M15).** BOTH branches — the file tracked by the checkout (edited) and untracked/absent (not edited) — answer `E_PACKAGE_MISSING { id, path? }` when `<id>` is not declared in `packages:`. The tracked receipt is `{ action: "remove", id, value: null, previous: <old value>, edited: true, file }`; the untracked receipt is `{ action: "remove", id, value: null, edited: false, file: null, line: null, hint }` — `previous` is absent and `line` is `null` (a removal has no line to add).

**§6 features.** `catalog` is no longer advertised in `oats version --json` `features` (the verb is removed; the official catalog is reached through `packages:` + `sync`, not a command).

## Post-0.25.0 clarifications (team review, 2026-09-23)

**Capability commands outside an instance home (`oats <ns> <cmd>` from the
deployment).** Inside an instance home the dispatcher resolves the namespace from
the home's materialized modules (`instance.json.modules` → `<home>/.oats/modules`);
that shipped in 0.25.0. Outside a home — the operator acts a knowledge layer needs
before any instance exists (`oats okf init`, base migration) — the intended rule
is: **resolve exactly as a spawn of `--soul <name>` would** (`prepareInstance` →
the soul's Resolution), fetch the namespace's capability into the deployment's
module store `<deployment>/.oats/modules/<cap>@<commit>/` (the same per-commit
store capability-defined agents use), and dispatch to that copy with the soul's
merged payload as `OATS_SETTINGS`. Never "the newest instance's copy" (an
instance is not an authority for the deployment) and never an unlocked cache
read (the lock's approval is the gate, as for spawn). `--soul` is required when
the namespace's capability is not a workspace default. **Status: 0.25.x
follow-up** — 0.25.0 still answers `E_CAPABILITY_INACTIVE` there (the pre-v2
chain); the interim is to run the module binary directly with `OATS_SETTINGS`
and `OATS_CLI_BIN`, as the tarball smoke does.

**`work: workspace` is kept.** A coordination soul's `./work` is the deployment
boundary — the directory holding `oats-local.yaml` (whatever the operator
named it, member clones beside it or named in `clones:`) — read-only across member
clones, no branch recorded. The clone map in `oats-local.yaml` (`clones:`) is
how such a soul finds a member whose clone is elsewhere. **Status: the
directory link is the intent; 0.25.0's kernel still derives the boundary from
the classic `team:` scope (`docs/souls-and-instances.md` open thread) — 0.25.x
follow-up binds it to the `oats-local.yaml` directory.**

**`identity.source` (oats.aweb) is the absolute path of the `.aw` directory to
retain**, given per spawn (`--provider oats.aweb identity.source=/abs/.aw`) or
per machine (`oats-local.yaml settings.oats.aweb.identity.source`); the kernel
resolves no symbolic seat names. Absolute paths never enter the workspace file
(decision 14).

**Member capabilities are a code-execution boundary** (decision 2: membership is
the trust; hooks and scripts of every member's default branch run on every
operator's machine at spawn). For a mixed public/private organisation the
recommendation is: **souls only in public members; executable capabilities come
from packages (approved per version) or from private members.** The onboarding
skill (Phase E) states this beside the hosting rule (decision 26).


### 0.25.1 fix round (team review, 2026-09-23) — appended, not edited in place

Each item names the section it refines and the review finding it closes. The
implementation lands in kernel 0.25.1 (`docs/release-notes/v0.25.1.md`); no
API integer or feature name changes.

**§3 slot `none` (L1).** A soul's `none` for a slot **empties the slot and drops
any layer-bearing capability the WORKSPACE DEFAULTS contributed for that
layer** — whether it arrived through `defaults.<slot>`, `defaults.capabilities`
or `defaults.byTeam[team].capabilities`. A layer-bearing capability **the soul
itself declares** in its own `capabilities:` alongside `none` for that layer is
`E_SLOT_CONFLICT { reason: "none" }` (spell `<cap>: off` to remove it). This
replaces the Phase B reading under which a layered default arriving via
`defaults.capabilities` was itself a conflict: the workspace's choice is a
default and `none` is the soul's answer to it; only the soul contradicting
itself is loud.

**§2/§5 per-commit soul cache (M1).** `ensureWorkspaceSoul` fetches a soul's
source at `(repoKey, commit)` into `<deployment>/agents/<name>/souls/<commit12>/`
— **immutable once written** (staged, then renamed in; never removed by the
kernel) — and maintains `<deployment>/agents/<name>/soul` as a **symlink to the
current commit's directory**, swapped atomically (symlink to a temp name +
rename over) so classic readers (`findAgent`, `doctor`, the classic spawn path)
keep seeing "current". A spawned home's `<home>/soul` links **its own commit's
directory** (the realpath of `souls/<commit12>/`), never the swapped pointer:
a running instance's soul never changes under it (decision 7), a `--preview`
may fetch a new commit and swap the pointer without touching any directory an
instance links, and OKF 2's owner pin (`owners.json` = `realpath(<home>/soul)`)
stays valid for the instance that registered it. `.oats-soul-source.json`
remains the stamp of "current". A 0.25.0 layout (`agents/<name>/soul` a real
directory, no `souls/`) is migrated in place on first use: the directory moves
to `souls/<commit from the stamp, else unknown>/` and the pointer replaces it.
A soul symlink whose target lies inside the same `agents/<name>/souls/` is the
one kernel-owned symlink soul readers accept.

**§1 transport (M2).** `parseRepoRef(ref).key` is unchanged — `<host>/<path>`
is the identity everywhere and every comparison is by key. The **fetch url
honours the form written**: `git@host:org/repo(.git)` and `ssh://…` fetch over
SSH as written; `https://…` fetches over HTTPS; the bare scheme
`git:host/org/repo` fetches over HTTPS by default **unless
`remoteOptions.transport === "ssh"`** (a per-machine choice; `oats-local.yaml`
may carry it once the schema admits it — reported by lane 3, not landed here).
The operator's SSH access is therefore used when the operator wrote an SSH ref,
and a private repo no longer degrades to `not-found` → standalone through an
unintended HTTPS probe. When the standalone fallback engages the discovery
carries `standaloneReason`/`hostFailure { code, reason, url }` so the CLI can
print *why*.

**§3/§4 approval re-verified at spawn (M3).** For a `from: package` module
`resolveSoul` recomputes `executablesDigest` over the package tree **at the
locked `entry.commit`** and requires equality with `entry.approved.executables`
→ else `E_PACKAGE_UNAPPROVED { reason: "digest-mismatch", approved, actual }`.
The one digest definition is `lib/packages.mjs#executablesDigestAt(remote, ref,
commit, path, capabilities)`, shared by `sync` and `resolve`; a hand-edited lock
(same id/version, different commit, copied approval) can no longer materialize
and run unapproved hooks. Cached per `(id, commit)` within a process.

**§1 peeled commit OIDs (M4).** `observeRemote(ref, { at })` accepts an
annotated tag's OID (or name) but **records the peeled commit** (`<oid>^{commit}`)
as `commit` — in its result, in the lock, in `fetchRemoteTree`'s errors and in
every `instance.json` record. A tag OID is never stored where a commit is
expected.

**§1 listing hygiene (L3, L4).** `listRemoteTree` filters by depth **before**
asserting entry-name safety, so one unsafe deep name does not blank a member's
souls (unsafe names at the kept depth are still `E_REMOTE_TREE_UNSAFE`). A git
child killed for `maxBuffer` (`ENOBUFS`) is not reported as `timeout`; an
unclassified listing failure is wrapped as `E_REMOTE_UNREADABLE { reason:
"unknown" }` so discovery records a problem row instead of aborting.

**§2 `validateWorkspace` absolute paths (L2).** The absolute-path refusal
applies to **ref/path fields only** — `members[]`, `packages` values, `stores`
values, `external[].source` / `external[].soul`, `defaults.*.from` — never to
`teams.<label>.description` or to the opaque `messaging` payload.

**§3 revision (L6).** `Resolution.revision = hash(declRevision, payloadRevision)`
where `declRevision` covers the declarations (member/package commits, the
composed capability set, skills, injects) and `payloadRevision` covers the
payload layers (soul slot payloads ⊕ `oats-local.yaml settings` ⊕
`--provider`). Both are exposed on the Resolution; decision binding keeps using
`revision`, so a settings-only difference still refuses a stale apply, while
`spawn --preview` can say **`changed since: declarations | payload | both`**
instead of a bare `changedSince`.

**§6 operator-level dispatch (B3, implements the rule stated above).** Outside a
home, with `oats-local.yaml` present, `oats <ns> <cmd> … --soul <name>` runs
`prepareInstance(dir, name)`, picks the module whose `manifest.command === <ns>`,
ensures its tree in `<deployment>/.oats/modules/<cap>@<commit12>/` (member: the
member repo at `module.from.commit`, `module.dir`; package: the lock entry) and
dispatches to that copy with `OATS_SETTINGS = resolution.payloads[cap]` and
`OATS_CLI_BIN`. `--soul` absent → `E_BAD_ARGS` naming it; a namespace no module
provides → `E_UNKNOWN_COMMAND`. Trust is the resolution's (membership;
`E_PACKAGE_UNAPPROVED` for an unapproved package).

**§5/§6 `work: workspace` under v2 (B2, implements the rule stated above).**
With `prepared` present, a `work: workspace` soul's `./work` links the
deployment directory (`prepared.deployment`, the one holding `oats-local.yaml`);
no branch is recorded; the "needs a declared boundary" remedy names
`oats-local.yaml`, not `oats-config.yaml`. The classic root is unchanged.

**Decision 13 reach (L7).** "Harnesses start normally" is a property of the
0.25 **launcher**: every `pi` launch a 0.25 kernel performs — module homes and
classic 0.24 homes alike — starts pi with cwd = home, the composed `AGENTS.md`
appended, and pi's own skill/context discovery intact. Consequently `oats
session recompose` refuses a **module home** (`instance.json.modules` present)
with `E_UNSUPPORTED_MODE` ("re-spawn"); the `session-recompose` feature name
stays advertised because the verb still serves classic homes
(`docs/desktop-cli-api.md`).

### 0.25.2 operator-rebuild round (2026-09-24) — appended, not edited in place

Source: an operator's first rebuild of a real two-team deployment on 0.25.0,
following `docs/rebuild-to-v2.md` literally. **The guide is a contract the
kernel must honour**: where the guide claimed behaviour the kernel lacked, the
kernel changes; where the guide described keys no provider consumes, the guide
changes. Findings R1–R10; kernel side in 0.25.2 (`docs/release-notes/v0.25.2.md`).
No API integer or feature name changes; the only surface additions are
additive fields (`spawn --preview` `providers` / `settings`, `oats status
--json instances[].soul`) and the `sync --approve` flag.

**§2/§5 member clone lookup (R1).** For a `work: worktree | checkout` soul the
kernel finds the member clone in this order, first hit wins: (1) `oats spawn
--repo <abs path>`; (2) `oats-local.yaml` `clones: { <repo key>: <abs path> }`,
keys normalised through `parseRepoRef(...).key` so any spelling of the same
repo addresses one entry; (3) the convention `<deployment>/<member name>` where
`<member name>` is the last segment of the repo key — **a member named `agents`
is looked for at `<deployment>/agents-repo`** (`<deployment>/agents/` is the
instance root); (4) none → `E_CLONE_MISSING { repoKey, tried: [...], remedies }`
naming the three remedies. A directory found by (2) or (3) whose `origin` remote
resolves to a different repo key → `E_CLONE_MISMATCH { repoKey, path, origin }`
— the kernel never spawns into a clone that is not the member. This order was
stated by the guide and `docs/workspaces.md` before 0.25.2 and not implemented;
it is now normative.

**§6 `oats sync` creates `agents/` (R2).** `sync` (and therefore `onboard`,
which runs the sync body) creates `<deployment>/agents/` when absent. A
hand-written `oats-local.yaml` needs no `mkdir`.

**§5 one "You run on OATS" block (R3).** When `oats.core` resolves as a module
the composer suppresses the kernel's legacy `oats:kernel:oats` block; the
module's inject is the one such block. Without `oats.core` (a soul saying `off`)
the legacy block is composed as before, so no instance is left without the
briefing.

**§5/§6 soul-source drift (R4).** `driftOf` covers `instance.json.workspace.soul`
as well as `modules`: `oats status` prints `soul: <name> from <member> @ <c7>`
with `[member moved since …]` when the member's default branch is past the
recorded commit (`[member unconfirmed]` / `[soul no longer present]` for the
missing cases); `--json` adds `instances[].soul = { repoKey, commit, current:
<commit>|null, status: "current"|"moved"|"missing" }`. A moved soul is
information (decision 17): the instance keeps its own commit directory (M1).

**§6 preview payload visibility (R5).** `oats spawn --preview` (text and
`--json`) reports `providers` — the `--provider <cap> k=v` map exactly as given,
nested — and `settings.<cap>` — `resolution.payloads[cap]`, the merged payload
the provider's binding receives (`workspace.messaging` base ⊕ `byTeam[team]` ⊕
soul slot payload ⊕ `local.settings[cap]` ⊕ `providers[cap]`). Additive fields;
both empty objects when nothing applies.

**§5/§6 `work: workspace` (R6, closed in 0.25.1 as B2).** Documented in the
guide's §9: a coordination soul's `./work` is the deployment directory.

**Provider payload delivery vs provider consumption (R7 — oats.aweb 1.11.2).**
Decision 23 (`messaging.byTeam`) is **kernel semantics**: the kernel merges and
delivers; the provider consumes what its binding declares. oats.aweb 1.11.2's
spawn hook (a) locates the aweb root among `OATS_TEAM_SCOPE`, the home, the
home's git root, `OATS_CONTEXT` and its git root, and `OATS_WORKSPACE` (under
v2: the deployment directory) — none of which is a 0.24 team root; and (b)
resolves the target team from `OATS_TEAM_ID`/`OATS_TEAM_NAME` (the removed
`oats-config.yaml` `team:` block; empty under v2), else the **active team at
the root it found** — it does **not** read `team` from `OATS_SETTINGS`. So for
1.11.2 `byTeam` is delivered and recorded but a no-op; per-label minting is
obtained only by placing a per-team `.aw` inside each team's member clone
(gitignored) so it is found through the work repo, or one `.aw` at the
deployment directory for a single team. The guide states this (§8b) and
`docs/workspaces.md` states the general rule ("kernel-merged; whether a
provider honours it is the provider's"). **oats.aweb follow-up**: read `team`
(and honour `byTeam`'s result) from the payload; accept the deployment
directory as a first-class root. The kernel does not paper over this with a
`team:` env shim — the env block is removed with `oats-config.yaml`, and a
provider contract is the provider's to grow.

**OKF 2.1.3 reads `okf.json`, not a soul payload (R8 — corrects §2's `stores`
comment and decision 24's `root` example).** `oats.okf` 2.1.3's spawn hook
reads the soul's knowledge declaration from `<soul>/okf.json` (`{ version: 1,
owner, owns: ["<base>/<node>"], reads: [...] }`, `lib/config.mjs#validateDeclaration`)
and its settings from `OATS_SETTINGS`, admitting **only** `bindings-file`,
`state-dir`, `harvest-runtime`, `harvest-model` (`oats.json#settings`) — any
other key is `E_CONFIG unknown OATS_SETTINGS property`. Where a base lives
inside a store repository is the **bindings file's** `bases.<alias>.repository`
+ `root`, not a soul payload key. Therefore: a soul.yaml `knowledge:` payload for
OKF carries binding settings only (usually nothing — the workspace default
fills the slot; `none` opts out); `owns`/`reads`/`store`/`root` examples on
`soul.yaml` are removed from the guide, `workspaces.md`, `souls-and-instances.md`
and `knowledge.md`; `okf.json` stays in `souls/<name>/` and travels with the
soul into the per-commit cache (M1). A soul-payload grammar for OKF is an OKF
follow-up that lands with an `oats.okf` release declaring it in its binding.
The kernel's part — opaque forwarding of the merged payload — is unchanged and
correct. §7b's fresh `state-dir` rule is confirmed by the operator's run.

**§6 non-interactive approval (R9).** `oats sync --approve <id>@<version>`
(repeatable) approves exactly the entry the current resolution contains for
that id and version: the executables digest is always computed by `sync` over
the fetched tree (`executablesDigestAt`) and recorded — never typed. An
`--approve` naming an id/version the resolution does not contain → `E_BAD_ARGS`
(nothing approved); entries not covered stay unapproved (exit `2`). At the
interactive prompt **Ctrl+D (EOF) is a decline**: exit `2`, entry unapproved —
never treated as "yes", never a hang.

**§6 onboard next steps (R10).** `oats onboard` lists the workspace **host**
in `next.clone` like any member that lacks a clone at the convention (the host
is a member; a soul that lives in it may need a work clone). Under an explicit
`oats-local.yaml` `standalone:` header the next steps say the view is standalone
and list only that repo.

### 0.25.5 — launch-hook `meta` is persisted

`runLifecycleHooks("launch")` collected each capability's `meta` and the
start/restart path discarded it (only `contributions` and `env` were consumed).
From 0.25.5 a successful start merges `res.meta` per capability into
`instance.json.capabilityMeta` — the record spawn writes and retire reads as
`OATS_META`. A hook answering without `meta` keeps its prior entry; a failed
launch preparation writes nothing. No new field, flag or hook event; this is
the documented hook return finally honoured (decision 27, K3′). Driver: a
provider renewing a session grant at every start would otherwise leave the
original grant id on record and retire would revoke the wrong grant.

### 0.25.3 — `OATS_SOUL_ID` (stable soul identity for providers)

The per-commit soul cache (0.25.1, M1) made `realpath(<home>/soul)` change with every
member commit; a provider that keyed durable state on that path (OKF 2.1.3 `owners.json`)
refused the next spawn (`E_OWNER`). "Members are latest" and "the owner is a path" cannot
both hold, so the kernel now hands hooks a **stable identity**:

- `OATS_SOUL_ID` in the `spawn` / `retire` / `launch` hook environment: for a workspace soul
  `<repo key>#<soul name>` exactly as the canonical key is spelled (e.g.
  `github.com/awebai/aweb#aweb-protocol-expert`, local fixtures `local//abs/path.git#name`);
  for a classic soul the realpath of `agents/<name>/soul` (today's value — 0.24 deployments
  unchanged). Also recorded as `instance.json.workspace.soul.id`.
- `OATS_SOUL` is the **content** the home links — for a workspace soul the per-commit
  directory `agents/<name>/souls/<commit12>/`, never the swappable `agents/<name>/soul`
  pointer. Providers read content from `OATS_SOUL` and key state on `OATS_SOUL_ID`.
- Provider contract (OKF 2.1.4): `owners[owner] = OATS_SOUL_ID ?? realpath(OATS_SOUL ?? home/soul)`;
  a prior row whose value is a path under `agents/<same soul name>/(soul|souls/<commit>)` is
  migrated to the id once, not refused; any other mismatch stays `E_OWNER`.


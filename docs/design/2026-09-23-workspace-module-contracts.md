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

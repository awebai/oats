# Phase 4 — implementing workspace model v2: proposal for the human

**Date:** 2026-09-23 · **Status:** PROPOSED — nothing lands before the human approves this plan.
**Decision:** `agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md` · **Worked example:** [2026-09-23-simplified-workspace-model.md](2026-09-23-simplified-workspace-model.md)

## What we are building, in one paragraph

A clean v2 of the kernel's declaration, resolution and launch path: read `oats-workspace.yaml` v2 / `oats-membership.yaml` / `soul.yaml` v2 / `oats-local.yaml` over Git remotes; confirm membership; resolve every capability by `from:`; fetch packages at the locked version with per-version approval in lock v3; copy each capability whole into the instance (`.oats/modules/` + `.agents/skills/`); compose `AGENTS.md`; launch the harness normally. Remove the installed-capability tier, the classic activation config and the v1 declaration readers. No migration. The framework's own repos become the first real v2 workspace and the Desktop follows through new DTOs under new feature names.

## Where the current code is

`lib/` is 82 modules / 21 k lines; `core.mjs` alone is 9.2 k. The v1 declaration/portable path is spread over ~20 modules (`workspace-definition`, `workspace-discovery`, `source-spec`, `portable-*`, `capability-provenance`, `prepared-resources`, `resolution-shape`, `captured-*`, `packages` 1.4 k). Much of that machinery exists to carry per-soul versioned sources, migration evidence and the installed tier — the things v2 removes. The lifecycle core (spawn/retire/session/events/schedule, the Desktop DTOs, `binding` validation, the lock) stays.

**Approach (human, 2026-09-23): the new modules ARE the kernel — no `lib/v2/`, no seam, no flag.** Each phase replaces canonical code on main and deletes what it supersedes; tests are updated to the new truth in the same phase. Desktop contracts that change do so under new feature names; the Desktop follows in W12.

## Work packages

Each is one PR (or two small ones), reviewed by me, on `main`, behind the v2 seam until W7. Order is dependency order; W1–W3 can proceed in parallel lanes.

| # | Package | Delivers | Owner | Size |
|---|---|---|---|---|
| **W1** | **Schemas + fixtures** | `oats-workspace.schema.json` v2, `oats-membership.schema.json`, `soul.schema.json` v2, `oats-local.schema.json`, lock v3; the Northwind example as a **test fixture workspace** (three teams, five repos as bare local remotes) used by every later package | lead | S |
| **W2** | **Remote observation** | `lib/remote.mjs`: fetch a file or a tree from a Git remote at default-branch or exact commit, in the operator's access context (git credential helper / `gh` token), with typed `cannot read <url>`; bounded; a content-addressed **fetch cache** under the OS cache dir (invisible plumbing) | lead | M |
| **W3** | **Membership + discovery** | `lib/workspace.mjs`: read the workspace file; for each member read `oats-membership.yaml`; confirm both halves in one access context (`E_MEMBERSHIP_UNCONFIRMED` naming the missing/unreadable half); enumerate `souls/*/soul.yaml` and `capabilities/*/oats.json`; apply `private`; team labels (`E_TEAM_UNKNOWN`); standalone case | lead | M |
| **W4** | **Resolution** | `lib/resolve.mjs`: workspace defaults ⊕ `defaults.byTeam` ⊕ soul (`off` removes) → for each `(name, from)`: member lookup or package lookup; slot filling from `layer:` (`E_SLOT_CONFLICT`); produces an immutable **resolution** (the input to preview/apply — reuses `decision.revision`) | lead | M |
| **W5** | **Packages v2 + lock v3** | `lib/packages.mjs` (rewritten in place): `packages:` → catalog/git ref → commit; integrity; **approval per version** stored in `oats-lock.json` v3 (`approved.executables` digest); `oats package add|remove`; a moved tag fails integrity and re-asks; **delete** `oats install/restore/use/init` and the installed tier | lead | M |
| **W6** | **Materialization + launch** | `lib/materialize.mjs`: copy each resolved capability whole into `<instance>/.oats/modules/<cap>/`; copy `skills/` into `<instance>/.agents/skills/<cap>/`; compose `AGENTS.md` (soul + injects); record `modules{}` and **`providers{}` (from `spawn --provider <cap> k=v`, the instance-level payload home; merged with soul + `oats-local.yaml` settings before `binding`)** in `instance.json`; keep `CLAUDE.md`/`.claude/skills` aliases; **launch the harness normally** (drop the ambient-skill exclusion; keep model/profile pinning) | lead | M |
| **W7** | **CLI switch-over** | `oats sync`, `oats spawn` (preview/apply unchanged in shape, now fed by W4/W6), `oats capabilities` / `oats souls` with origin + team, `oats workspace status`; `oats status` shows `modules … @ commit` + `member moved since`; `oats version --json` advertises `workspaceApi: 2` + feature `workspace-v2`; **remove the v1 readers** (`oats.yaml`, per-soul `source:`, `oats-config.yaml` activation) — a v1 file at a v2 path errors naming the schema | lead | M |
| **W8** | **Delete v1** | Remove `portable-*`, `source-spec`, `capability-provenance` (v1 parts), `prepared-resources`, migration stores/evidence, the installed tier in `packages.mjs`, classic config activation, their tests and docs; `core.mjs` loses everything that only served v1 | lead | L (mostly deletion) |
| **W9** | **Framework repos as the first workspace (decisions 18–21)** | `oats-workspace.yaml` v2 in `oats` (drop the six imports; `packages:` pins oats.framework/okf/aweb/jira/linear/authoring/dev **as packages**; `teams:` global/engineering; `defaults`); `oats-membership.yaml` in ALL seven repos; the six soul editions rewritten (`oats.okf: {from: package}` etc. even though the repos are members); **a new expert soul in every package repo** — `okf-expert`, `aweb-expert`, `jira-expert`, `linear-expert`, `authoring-expert`, `dev-expert` (v2 `souls/<name>/`, team global, knows and evolves that capability); `package-catalog.json` kept as the official marketplace (bare-version `packages:` entries resolve through it) | lead (member-repo PRs to their owners; the expert souls' AGENTS.md drafted by me, reviewed by the package owner) | L |
| **W9b** | **`oats.core` and `oats.setup` rewritten for the new architecture (human, 2026-09-23)** | The two official capabilities' skills and injects are rewritten to teach the *new* model, not patched: **`oats.core`** (`oats-operate`, `oats-souls`, the "you run on OATS" inject) — how an agent works inside an instance under this architecture: its home layout (`.oats/modules/`, `.agents/skills/`, `instance.json` modules/providers), the verbs it will actually use (`status`, `spawn --preview/--provider`, `retire`, `session`, `instance events`, `capabilities`, `souls`, `workspace status`), what a workspace/member/package/team is *from the agent's seat*, drift ("member moved since"), how to find and read other souls. **`oats.setup`** (`oats-config`/`oats-packages` → renamed to what they now are: `oats-workspace`, `oats-packages`, `oats-onboarding`) — the whole architecture and its best practices: workspace ↔ repo handshake and why, `oats-workspace.yaml` / `oats-membership.yaml` / `soul.yaml` v2 / `oats-local.yaml` field by field, teams as labels, member-tier vs package-tier and the non-collapse rule, `packages:` + lock v3 + per-version approval, the official catalog vs `git:` refs, `sync`/`package add`, the `<name>-workspace/` convention and clone-then-spawn, private items, external souls, the standalone case, provider payload homes (soul/machine/spawn), what is deliberately NOT versioned and why. Every skill is validated against the shipped CLI (`oats <verb> --help` snapshot test) so they cannot drift from the commands. | lead (swarm + review) | M |
| **W10** | **Docs** | **`docs/rebuild-to-v2.md` — the rebuild guide (ships with the schemas; states that 0.24.x keeps spawning 0.24.x deployments)**; `docs/workspaces.md` rewritten around v2; `souls-and-instances.md`, `packages.md`, `configuration.md` (mostly deleted), `first-team.md` → the `<name>-workspace/` convention; DTO doc § Workspace v2; release notes | lead | M |
| **W11** | **Onboarding skill** | `oats-setup-expert` / `oats.setup`: teach `<name>-workspace/`, `oats sync`, clone-then-spawn; **the hosting rule for mixed public/private organisations (decision 26): ask up front whether any member is private; if so the workspace file is hosted in a private repo that is NOT a public member (a dedicated private `workspace` repo is the honest shape), public contributors get the standalone case with `oats.core` by default (decision 25); `oats onboard` prints the same rule in its next-steps**; the `oats-operate` skill updated for the new verbs | lead | S |
| **W12** | **Desktop follow-through** | New kernel DTOs (from W7) consumed the usual way — engineer reads the merged head, files pins, wires: Capabilities/Souls origin + team columns; "installed" removed as a state; spawn preview shows modules (from/commit/hash) + team; Workspaces surface shows membership status | Desktop engineer, after W7 | M |

**Team review (Antares, 2026-09-23) folded in:** rebuild guide (W10), **second review (two aweb teams, stores, soul layout, standalone, public/private hosting → decisions 23–26: `messaging.byTeam`, stores = repo + provider `root`, `souls/` only, `oats.core` standalone default, private host rule taught by onboarding),** `--provider` instance payload (W6/W7), drift display (W7), duplicate-name rule (W6), 0.24.x-keeps-working stated everywhere.

**Not in scope:** K11 (member admission UI/"Join"), K12 (transcript verb), 10B editor/detach — they wait behind this.

## How phases land

Each phase = one developer-swarm workflow (parallel agents, disjoint files, against a written module contract) → one adversarial-review workflow (independent reviewers with different lenses) → fixes → my four-gate review → merge to main. No compatibility flag: when a phase lands, its modules are the kernel and the v1 code they replace is deleted in the same PR, with tests rewritten. Between phases main is always green and always the canonical state.

## Releases

- **0.24.14** — 10A + 10B-0 (already planned; nothing v2). Ships first, independent.
- **0.25.0** — W1–W8: the new model is the kernel, v1 deleted as each phase landed; `workspaceApi: 2`. Breaking by design (no migration).
- **0.26.0** — W9 live (framework repos on v2), W11 onboarding, W12 Desktop.

## Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Remote access context is subtle (SSH vs HTTPS vs `gh` token; private repos) | W2 uses git itself (`git ls-remote`, `git archive`/shallow fetch) with the operator's configured credential helpers — no new credential store; typed `cannot read` never guesses |
| `core.mjs` entanglement makes W8 risky | W8 is deletion behind a green W7; the seam guarantees nothing live depends on what is deleted; CI + the Northwind fixture + Desktop suites are the gate |
| Package approval UX ("asks once") in non-interactive spawns | `oats sync` is where approval is asked; `spawn` refuses `E_PACKAGE_UNAPPROVED` pointing at `sync` — never prompts mid-spawn |
| Latest-state members drift between preview and apply | The resolution records the member commit; apply re-observes and refuses `E_DECISION_STALE` if it moved — same mechanism as today's decision revision |
| Desktop relying on "installed" | Removed as a state in W12; until then the Capabilities view keeps working on 0.24.x DTOs (contracts unchanged) |

## What I need from you

1. **Approve the plan shape** (parallel v2 beside v1, one switch-over release, then delete) or tell me you want in-place.
2. **Confirm I implement the kernel packages W1–W11 myself**, with the Desktop engineer on W12 after W7 — or whether Juan's side should take lanes (W2 remote observation and W5 packages are the most separable).
3. **0.25.0 as the breaking release number** — fine?
4. Anything in W9 you want different for the framework repos (team labels for the six souls: I'd put the five experts under `global`, `oats-setup-expert` under `global`, and any dev capabilities in `oats-dev` under `engineering`).

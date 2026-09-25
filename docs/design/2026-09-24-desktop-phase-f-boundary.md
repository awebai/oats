# Desktop Phase F — the Desktop is built FOR workspace model v2

**Status**: boundary for the Desktop engineer, issued 2026-09-24 by the lead under
the human's direction: *"the desktop should not just adapt to the new version,
it should be natively built for it."* Supersedes the Phase 3 parity plan's
assumptions about what the Desktop reads; keeps its visual deliverable (the
redesign frames, excl. 05/06).

**Human's second directive, verbatim intent**: make ultra sure the Desktop is set
up to work in the new setup — new versions, new CLI, new deployment shape.

## 0. Why this is a rebuild of the model, not a patch

The Desktop today is a 0.24 product that *tolerates* 0.25 kernels: its
`ACCEPT_RANGE` admits `0.25.x`, so it launches, and the few CLI verbs it drives
(`version`, `session *`, `spawn`, `retire`, `schedule`, `catalog`) still answer.
But its **model of a deployment is 0.24's**, reimplemented in
`packages/desktop/server/deployment.mjs`: it reads `oats-config.yaml`,
`agents/<name>/soul`, `local-agents/`, and capability manifests from
`.agents/capabilities/installed/`, and derives the roster itself. None of these
is how a v2 deployment is shaped:

| 0.24 (what the Desktop reads) | v2 (what a deployment IS) |
|---|---|
| `oats-config.yaml` at the repo root | `oats-local.yaml` at the deployment directory → `workspace:` URL |
| souls at `agents/<name>/soul` | souls at `souls/<name>` **in member repos**, materialised per commit into `agents/<name>/souls/<commit>` |
| capabilities installed into `.agents/capabilities/installed/` | packages resolved through `oats-workspace.yaml` + the official catalog, locked in `oats-lock.json`, **copied whole into each instance home** (`.oats/modules/<cap>`) |
| `team:` block | `oats-membership.yaml` `team:` label per member; `messaging.byTeam.<label>` payloads |
| `oats catalog` DTO | removed; the catalog is `package-catalog.json` resolved by `oats sync` |
| roster derived by the Desktop | `oats status --json` is the roster (agents, instances, `modules[]` drift, `soul` source drift, `identity`) |

A Desktop that keeps the left column and adds a few right-column fields is the
"adapt" outcome the human rejected. Phase F replaces the left column.

## 1. The principle: the kernel is the model; the Desktop renders and drives it

- **Read model**: every fact the Desktop shows about a deployment comes from
  the kernel's JSON surfaces — `oats status --json`, `oats inspect --json`,
  `oats workspace status --json`, `oats spawn --preview --json`, `oats
  readiness --json`, `oats version --json`, `oats sync --json`. The Desktop
  does not parse `oats-config.yaml`, `oats-local.yaml`, `soul.yaml`,
  manifests or lock files itself. Where a fact is missing from a kernel
  surface, the fix is a kernel PR (lead's lane), not a Desktop-side parser.
- **Write model**: every mutation is a kernel verb with `--json`: `sync`,
  `sync --approve`, `spawn` (preview → `--expect-decision` apply), `retire`,
  `session start|restart|recompose`, `schedule *`, `onboard`. The Desktop
  never writes a deployment file.
- **Version contract**: `oats version --json` `features[]` is the capability
  probe. The Desktop's `ACCEPT_RANGE` moves to `>=0.25.6 <0.27.0` (the first
  kernel with `served-identity`), and each feature the UI depends on is gated
  on its `features[]` name, not on a version number.

## 2. Deliverables (slices; each is one PR against main, each reviewed by the lead)

**F1 — Deployment model on kernel JSON.** Replace
`server/deployment.mjs`'s own readers with `oats status --json` (+ `oats
workspace status --json` for the workspace header: name, key, members, packages,
lock state, `approvalNeeded`). Roster rows carry `modules[]` drift, `soul`
source (`repo: <member> @ <c7>`, "member moved since"), `identity`. Legacy
`local-agents/`/`tmp-agents/` paths are dropped. Remove `server/catalog.mjs`'s
`oats catalog` DTO validation (the verb no longer exists).

**F2 — Workspace onboarding and sync.** A "Open deployment" flow that: detects a
directory with `oats-local.yaml` (v2), or offers `oats onboard` for one without
(the kernel asks for the deployment directory and the workspace URL — the
Desktop collects both, never invents a folder name; decision 9). A "Sync"
action runs `oats sync --json`; exit 2 with `approvalNeeded[]` renders an
approval sheet showing each package's `executables` digest and applies with
`oats sync --approve <id>@<version>` (the version string is what
`approvalNeeded[].version` reports — for a git-pinned package, the full OID).
Lock drift and `E_PACKAGE_INTEGRITY` are surfaced verbatim.

**F3 — Spawn dialog on the v2 preview.** The preview already carries
`modules`, `providers`, `settings.<cap>`, `team`, `resolution`, `decision`.
Render: which modules the instance will get and from where (package vs member,
commit); the merged `settings.<cap>` per provider (read-only); **Identity**
select (local | global) with a Resident field for global, prefilled from
`settings.<messaging cap>.identity`, forwarded as `--provider <cap>
identity.mode=… identity.resident=…` (decision 27 — there is no kernel flag);
`decision.effective.providers` is what the confirm binds. `cli-adapter.mjs`
`SPAWN_ARG_RULES` gains one `provider` rule (capability id, dotted key, value
grammar); no identity-named rules. Work mode select includes `workspace`.

**F3 amended by the human (2026-09-24). This supersedes design frame 02 and the
text above wherever they differ.** The dialog leads with the **instance name**:
the purpose field becomes a name field that shows `<soul>-<purpose>` live and
then the kernel's final name from the preview. A no-prefix toggle maps to
`spawn --name <slug>`, gated on the `spawn-name` feature; `--purpose` stays the
default. **Runtime and model** are always visible, with their resolved value and
its source. **Relationship** sits in the main form, shown by default: None /
Child of / Sibling of / Parent of. There is **no** modules/capabilities list and
no attach-knowledge / child-spawn / open-PR toggles, because those behaviours
come from capabilities. There is **no** preview button either. The preview runs
in the background to fill the real defaults, and apply still binds with
`--expect-decision` (`E_DECISION_STALE` re-previews). A collapsed section named
**Developer settings** holds:
- **work**: base | branch and the worktree path. A `checkout` soul is offered
  "Use a worktree instead?" (`--work worktree`); the work mode itself comes
  from the soul's `work:`.
- harness permissions
- launch config
- session backend
- Run on (the execution server)
- wake-up
- messaging identity (`--provider <cap> identity.mode=…`, decision 27)

(Second human redirect, same day: relationship moved into the main form, work
moved into the collapsed section, and the section was renamed from "Advanced".)
Every modal gets a darker backdrop.

**F4 — Instance card and roster on v2 facts.** The served-identity line (`acts
as <address> via grant, expires <t>` / `alias <a> on <team>`); module rows with
"moved since" markers and a **re-spawn** action (preview → apply, then retire
the old instance — module homes answer `E_UNSUPPORTED_MODE` to
`session recompose` by design; an instance never changes under itself); the
soul-source row; quarantine state from `rollbackIncomplete` with the retry
action (`oats retire`) and `--force` behind a confirm.

**F5 — Redesign frames** (the original Phase 3 deliverable, excl. 05/06),
implemented on top of F1–F4 rather than on the 0.24 model.

**F7 — Side panels redesigned, teams everywhere (human, 2026-09-25). This
supersedes the frames and the text above wherever they differ.** One Desktop PR:
- **Side panels** in the spawn modal's design language (frame 01a):
  - an identity header and compact cards;
  - only useful facts (no "Not reported" rows), and empty sections hidden;
  - relative dates, and shortened paths with Copy;
  - errors as one plain sentence, with the code behind Details;
  - discoverable cross-links between an instance and its soul.
- **Terminal-side context panel tabs, in order:** Instance · Soul · Git & GitHub.
- **Teams, per surface** (teams contract `docs/design/2026-09-25-teams-contract.md`):
  - **Soul** (Workspace inspector): the soul's labels, primary marked, each
    joinable or "not mapped by this workspace". Read-only, from
    `inspect --soul` `teams`.
  - **Instance** (Workspace inspector and the terminal-side Instance tab): the
    live panel (#178). Personal is always on; joined teams have Leave, and
    joinable ones have Join.
  - **Spawn modal, main form** (not Developer settings), a Teams row:
    - "Personal team — always", fixed;
    - each joinable label as an unchecked checkbox, sent as
      `--provider <messaging> join=<a,b>`;
    - unmapped labels greyed with the reason;
    - the line "By default it's only in your personal team. Tick the teams it
      should also join."

    The row is shown iff the preview carries `teams` AND the messaging
    manifest declares `settings.join` (the Desktop gates on declared facts,
    never on versions).

**F6 — Version and doctor surface.** `oats version --json` and `oats doctor
--json` in an About/Health pane; `ACCEPT_RANGE` and the three pins move to
`>=0.25.6`; a kernel below the floor is refused with the upgrade command shown.

Order: F1 → F2 → F3 → F4 → F5 → F6, or F1 then F3/F4 in parallel if the engineer
spawns children (its call; the lead reviews each PR).

## 3. What the engineer must LEARN first (before F1)

Read, in this order, in the checked-out main:
1. `docs/workspaces.md` — the v2 model end to end (deployment vs workspace,
   members, packages, payloads, `byTeam`, hosting).
2. `docs/rebuild-to-v2.md` — how an operator builds a deployment (this is the
   flow F2 wraps).
3. `docs/desktop-cli-api.md` — every JSON surface, with examples; note
   `features[]`, `decision.effective.providers`, `instances[].identity`.
4. `docs/design/2026-09-23-workspace-module-contracts.md` §0.25.x — what
   changed per release and why.
5. `agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md` and
   `…/served-identity-is-a-messaging-layer-fact.md` — the decisions.
6. `test/fixtures/northwind/build.mjs` — the two-team fixture workspace; run
   `node --test test/spawn-workspace.test.mjs` once and read what a v2 spawn
   produces on disk (`.oats/modules/`, `instance.json` `modules`/`providers`/
   `workspace.soul.id`).

Then build a scratch deployment by hand with the CLI (`oats onboard`, `oats
sync`, `oats sync --approve`, `oats spawn --preview`, `oats spawn --no-launch`,
`oats status`, `oats inspect`, `oats retire`) against the Northwind fixture
remotes, and keep the transcript: F1's tests are written against exactly those
JSON shapes.

## 3b. Native rework, not a compatibility layer (human, 2026-09-24)

The human's rule, verbatim intent: *"do a native rework — do not keep v1-specific
things, and no v1 modules calling v2 modules."* Concretely:

- **Remove, do not wrap.** A 0.24 reader (`server/deployment.mjs`'s
  `oats-config.yaml`/`soul.yaml`/manifest parsing, `local-agents/`,
  `.agents/capabilities/installed/`, the `oats catalog` DTO) is deleted in the
  slice that replaces it — never kept behind a flag, a fallback branch, or an
  "if the kernel is old" path. The Desktop supports one kernel line
  (`ACCEPT_RANGE` from 0.25.6) and refuses older ones with the upgrade command.
- **No adapters between generations.** No module whose job is to translate a
  v1-shaped object into a v2-shaped one or vice versa (no `legacyRosterToV2()`,
  no `toOldCard()`); the v2 kernel JSON is consumed where it is read and shaped
  once for rendering. If a v1 module still needs a v2 fact, the v1 module is
  the thing being replaced — replace it, do not feed it.
- **Names and types follow v2.** Types, fields and UI labels use the kernel's
  vocabulary (workspace, member, package, module, deployment, soul source,
  served identity); 0.24 vocabulary (installed capability, config chain, team
  block, agents root as identity) leaves the codebase with the code that used
  it. `git grep` for the old terms is part of each slice's exit check.
- **Tests follow the same rule.** Fixtures shaped like 0.24 deployments are
  deleted with the readers; new fixtures are v2 deployments produced by the
  kernel (Northwind or a hand-built scratch deployment), not hand-written
  JSON imitating old shapes.
- **One exception, stated per case.** Where a 0.24 concept has a genuine v2
  successor with the same meaning and the Desktop code is already correct for
  it (a terminal broker, a tmux target admission), it stays — the PR names it
  as "unchanged, v2-agnostic", not as "kept for compatibility".

Exit check for Phase F as a whole: no file under `packages/desktop/` reads a
deployment file, names a 0.24 concept, or contains a code path that exists
only for a kernel below the floor.

## 4. Rules that do not change

- `packages/desktop/**` only; kernel gaps go to the lead as a written ask
  (they become kernel PRs; the engineer never adds a Desktop-side parser to
  work around one).
- No native tmux/PTY/Electron execution by the agent; the lead's native gate
  at review time is the acceptance.
- Every slice: focused tests + the intended mutants on the new code; the
  Desktop suite green; one PR per slice against main; lead's pr-review.
- The design frames are the visual authority; the kernel JSON is the data
  authority; where a frame shows a 0.24 concept (an "installed capability"
  list, a `team:` block), the frame is adapted to the v2 concept and the
  adaptation noted in the PR.

## 5. Acceptance for Phase F as a whole

The lead builds a fresh v2 deployment from the Northwind fixture using ONLY the
Desktop (open → onboard → sync → approve → spawn with a global identity →
inspect → retire) on kernel 0.25.6+, and every fact shown matches `oats status
--json` / `oats inspect --json` byte for byte. Nothing in
`packages/desktop/server` reads a deployment file.

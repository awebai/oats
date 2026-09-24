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

**F4 — Instance card and roster on v2 facts.** The served-identity line (`acts
as <address> via grant, expires <t>` / `alias <a> on <team>`); module rows with
"moved since" markers and a "recompose" action (`oats session recompose`); the
soul-source row; quarantine state from `rollbackIncomplete` with the retry
action (`oats retire`) and `--force` behind a confirm.

**F5 — Redesign frames** (the original Phase 3 deliverable, excl. 05/06),
implemented on top of F1–F4 rather than on the 0.24 model.

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

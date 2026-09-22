# Desktop parity — slice plan and kernel/provider seams (S8)

Status: **proposal accepted for direction** by the lead on 2026-09-22; contracts K1–K8 and P1 are *proposed identifiers*, not shipped CLI grammar. Five policy decisions are routed to the human (below) before their slices start. Author of the plan: the Desktop engineer (`oats-desktop-engineer-1`); this document is the lead's record of it. Scope authority: the human's 2026-09-22 direction — the redesign to the letter, only frames 05 Knowledge and 06 Tasks excluded.

## Slices (each a PR from main; lead reviews and merges)

| Slice | Delivers | Needs |
|---|---|---|
| 1a | Compact guides; engine-owned ⌘F / ⌘N; rebind-aware hints | — (PR45) |
| 1b | Shell 01a/01b: right panel Instance · Git & GitHub · Soul tabs, collapse rail, two editor groups, focus mode; panel state survives repaint | existing tabs/terminal lifecycle |
| 2a | Worktree branch/ahead/behind/path; changes list; bounded unified diff | **K1** |
| 2b | PR card: title/#/state/commits/closes; per-job checks bound to head OID; unresolved review threads; Open PR; Send threads | **P1**, **K2** |
| 2c | Remove / Stop confirmations with worktree/branch/open-PR/child/dirty facts and receipts | **K3** |
| 3 | 03 Souls + Sources: imported editions + local souls, requirements, provenance, editability | **K4** |
| 4 | 04 Capabilities: official catalog (`oats catalog --json`, 0.24.6+) + deployment inventory/readiness/used-by; Add capability = exact command | landed catalog + list/inspect + **K5** |
| 5 | 09 First-run readiness quartet; View policy; Skip/Enrol | **K5** + enrollment decision |
| 6a | 02 Spawn modal **design parity on existing seams** (human pulled forward 2026-09-22): two-column layout, soul chooser, provider/model dropdowns, launch config restored, opening instruction, readiness from known facts (`unknown` where not), ⌘↵ guards; not-yet-backed fields rendered disabled with "available after <seam>" | existing spawn/launch-config seams |
| 6b | 02 Spawn fields live: soul chooser, provider/model, launch config (restored), work-area naming/worktree/base+branch, opening instruction, attach knowledge, child spawns, auto-PR, readiness, ⌘↵ | **K6** (+ knowledge-node JSON from the knowledge provider; 05 excluded but attach stays) |
| 7a | 07 Active overview: counts, relations, activity/waiting-on-you, actions, pan/zoom | **K7** |
| 7b | 08 Schedules: table/toggles/new/edit, next/last, recent runs, transcript handoff, captured-policy preservation | **K8** |
| 8 | 10 Components: dropdowns, workspace join/manage, Open in split, Detach to window, Open worktree in editor, actions, toasts, collapsed rail | existing seams + Desktop IPC review for detach/editor |

## Shared JSON rules (accepted)

Envelope `{schemaVersion:1, ok, result|error}` unchanged. Requests address a server-admitted exact target (`{home, server}` / exact source+revision+soul), never a renderer cwd. Results echo target + `contract`, `version`, `observedAt`, opaque `revision`, typed `problems[]`, explicit completeness/truncation. `null` = not known; empty = observed empty only when complete. Per-section availability `available | not-applicable | unavailable | denied | unsupported | error`. No stack traces, auth stderr, tokens or token-bearing URLs in renderer data. Remote paths are provenance, never local authority. Read-only calls never install, trust, enroll, spawn, fetch into the operator's worktree, switch branches or repair config.


> **Ownership amendment (2026-09-22, human):** contract-dependent slices are not waits — the team implements the contracts. Kernel seams may be assigned to the Desktop engineer under lead review (the `lib/`/`bin/` lane rule is lifted per assigned seam). Current split (revised 17:10Z): **K1, P1 Decision, K3, K5 → lead** — the engineer's composed instructions forbid kernel edits and a mail cannot recompose them (role change = soul edit + recomposition; spawns blocked by the deployment's pi-profile pin). Engineer: slice 3 now (K4 merged), then 2a after K1. Kernel PRs: full root `npm test` + DTO in `docs/desktop-cli-api.md` in the same PR.

## Seams

- **K1 `oats.instance-git` / `oats.instance-diff`** (kernel): typed per-instance Git state — worktree, head, upstream/merge-base comparison (missing upstream ≠ 0/0), NUL-delimited changes with rename paths and per-file counts; bounded unified diff by opaque file id + observation revision (stale selection refuses, never a different file). Replaces the Desktop-only `instance.git` aggregate whose fallback zeros can masquerade as clean.
- **P1 `oats.instance-github`** (provider, not kernel): PR summary/checks/reviews through an additive Git/review **capability** with its own credential policy (native custody; Desktop never runs `gh`, reads tokens or opens credential forms). Needs a kernel dispatch contract for additive-capability structured views (today `operation run` accepts only knowledge/messaging/tasks). "No PR" ≠ unavailable ≠ unauthenticated ≠ rate-limited. Checks bind to exact head OID. Review markdown is untrusted text.
- **K2 review-thread delivery**: explicit, confirmed send of selected threads to the exact home's session input with receipt (`delivered | refused | unknown`); delivered ≠ consumed. Typed producer events for commit / branch-renamed / PR-updated / review-request; **no prose parsing** to infer actions.
- **K3 lifecycle plan/apply**: read-only plan (runtime activity, children, worktree dirt, branch + open PRs, retention per artefact, per-option allowed/default/reason, warnings, blockers) → apply with plan revision + idempotency key, revalidated under the lifecycle lock; per-target `completed | retained | partial | unknown`. Today there is **no standalone stop**, and retire removes owned worktrees; the design's default Remove retains worktree/branch/PR.
- **K4 souls/sources enumeration** (✅ MERGED PR52 as additive `inspect --json` `soulsApi:1`, not a new command — see docs/desktop-cli-api.md): qualified list of imported editions + authored local souls with identity/source/revision/requirements/declarations/editability; readiness separate from launchability and adoption; no renderer YAML.
- **K5 readiness quartet** (✅ MERGED PR63 — `oats readiness`): `installed | trusted | configured | enrolled`, each `pass | fail | unknown | not-applicable` with items (subject, requiredness, reason, producer, evidence, remedy); trust separates artifact approval from `signature {verified|unsigned|unknown|invalid, signer}`; policy view returns **enforced** child-spawn/worktree permissions with origins; native config items report labels/scope state, never secrets; unknown ≠ granted.
- **K6 spawn preview/apply** (✅ MERGED PR63 — `oats spawn --preview`, `--base`, `--model @native-default`) (add, 2026-09-22 from 6a review: an explicit `model: {kind: "native-default"}` request field — today an omitted model inherits the configured/soul model and there is no force-native override; 6a renders that control disabled until K6): kernel returns suggestions, canonical worktree/home/branch/base OID, resolved knowledge refs, enforced child policy, auto-PR policy, readiness, typed field problems; apply revalidates and captures; no Desktop-derived paths or branches.
- **K7 activity feed** (✅ MERGED PR64 — `oats instance events`): bounded typed events per instance with provenance; "waiting on you" only from a producer that reports it.
- **K8 schedule run history** + captured-policy-preserving edit contract; transcript access via the owning CLI/provider.

## Decisions — DECIDED 2026-09-22 (lead, delegated by the human)

Recorded in `agents/oats-expert/soul/knowledge/decisions/desktop-parity-lifecycle-and-policy-decisions.md`: (1) Remove retains worktree/branch/PR by default and re-homes the worktree to the deployment `worktrees/` root before the home is removed; (2) `stop` is a first-class recursive lifecycle route retaining everything for restart; (3) Enrol = workspace member admission with a two-document receipt; "signed by" renders only on a verified Git signature with a named signer; policy rows render enforced policy only; (4) child-spawn permission is enforced by the spawn route (attributed refusal); (5) auto-PR is provider-owned, default off, first pushed commit, draft, human undrafts. Gemini illustrative. The original questions follow for the record.

### Original questions

1. **Remove semantics** (K3, slice 2c): the design's default Remove deletes the instance but *retains* worktree, branch and remote PR; today retirement removes owned worktrees and there is no standalone Stop. Decide: adopt the design's retention default (needs a kernel placement/custody rule for a worktree that outlives its home) or keep current semantics and label the UI accordingly.
2. **Recursive Stop** (K3): Stop as a first-class lifecycle action (retain home/worktree for restart) including children — new kernel route.
3. **Enrollment** (K5, slice 5): what "Enrol workspace" *is* (workspace admission? team/machine registration?), its authority and receipt; `oats onboard` is bootstrap, not enrollment. Also what counts as **signature evidence** for "Trusted · signed by …" (catalog URL/hash is not a signer).
4. **Enforced child-spawn permission** (K6): "Allow child spawns" must be enforced by admitted spawn routes, not advisory — new kernel policy surface.
5. **Automatic PR** (K6 / P1): trigger (proposed: first non-empty *pushed* commit), draft status, publication consent; provider-owned; default off; never commits/pushes local data on its own.

Also to confirm: prototype "Gemini" runtime is illustrative (not an OATS runtime) unless the human wants kernel work.

## Ownership

Lead: K1, K4, K5 (readiness/policy shape), K6 preview/apply plumbing, K7/K8 projections, dispatch contract for additive-capability views — proposed as Decisions where they change contracts, implemented in small PRs otherwise. P1: **forge connections are ADE/workstation integrations, not capabilities** — **Decision ACCEPTED** (`agents/oats-expert/soul/knowledge/decisions/p1-forge-connection-is-an-ade-integration.md`). Desktop *Connections* surface (GitHub card: status / Connect = `gh auth login --web` in an owned pane / Disconnect), PR card read by the Desktop server via fixed-argv `gh pr view … --json` at the existing guarded boundary, typed states (available / no-pull-request / not-connected / cli-not-installed / unsupported-forge / no-remote / unavailable), remote workspaces refuse; OATS never holds a token. No kernel dispatch contract. Kernel: K1 gains `remote {name,url,host,path}` (lead). Slice **2b** = Connections + PR card (engineer; lead security gate before wiring). Auto-PR: ADE-owned, off, per spawn, after K6. Desktop engineer: all slices, Desktop IPC review items (detach, open-in-editor).

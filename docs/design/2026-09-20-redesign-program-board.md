# OATS redesign — program board

**Purpose:** the one accurate view of every work stream in the redesign, what is on main, what is in flight, who owns it, and what blocks it. Lead: `oats-expert` (redesign lead). Updated whenever anything merges, is returned, or reality changes. Older per-lane boards are superseded by this file.

**Last update:** 2026-09-21 16:00Z · main `9d862140` · **OATS v0.24.4 PUBLISHED** (tag 816afb0f; bump #42) · OKF v2.1.1 · oats-framework/v1.1.1 · aweb v1.11.0 · oats-knowledge 8d67eab4

Legend: ✅ on main/published · 🔄 in flight (PR/branch) · 🟡 preserved, not adopted · ⬜ not started · ⛔ blocked

## Streams at a glance

| # | Stream | State | Owner | Next action |
|---|---|---|---|---|
| S1 | Knowledge capability contract rework (kernel↔provider boundary, OKF 2.x) | ✅ OATS 0.24.1 / OKF 2.1.1 published | P | done for this phase |
| S2 | Workspace/Portable Souls adoption of the OATS repos | ✅ 0.24.3 gate run: knowledge slot resolves via the workspace route; seams 1–4 fixed, 5 attributed · ✅ **messaging source defect found and fixed (906b1558: per-human policy + soul teams)**, imports repinned f3ee31e0 · 🔄 final re-run for a published resolution + OKF check probe | lead, Antares | re-run; then S2 closed |
| S3 | Messaging capability readiness on the new infrastructure (aweb) | ✅ aweb 1.11.0 released · ✅ **catalog + six editions pin v1.11.0 (0.24.2)** · ⬜ second-operator re-run | P, lead | Antares re-run |
| S4 | Official capabilities `oats.core` / `oats.setup` + explicit default + onboarding `oats-setup-expert` | ✅ D1, D2, **D3 merged (PR35)**: `oats onboard` verified live (acquire 1.1.1 → setup expert with both caps → scaffold composes the five capability skills, no legacy) · `oats.framework` 1.1.1 tagged | P, L | done; Desktop surfaces → S8 |
| S5 | Official marketplace = reviewed list in oats repo | ✅ D4 merged · ✅ `oats.framework` 1.1.1 listed (`oats.core`, `oats.setup`, `oats.knowledge-theory` aliases) | M | Desktop view → S8 |
| S6 | Five expert souls created in the oats repo (`souls/<name>/`) | ✅ five + `oats-setup-expert` on main, all declaring `oats.core`, exported + imported | M, L, lead | legacy `agents/` cutover after S7 proof |
| S7 | Centralised per-soul knowledge in `oats-knowledge` (migration + PR-only learning) | ✅ **repo PUBLIC; PR #1 merged → main 8d67eab4, 25 accepted concepts**, owners = published souls, validator pinned OKF 2.1.1 · 🔄 fresh-reader proof assigned to Juan's side · ⬜ legacy in-soul knowledge decommission | lead, Antares/Juan | fresh-reader + PR-learning proof; then retire `agents/*/soul/knowledge` |
| S8 | Desktop parity (marketplace view, soul creation with `oats.core`, onboarding flow) | ⬜ after D3 · **host offered: Juan's machine (has `claude`)** — accepted | fresh Desktop engineer on Juan's host | brief + spawn params after D3 |

## S1 — Knowledge capability contract rework
- ✅ Provider-neutral contract, binding wire v1, helper/input contract, retained execution: OATS 0.24.0 + OKF 2.1.0 (f20f8e57) published.
- ✅ **oats-okf PR4 merged (9f90ee9) → OKF v2.1.1 (01b48dfc)**: Claude/Codex helpers with complete approved closure accepted; strict-Pi unchanged. Framework mirror/inventory finalized, catalog ref and `souls/oats-expert` source → v2.1.1 (16c5c939, 87292f40).
- Open: strict-Pi "enriched profile" remains unqualified (documented, not hidden).

## S2 — Workspace adoption of the OATS repos
- ✅ **PR23 merged f6d5a89b**: `oats-workspace.yaml` (7 members, `imports: []`), `oats.yaml` (exports souls/oats-expert, oats-package, capabilities/oats-authoring), transitional `souls/oats-expert/` edition, `docs/workspace-adoption.md`, layout tests.
- ✅ **PR24 merged da38e5a9**: deletion of `skills/oats-portable-setup` + `oats inspect --request` read-only seam (ACCEPTED as the public inspection route); full gate 1621/0.
- ✅ Member `oats.yaml` merged to main: oats-okf #3 (fec78a20), oats-aweb #1 (069ea2f6), oats-authoring #1 (54183a6a), oats-jira #1 (2f855daf).
- ✅ oats-dev#1 (main 6e164ee3) and oats-linear#1 (main a2121e48) merged after Juan granted write access — M's exact commits 0434f4ef / 8c183c37.
- ⬜ `imports:` pin of `souls/oats-expert` at its published revision (after member indexes).
- ⬜ Fresh local deployment from the shared definition (P1.5) — the real acceptance gate.

## S2 — second-operator gate report (Antares, Juan's machine, 2026-09-20)
Fresh dir, local `@awebai/oats@0.24.1`, no prior state. `inspect --request` → ready-for-preparation, membership eligible, source `souls/oats-kernel-expert@caa341f3`. `prepare` resolved and materialized `oats-package@caa341f3`, `oats.okf@v2.1.1`, `oats.aweb@v1.10.3`, `oats.core`, `oats.setup`, `oats.knowledge-theory` + soul; artifact-set approvals worked. Terminal: `needs-configuration` + `provider-not-qualified` (aweb 1.10.3 has no binding interface) — expected. Seams — **all fixed in PR36 (913c4f9e), shipped in 0.24.3**:
1. `inspect --request` requires `workTarget`; `prepare --request` refuses it (`buildFreshPreparationRequest` exists but the CLI never uses it).
2. `prepare` on the absent deployment inspect blessed → raw `ENOENT` + host path through the JSON envelope.
3. `prepare` writes lock v3; `oats trust <cap> --dir` rejects it (`unsupported lockfileVersion 3`) → dead end from `--help`.
4. The working `trust --deployment --artifact-set <sha256>` route is absent from `--help`.
5. Problems carry `origins: []` and no slot/capability, so with more than one unresolved slot the operator cannot tell which slot a `needs-configuration` refers to (Antares needed three runs and an ablation table). **Root cause of the original identical pair (L's trace, confirmed by P and by Antares' settings-aware run):** both OKF `normalize` calls refused because the request had no OKF runtime settings (`bindings-file`, `state-dir`); the identical pair is correct output for that input. With settings, OKF normalize diagnostics DO reach the operator (a malformed `acceptedBranch` yields a distinct `invalid-binding`); a structurally valid locator to a nonexistent repo is correctly not distinguished until OKF `check`. Fix (0.24.3, PR36) = attribution by slot/capability/phase/origins + kernel-fixed messages. Precision: the kernel names the missing item only where it knows it (missing binding interface: id/version/slot); for a provider `needs-configuration` it cannot name `bindings-file`/`state-dir` because OKF 2.1.1's wire is code-only — OKF 2.1.2 (assigned to P) adds the fixed safe message naming the setting. Antares' earlier "no signal at all" framing is withdrawn by its author.

## S2 — second-operator re-run on 0.24.2 (Antares, Juan's machine, 2026-09-21)
- Found the five expert imports still pinned at `caa341f3` (aweb 1.10.3) while the setup expert was at `0aad753c` — the one repinned soul was the one that never exercises aweb. Fixed: all six imports at v0.24.3 `3156e4de` (638206b9); new layout guard fails when a pin's provider requirements lag the current edition (3ce40aaa, verified to catch the miss).
- **aweb 1.11.0 qualifies**: via the direct source route on current main, `provider-not-qualified` disappeared → `approval-required` → after approval both slots on the settings hold. Confirms L's root cause.
- `oats onboard --workspace git:github.com/awebai/oats` from a fresh dir: clean (acquired 1.1.1, both caps, spawn printed not run); scaffold composed exactly the five capability skills, both trusted, no hooks.
- Seams 1–5 reproduced identically on 0.24.2 (baseline); fixed in 0.24.3. Gate decisions given: `harvest-model` arbitrary for the gate; aweb slot `delivery: session` without a private-team binding → expected typed `needs-configuration` naming the binding (Juan's team identity is never guessed).

## S2 — settings-aware run (Antares, direct source route on main, aweb 1.11.0, 2026-09-21)
- With `bindings-file`/`state-dir`/`harvest-runtime: pi` and the public `oats-knowledge` bound as base `oats`: **the knowledge slot binds** (OKF problem gone). `harvest-model` is optional per manifest; aweb 1.11.0 declares exactly one setting (`delivery`).
- **aweb 1.11.0 is the only remaining hold** (`needs-configuration`, identical for `delivery: session` and `channel` on 0.24.2's unattributed output). No resolution publishes → OKF `check` probe not reachable yet. 0.24.3 run will show the attributed aweb message (expected: private-team binding / Pi session-input).

## S2 — 0.24.3 gate run (Antares, Juan's machine, 2026-09-21) — verdict
- Seams 1, 3, 4 **fixed**; seam 2 fixed as typed (message does not echo the path — deliberate, consistent with no host diagnostics; expectation corrected); seam 5 **half**: attribution (slot/capability/full origins) fixed; naming the missing item only where the kernel knows it. The specificity half is provider-side: OKF 2.1.2 (assigned) and an aweb follow-up.
- Six imports resolve at the repinned revision; workspace route selects aweb 1.11.0; **the knowledge slot fully resolves through the workspace route** with `bindings-file`/`state-dir`/`harvest-runtime` (`harvest-model` confirmed optional).
- **Messaging was a SOURCE defect, not an operator gap**: aweb 1.11.0 normalize requires the workspace to declare `teams: {private: per-human}` and the soul a messaging declaration; neither was published, so the slot was unreachable by any input. Fixed on main **906b1558** (workspace policy + `teams: []` on the five messaging editions; verified against aweb v1.11.0 normalize) and imports repinned **f3ee31e0**. Remaining operator inputs after the fix: `responsibleHuman` (required) and `wider` (required, may be empty) — the private team is a later `check` outcome.
- **S2 exit-gate verdict (amended per the operator):** knowledge — an outside operator on 0.24.3 discovers, resolves, approves and binds from public sources, remaining item attributed: **PASS**. Messaging — on 0.24.3 as published the operator hit a source defect wearing a configuration error; fixed on main 906b1558 and to be re-proven on the repinned imports before it is written as PASS.
- **Re-run on 906b1558 (operator, b875669f):** messaging normalize passes; remaining problem is `responsibleHuman`, attributed. But end-to-end is **deadlocked**: `wider: []` (messaging requires) makes OKF 2.1.1 return `invalid-binding` on knowledge (it validates every `operator.bindings` key as a store locator); without it messaging needs `wider`. Operator's wording adopted for S2: *a second operator reaches a published, resolvable configuration boundary for knowledge; messaging is blocked by a kernel-level binding-namespace collision, not by operator input or identity.* Not Juan's to unblock; no identity requested. [Decision](https://github.com/awebai/oats/blob/main/agents/oats-expert/soul/knowledge/decisions/operator-bindings-ownership.md): flat map with declared ownership (`binding.keys`); providers ignore foreign keys (OKF 2.1.2, aweb 1.11.1); kernel attributes/refuses stray keys by name — **deferred to 0.25 by L's scope call (accepted): overlap refusal, filtered forwarding, owned/unowned attribution and the undeclared-provider path need their own regression matrix; the provider ignore rule is the floor and ships in 0.24.4's provider releases.**
- ✅ **PR41 merged `ef211d3e`** (L): inspect accepts prepare's superset (`ignored`), provider reasons cross the wire by exact match (manifest `binding.reasons` / bundled lists), `binding.keys` shape-only, CLI renders `key`. Full gate 1657/1653/0/4 twice (L + maintainer). → ✅ **v0.24.4 PUBLISHED** (npm both packages, GH release 7 assets, tarball probe: installed validator accepts `binding.reasons`/`keys`, `inspect --request` accepts `operator`/`launch`), kernel-first; OKF 2.1.2 / aweb 1.11.1 floor `>=0.24.4` (closed validator on ≤0.24.3 rejects the fields — P's finding).
- Two further kernel findings from the repeat (assigned to L, 0.24.4): (a) seam 1 converged one way only — `inspect --request` still refuses prepare's `operator`/`launch`; (b) **the kernel discards the adapter's reason** at the wire (`provider-binding-wire.mjs:23`) and templates it; aweb already sends whitelisted safe reasons. New [decision](https://github.com/awebai/oats/blob/main/agents/oats-expert/soul/knowledge/decisions/provider-problem-reasons-cross-the-wire.md): whitelisted fixed reasons cross the wire (`binding.reasons`), free text still refused.

## S3 — Messaging (aweb) on the new infrastructure
- ✅ **aweb PR3 merged → v1.11.0 (93f8ab96)**: `binding {normalize,bind,check}` on the existing wire; `check` = HOME-route operational custody only (explicit private team, `delivery: session`, kernel ≥0.24.2 via caller-owned `OATS_CLI_BIN`, retained `launchSelection` must be input-capable Claude/Codex; strict-Pi print → `needs-configuration`, never downgraded). Native adapter over existing `aw` commands with physical identity-dir custody and redacted tokens. Standalone 30/0; coupling 14/0 vs kernel b92f0d07. PR33 (launchSelection projection, OATS_CLI_BIN in codec env) merged b92f0d07.
- Facts: released aweb 1.10.3 has no binding interface; broker refuses. aw 1.36.1 broker calls `oats session inspect/input --home H`; never restarts stopped runtime; strict-Pi print mode can't take session input.
- 🔄 oats-aweb **PR2** codec (165b20e) + uncommitted `lib/captured-execution.mjs` (6/6).
- ✅ Lead answered (d9d912a4): pilot primary = Pi strict print host explicit model; helper = Pi sole-OKF (Claude/Codex allowed by 2.1.1); authority = existing HOME route + L's custody fix, gated on `oats >=0.24.1`; no new grant mechanism. P delivers aweb 1.11.0 PR. 
- ✅ **PR27 merged (5af848fc)**: HOME-only session route applies existing captured custody; refuses before transport on drift. Full gate 1626/1632 (2 pre-existing env failures reproduced on main). Ships in **v0.24.1** — the kernel floor the aweb adapter gates on.

## S4 — `oats.core` / `oats.setup` / onboarding
- ✅ **D3 merged PR35 (37c5c012)**: `oats onboard` classic local bootstrap; edition `souls/oats-setup-expert` (core+setup, provider defaults `none`, no knowledge owner). Full gate 1639/0. Live: onboard → acquire `oats.framework` 1.1.1 @0aad753c → soul declares both caps at that commit → scaffold-only spawn composes exactly `oats-operate, oats-souls, oats-config, oats-packages, oats-workspace-setup` + the `oats.core` injection, no legacy kernel skills. Baseline hygiene fixed on main (a96f24df).
- ✅ **D1 merged PR28 (70b10822)**, distribution tag `oats-framework/v1.1.0` on 9930dcfb; **D2 merged PR29 (9930dcfb)** full gate 1634/0. Verified live: `oats create` writes `requires.capabilities.oats.core` with the catalog source; `oats install oats.framework` acquires all three capabilities from the tag.
- ✅ Decision + plan D1–D4 on main 18af53be; docs reference as accepted-not-shipped.
- 🔄 **D1** (P, started 16:29Z; package identity confirmed: rename distribution package to `oats.framework` 1.1.0, capabilities 1.0.0, `oats.knowledge-theory` unchanged) package `oats.core` (`oats-operate`, `oats-souls`, oats.md injection) and `oats.setup` (oats-config, oats-packages, adoption guidance) under `oats-package/capabilities/`. Owner P.
- 🔄 **D2** (L, after custody fix) soul creation writes explicit `requires.capabilities.oats.core`; kernel skill list de-ambiented (one-release coexistence); checked-in souls updated. Owner L.
- 🔄 **D3** (L, in progress) onboarding creates `oats-setup-expert` (edition in `souls/`); CLI verb **`oats onboard`** — `oats setup` is already the record capture-setup command and stays untouched.
- Exit: fresh onboarding → running setup expert; created soul shows `oats.core`; kernel ships no ambient operational skill.

## S5 — Official marketplace
- ✅ Mechanism exists (`package-catalog.json`, `officialPackageCatalog()`); decision names it the official list.
- ✅ **D4 merged PR26 (786490ae)**: `docs/official-marketplace.md`, `package-catalog.json` policy pointer (inert to the reader), README/packages/capabilities links, D3 sketch in adoption guide. ⬜ entries for `oats.core`/`oats.setup` at D1 release. Desktop view → S8.

## S6 — Five expert souls in the oats repo
- ✅ **PR30 merged (40a579dc)** + maintainer follow-up **caa341f3**: all five declare `oats.core: {source: repo:oats-package}`, oats.okf@v2.1.1; `oats.yaml` exports all five; `oats-workspace.yaml` imports all five at caa341f3 (375b9f42). Live inspection against published main resolves them.
- Roster (decided): `oats-expert`, `oats-kernel-expert`, `oats-desktop-expert`, `market-research-expert`, `oats-assistant`.
- 🟡 Candidate: `expert-roster` worktree (b5e233b9 + 519 uncommitted changes: five `agents/<name>/soul/` + legacy roster deletions). Reviewed earlier; NOT committed.
- ✅ `souls/oats-expert` transitional edition on main already declares owns/reads for the five nodes.
- 🔄 Assigned to M (17:05Z): create `souls/<name>/` editions for the other four from the candidate; each declares `oats.core` explicitly (S4 rule) + `oats.okf`/`oats.aweb` sources; export in `oats.yaml`. Legacy `agents/` roster retirement is a separate, later cutover.

## S7 — Centralised knowledge in `oats-knowledge`
- ✅ Juan made the repo PUBLIC (2026-09-20). Bootstrap history pushed to main; **PR #1 merged (8d67eab4)**: 25 curated concepts, roadmap re-verified to the 0.24.1 baseline and 2026-09-20 decisions, validator pinned to OKF v2.1.1, strict OKF 25/0/0, ownership tests 24/24.
- 🟡 Curated corpus: 35 concepts (five nodes) on local `curation/expert-knowledge` in `/Users/pepe-reyero/OATS-workspace/oats-knowledge`, **uncommitted**. Bootstrap + one PR-only harvest already proven on `josep-reyero/oats-knowledge` (3 commits).
- ⛔ Target `awebai/oats-knowledge` is EMPTY and PRIVATE; **visibility undecided** (stated requirement: public). Human decision needed before publishing.
- ⬜ Then: push bootstrap + curation as PR to awebai; bind `stores.oats` in the pilot deployment; prove fresh-reader + Git-PR learning with the new souls; retire old in-soul knowledge (`agents/*/soul/knowledge`) as a final cutover.

## S8 — Desktop parity
- Finding (L, D2 audit): the Desktop server has **no soul-creation endpoint** today (roster reads, existing-soul edits/capability operations, instance spawn only). Soul creation with explicit `oats.core`, the marketplace view and the onboarding flow are new Desktop features, not wiring.
- ⬜ After S4/S5: official marketplace view/search; soul creation showing `oats.core`; onboarding flow; redesign parity vs `Oats UX Redesign and Desktop Discovery (1)`.
- ⛔ Fresh `oats-desktop-engineer` not spawned: `claude` not on PATH → choose Pi/Codex or install (human).

## Blockers needing the human
- ~~oats-knowledge visibility~~ → PUBLIC (Juan). ~~oats-dev/oats-linear access~~ → granted, indexes merged. ~~Desktop runtime~~ → Juan's machine hosts the Desktop lane (has `claude`).
- None open at 23:10Z. Juan's side (Antares) takes: (a) fresh-deployment gate P1.5, (c) fresh-reader proof, (b) Desktop host after D3.

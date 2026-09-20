# OATS redesign — program board

**Purpose:** the one accurate view of every work stream in the redesign, what is on main, what is in flight, who owns it, and what blocks it. Lead: `oats-expert` (redesign lead). Updated whenever anything merges, is returned, or reality changes. Older per-lane boards are superseded by this file.

**Last update:** 2026-09-20 17:40Z · main `87292f40` · OKF `v2.1.1`

Legend: ✅ on main/published · 🔄 in flight (PR/branch) · 🟡 preserved, not adopted · ⬜ not started · ⛔ blocked

## Streams at a glance

| # | Stream | State | Owner | Next action |
|---|---|---|---|---|
| S1 | Knowledge capability contract rework (kernel↔provider boundary, OKF 2.x) | ✅ shipped 0.24 / **OKF 2.1.1 released** (PR4 merged; mirror, catalog ref, soul source bumped) | P | done for this phase; OATS 0.24.1 cut after L's custody fix |
| S2 | Workspace/Portable Souls adoption of the OATS repos | ✅ PR23 + PR24 merged · ✅ member `oats.yaml` on main in oats-okf/aweb/authoring/jira · ⛔ oats-dev, oats-linear (no push access, human) | M, L, lead | human grants access → push 0434f4ef/8c183c37; then pin imports; then fresh deployment gate |
| S3 | Messaging capability readiness on the new infrastructure (aweb) | 🔄 codec PR2 + custody WIP · needs profile pin | P | lead pins pilot profile + answers authority question |
| S4 | Official capabilities `oats.core` / `oats.setup` + explicit default + onboarding `oats-setup-expert` | 🔄 D1 in progress (P, `feat/d1-oats-core-setup`, package → `oats.framework` 1.1.0) · 🔄 D2 in progress (L) · ⬜ D3 | P (D1), L (D2, D3) | review D1/D2 PRs; assign D3 after D2 |
| S5 | Official marketplace = reviewed list in oats repo | ✅ D4 merged PR26 (`docs/official-marketplace.md`, policy pointer) · ⬜ `oats.core`/`oats.setup` entries after D1 release | M | add entries at D1 release |
| S6 | Five expert souls created in the oats repo (`souls/<name>/`) | 🔄 assigned to M (`feat/s6-expert-soul-editions`) from the reviewed candidate; `souls/oats-expert` on main | M | review PR; `oats.core` follow-up after D1 |
| S7 | Centralised per-soul knowledge in `oats-knowledge` (migration + PR-only learning) | 🟡 35 curated concepts uncommitted on local `curation/expert-knowledge`; bootstrap proven on personal repo; `awebai/oats-knowledge` EMPTY, private | lead + human (visibility) | decide visibility; publish curation as PR; point souls' `stores.oats` at it |
| S8 | Desktop parity (marketplace view, soul creation with `oats.core`, onboarding flow) | ⬜ after S4/S5 | fresh Desktop engineer (blocked: `claude` absent) | pick runtime; spawn |

## S1 — Knowledge capability contract rework
- ✅ Provider-neutral contract, binding wire v1, helper/input contract, retained execution: OATS 0.24.0 + OKF 2.1.0 (f20f8e57) published.
- ✅ **oats-okf PR4 merged (9f90ee9) → OKF v2.1.1 (01b48dfc)**: Claude/Codex helpers with complete approved closure accepted; strict-Pi unchanged. Framework mirror/inventory finalized, catalog ref and `souls/oats-expert` source → v2.1.1 (16c5c939, 87292f40).
- Open: strict-Pi "enriched profile" remains unqualified (documented, not hidden).

## S2 — Workspace adoption of the OATS repos
- ✅ **PR23 merged f6d5a89b**: `oats-workspace.yaml` (7 members, `imports: []`), `oats.yaml` (exports souls/oats-expert, oats-package, capabilities/oats-authoring), transitional `souls/oats-expert/` edition, `docs/workspace-adoption.md`, layout tests.
- ✅ **PR24 merged da38e5a9**: deletion of `skills/oats-portable-setup` + `oats inspect --request` read-only seam (ACCEPTED as the public inspection route); full gate 1621/0.
- ✅ Member `oats.yaml` merged to main: oats-okf #3 (fec78a20), oats-aweb #1 (069ea2f6), oats-authoring #1 (54183a6a), oats-jira #1 (2f855daf).
- ⛔ oats-dev (0434f4ef) and oats-linear (8c183c37): neither M nor the lead's GitHub account has push — **human must grant access or push**.
- ⬜ `imports:` pin of `souls/oats-expert` at its published revision (after member indexes).
- ⬜ Fresh local deployment from the shared definition (P1.5) — the real acceptance gate.

## S3 — Messaging (aweb) on the new infrastructure
- Facts: released aweb 1.10.3 has no binding interface; broker refuses. aw 1.36.1 broker calls `oats session inspect/input --home H`; never restarts stopped runtime; strict-Pi print mode can't take session input.
- 🔄 oats-aweb **PR2** codec (165b20e) + uncommitted `lib/captured-execution.mjs` (6/6).
- ✅ Lead answered (d9d912a4): pilot primary = Pi strict print host explicit model; helper = Pi sole-OKF (Claude/Codex allowed by 2.1.1); authority = existing HOME route + L's custody fix, gated on `oats >=0.24.1`; no new grant mechanism. P delivers aweb 1.11.0 PR. 
- 🔄 L finding c21e36ff accepted; fix assigned (L, `fix/home-route-captured-custody`): reuse `readCapturedInstanceAuthority` on the HOME-only route, refuse before transport.

## S4 — `oats.core` / `oats.setup` / onboarding
- ✅ Decision + plan D1–D4 on main 18af53be; docs reference as accepted-not-shipped.
- 🔄 **D1** (P, started 16:29Z; package identity confirmed: rename distribution package to `oats.framework` 1.1.0, capabilities 1.0.0, `oats.knowledge-theory` unchanged) package `oats.core` (`oats-operate`, `oats-souls`, oats.md injection) and `oats.setup` (oats-config, oats-packages, adoption guidance) under `oats-package/capabilities/`. Owner P.
- 🔄 **D2** (L, after custody fix) soul creation writes explicit `requires.capabilities.oats.core`; kernel skill list de-ambiented (one-release coexistence); checked-in souls updated. Owner L.
- ⬜ **D3** onboarding creates + instantiates `oats-setup-expert` (edition in `souls/`). Owner L (+M edition).
- Exit: fresh onboarding → running setup expert; created soul shows `oats.core`; kernel ships no ambient operational skill.

## S5 — Official marketplace
- ✅ Mechanism exists (`package-catalog.json`, `officialPackageCatalog()`); decision names it the official list.
- ✅ **D4 merged PR26 (786490ae)**: `docs/official-marketplace.md`, `package-catalog.json` policy pointer (inert to the reader), README/packages/capabilities links, D3 sketch in adoption guide. ⬜ entries for `oats.core`/`oats.setup` at D1 release. Desktop view → S8.

## S6 — Five expert souls in the oats repo
- Roster (decided): `oats-expert`, `oats-kernel-expert`, `oats-desktop-expert`, `market-research-expert`, `oats-assistant`.
- 🟡 Candidate: `expert-roster` worktree (b5e233b9 + 519 uncommitted changes: five `agents/<name>/soul/` + legacy roster deletions). Reviewed earlier; NOT committed.
- ✅ `souls/oats-expert` transitional edition on main already declares owns/reads for the five nodes.
- 🔄 Assigned to M (17:05Z): create `souls/<name>/` editions for the other four from the candidate; each declares `oats.core` explicitly (S4 rule) + `oats.okf`/`oats.aweb` sources; export in `oats.yaml`. Legacy `agents/` roster retirement is a separate, later cutover.

## S7 — Centralised knowledge in `oats-knowledge`
- 🟡 Curated corpus: 35 concepts (five nodes) on local `curation/expert-knowledge` in `/Users/pepe-reyero/OATS-workspace/oats-knowledge`, **uncommitted**. Bootstrap + one PR-only harvest already proven on `josep-reyero/oats-knowledge` (3 commits).
- ⛔ Target `awebai/oats-knowledge` is EMPTY and PRIVATE; **visibility undecided** (stated requirement: public). Human decision needed before publishing.
- ⬜ Then: push bootstrap + curation as PR to awebai; bind `stores.oats` in the pilot deployment; prove fresh-reader + Git-PR learning with the new souls; retire old in-soul knowledge (`agents/*/soul/knowledge`) as a final cutover.

## S8 — Desktop parity
- ⬜ After S4/S5: official marketplace view/search; soul creation showing `oats.core`; onboarding flow; redesign parity vs `Oats UX Redesign and Desktop Discovery (1)`.
- ⛔ Fresh `oats-desktop-engineer` not spawned: `claude` not on PATH → choose Pi/Codex or install (human).

## Blockers needing the human
1. `awebai/oats-knowledge` visibility (public vs private) — gates S7 publication.
2. Push access to `awebai/oats-dev` and `awebai/oats-linear` for `josep-reyero` (or human pushes M's exact commits 0434f4ef / 8c183c37 as `oats.yaml`) — gates S2 completion.
3. Desktop engineer runtime (Claude absent) — gates S8.

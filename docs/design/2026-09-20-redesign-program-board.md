# OATS redesign — program board

**Purpose:** the one accurate view of every work stream in the redesign, what is on main, what is in flight, who owns it, and what blocks it. Lead: `oats-expert` (redesign lead). Updated whenever anything merges, is returned, or reality changes. Older per-lane boards are superseded by this file.

**Last update:** 2026-09-20 21:30Z · main `375b9f42` · OATS **v0.24.1 published** · OKF `v2.1.1` · `oats-framework/v1.1.0`

Legend: ✅ on main/published · 🔄 in flight (PR/branch) · 🟡 preserved, not adopted · ⬜ not started · ⛔ blocked

## Streams at a glance

| # | Stream | State | Owner | Next action |
|---|---|---|---|---|
| S1 | Knowledge capability contract rework (kernel↔provider boundary, OKF 2.x) | ✅ OATS 0.24.1 / OKF 2.1.1 published | P | done for this phase |
| S2 | Workspace/Portable Souls adoption of the OATS repos | ✅ workspace + indexes + **five imports pinned** (375b9f42) · ✅ live `oats inspect --request` against published main → ready-for-preparation · ⛔ oats-dev, oats-linear indexes (no push access) | lead | human pushes bundles; fresh deployment prepare/approve/scaffold/start gate |
| S3 | Messaging capability readiness on the new infrastructure (aweb) | 🔄 P implementing aweb 1.11.0 adapter (codec + captured-execution + check) against kernel floor 0.24.1 | P | review aweb PR; release 1.11.0; bump catalog |
| S4 | Official capabilities `oats.core` / `oats.setup` + explicit default + onboarding `oats-setup-expert` | ✅ D1 merged (PR28) + tag `oats-framework/v1.1.0` · ✅ D2 merged (PR29): creation writes explicit removable `oats.core`; declared ⇒ no legacy kernel skills · ⬜ D3 onboarding | P, L | assign D3 to L now |
| S5 | Official marketplace = reviewed list in oats repo | ✅ D4 merged (PR26) · ✅ `oats.framework` listed with `oats.core`/`oats.setup`/`oats.knowledge-theory` aliases (42ad7e55); `oats install oats.framework` verified from the tag | M | Desktop view → S8 |
| S6 | Five expert souls created in the oats repo (`souls/<name>/`) | ✅ all five on main (PR30 + caa341f3): explicit `oats.core` (repo:oats-package), oats.okf@v2.1.1, exported + imported | M, lead | legacy `agents/` roster cutover after S7 |
| S7 | Centralised per-soul knowledge in `oats-knowledge` (migration + PR-only learning) | 🟡 35 curated concepts uncommitted locally; `awebai/oats-knowledge` EMPTY/private · ⛔ visibility undecided | lead + human | decide visibility → publish → bind `stores.oats` → fresh-reader proof |
| S8 | Desktop parity (marketplace view, soul creation with `oats.core`, onboarding flow) | ⬜ after S4/S5 | fresh Desktop engineer (blocked: `claude` absent) | pick runtime; spawn |

## S1 — Knowledge capability contract rework
- ✅ Provider-neutral contract, binding wire v1, helper/input contract, retained execution: OATS 0.24.0 + OKF 2.1.0 (f20f8e57) published.
- ✅ **oats-okf PR4 merged (9f90ee9) → OKF v2.1.1 (01b48dfc)**: Claude/Codex helpers with complete approved closure accepted; strict-Pi unchanged. Framework mirror/inventory finalized, catalog ref and `souls/oats-expert` source → v2.1.1 (16c5c939, 87292f40).
- Open: strict-Pi "enriched profile" remains unqualified (documented, not hidden).

## S2 — Workspace adoption of the OATS repos
- ✅ **PR23 merged f6d5a89b**: `oats-workspace.yaml` (7 members, `imports: []`), `oats.yaml` (exports souls/oats-expert, oats-package, capabilities/oats-authoring), transitional `souls/oats-expert/` edition, `docs/workspace-adoption.md`, layout tests.
- ✅ **PR24 merged da38e5a9**: deletion of `skills/oats-portable-setup` + `oats inspect --request` read-only seam (ACCEPTED as the public inspection route); full gate 1621/0.
- ✅ Member `oats.yaml` merged to main: oats-okf #3 (fec78a20), oats-aweb #1 (069ea2f6), oats-authoring #1 (54183a6a), oats-jira #1 (2f855daf).
- ⛔ oats-dev (0434f4ef) and oats-linear (8c183c37): neither M nor the lead's GitHub account has push — **human must grant access or push**; verified git bundles + instructions prepared by the lead (`parallel/member-index-bundles/` in the lead's instance home).
- ⬜ `imports:` pin of `souls/oats-expert` at its published revision (after member indexes).
- ⬜ Fresh local deployment from the shared definition (P1.5) — the real acceptance gate.

## S3 — Messaging (aweb) on the new infrastructure
- Facts: released aweb 1.10.3 has no binding interface; broker refuses. aw 1.36.1 broker calls `oats session inspect/input --home H`; never restarts stopped runtime; strict-Pi print mode can't take session input.
- 🔄 oats-aweb **PR2** codec (165b20e) + uncommitted `lib/captured-execution.mjs` (6/6).
- ✅ Lead answered (d9d912a4): pilot primary = Pi strict print host explicit model; helper = Pi sole-OKF (Claude/Codex allowed by 2.1.1); authority = existing HOME route + L's custody fix, gated on `oats >=0.24.1`; no new grant mechanism. P delivers aweb 1.11.0 PR. 
- ✅ **PR27 merged (5af848fc)**: HOME-only session route applies existing captured custody; refuses before transport on drift. Full gate 1626/1632 (2 pre-existing env failures reproduced on main). Ships in **v0.24.1** — the kernel floor the aweb adapter gates on.

## S4 — `oats.core` / `oats.setup` / onboarding
- ✅ **D1 merged PR28 (70b10822)**, distribution tag `oats-framework/v1.1.0` on 9930dcfb; **D2 merged PR29 (9930dcfb)** full gate 1634/0. Verified live: `oats create` writes `requires.capabilities.oats.core` with the catalog source; `oats install oats.framework` acquires all three capabilities from the tag.
- ✅ Decision + plan D1–D4 on main 18af53be; docs reference as accepted-not-shipped.
- 🔄 **D1** (P, started 16:29Z; package identity confirmed: rename distribution package to `oats.framework` 1.1.0, capabilities 1.0.0, `oats.knowledge-theory` unchanged) package `oats.core` (`oats-operate`, `oats-souls`, oats.md injection) and `oats.setup` (oats-config, oats-packages, adoption guidance) under `oats-package/capabilities/`. Owner P.
- 🔄 **D2** (L, after custody fix) soul creation writes explicit `requires.capabilities.oats.core`; kernel skill list de-ambiented (one-release coexistence); checked-in souls updated. Owner L.
- ⬜ **D3** onboarding creates + instantiates `oats-setup-expert` (edition in `souls/`). Owner L (+M edition).
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

# Phase D — the OATS project runs on the architecture it offers (plan)

**Status**: plan, 2026-09-24, lead. Decisions 18–22 of the workspace model, the
five-soul roster and its 2026-09-24 amendment, the human's sequencing
("knowledge centralisation first"; "do not retire live souls until their
instances retire"). Mailed to the human and the OSS coordinator before the
first swarm. Method per standing instruction: write → swarm build →
adversarial-review swarm → PR → main; releases under delegated authority.

## Co-leads and lanes (human, 2026-09-24)

The human made the two `oats-expert` instances — the redesign lead
(`oats-expert-knowledge-reworks`) and the maintainer of the second deployment
(`oats-expert-antares`) — **co-leads with equivalent authority**, who agree on
pushes. Agreed by both on 2026-09-24:

| Lane | Owner | Status |
|---|---|---|
| Desktop Phase F (engineer PRs, native gates) | lead | assigned |
| Kernel (`lib/`, `bin/`; kernel gaps raised by anyone) | lead | assigned |
| Releases 0.25.7 and D5 (catalog + 0.26.0) | lead | assigned |
| oats.aweb 1.13.0 re-land end to end | Antares | assigned |
| D1 operator node + integrations node | Antares | assigned (draft PR `d1/operator-node` handed over) |
| aweb and okf package-expert seams | Antares | assigned |
| D2, D3, D4, desktop + kernel bundle migrations (D1 remainder) | — | **unassigned**: offered to Antares; held for the second deployment's human, whose capacity it spends. If declined in whole or part, the co-leads split what remains. |

**Push protocol.**
- **Class A** — notify after, one line: stewardship, docs and knowledge inside
  one's own lane or node; merging a PR the other co-lead approved in writing;
  merging one's own lane's PR after the other co-lead's review; the bump PR of
  an agreed release.
- **Class B** — `PUSH INTENT: <what> @ <commit/PR>` → `ACK <message-id>` before
  acting: tags, releases, npm publishes, catalog pins; framework-behaviour
  changes (kernel semantics, OKF/memory contracts, workspace config semantics,
  published skills); merges into the other's lane; reverts, force-anything,
  branch or tag deletion. A blocking intent unanswered for about 45 minutes goes
  to the human, never to action.
- Every PR is reviewed by the co-lead who did not author it (a helper's PR is
  reviewed by its own lead, inside that lead's lane). A disagreement not settled
  in two mails goes to the human. Standing rules unchanged: PR CI is the full
  gate; published tags never move; no destructive git on shared checkouts.
- `main` on these repositories carries no branch or tag protection: the parity
  gate and the cross-review are the only things between a merge and `main`.

## Slices, in order

### D1 — Knowledge centralisation (IN PROGRESS)

Goal: every roster soul's knowledge lives in the central base
`awebai/oats-knowledge` (OKF 2.1.4), one owned node each; the in-repo
`agents/*/soul/knowledge` bundles stop receiving writes and are decommissioned
when no live instance links them.

Done: nodes `oats-operator-expert` and `integrations-expert` chartered
(oats-knowledge PR #3); eight attributed seeds landed in
`agents/oats-expert/soul/knowledge/inbox` (oats PR #121); the roster amendment
accepted; the rule "no per-soul knowledge merges" in force.

Work:
1. **Copy-migrate by judgement** (the 2026-09-21 method: two-part test plus the
   2026-09-24 recipe refinement; not copying): `agents/oats-expert/soul/knowledge`
   (~130 files) → node `oats-expert`; `agents/oats-desktop-engineer/soul/knowledge`
   (~120) → `oats-desktop-expert`; `agents/cli-dev/soul/knowledge` (~155) →
   `oats-kernel-expert`; `agents/integrations-expert/soul/knowledge` (13) →
   `integrations-expert`. Others (`dev-coordinator`, `docs-expert`, `ux-designer`,
   `lead`, `oats-coordinator`) are assessed for the few universal concepts they
   hold and otherwise not carried. One PR per node on oats-knowledge, reviewed
   by the lead; the OSS coordinator reviews the operator and integrations PRs.
2. **Seed the operator node** — attributed to `oats-expert-antares`:
   MOVE (not copy) from the oats-expert bundle: `lessons/the-aweb-team-root-must-sit-where-the-spawn-hook-looks`,
   `lessons/okf-state-directory-must-sit-outside-every-work-tree`,
   `lessons/capability-trust-hash-covers-the-installation-record`,
   `lessons/a-locally-minted-oats-identity-has-no-cross-team-first-contact-address`,
   `lessons/stale-checkout-serves-stale-soul`,
   `playbooks/rebuild-a-deployment-in-scratch-against-local-bare-remotes`;
   generalise the R1–R10 rebuild findings and the published-combination
   verifications from `stewardship/delivery-log` (the log keeps the record).
   From the inbox: `check-the-record-before-redesigning-identity`,
   `grant-custody-service-and-renewal-belong-on-the-custody-host` (operator
   half), `the-wake-broker-accepts-a-grant-home`.
3. **Seed the integrations node** — from the inbox:
   `a-merged-provider-payload-cannot-enforce-host-only-keys`,
   `aw-grant-commands-resolve-the-identity-from-cwd-only` (discipline half),
   `oats-runtime-requirements-for-grant-backed-resident-operation`; from the
   integrations-expert bundle: `fake-aw-must-model-real-refusals` and the rest
   of this week's harvested lessons.
4. **Route the remainder of the inbox**: aweb package expert (D3) gets
   `aweb-grants-are-team-bound-to-the-custody-identitys-active-team`,
   `a-grant-signed-send-must-name-the-subject-as-sender` and the aw halves;
   kernel expert gets `path-keyed-owner-registry-breaks-under-per-commit-soul-copies`.
5. **Rebind the souls** in `souls/<name>/`: the `knowledge:` grammar there is
   still 0.24's (`capability` + `source: git:…@v2.1.2#oats-package`); v2 is
   `capabilities: { oats.okf: { from: package } }` plus `okf.json`
   (`{ version: 1, owner: <node owner uuid>, owns: ["oats/<node>"], reads: [...] }`)
   and the store `oats` naming `awebai/oats-knowledge` / `knowledge` / `main`.
   Add `souls/oats-operator-expert` (rename of `oats-setup-expert`, keeps the
   `oats.setup` charter) and `souls/integrations-expert`.
6. **Do NOT delete** `agents/<n>/soul/knowledge` or the legacy souls while a
   live instance links them (human rule). Record which are live; decommission
   as they retire; new spawns use `souls/<n>`.
7. **Release playbook** (`oats-expert` node, stewardship area): landing order
   for provider PRs (tag → pin on the branch → squash; a bundled provider never
   lands ahead of its tag), the version literals to bump on a catalog bump,
   the mirror checker, the bump-PR step. First entries: today's two lessons.

### D2 — The OATS workspace as a v2 workspace (decisions 18, 19, 21)

`oats-workspace.yaml` at the `oats` repo (name `oats`; members = the seven
framework repos incl. `oats` itself; `packages:` = oats.framework / okf / aweb /
jira / linear / authoring / dev pinned from the catalog; `defaults.capabilities`
= `oats.core` from package + knowledge `oats.okf`); `oats-membership.yaml` ×7
(each package repo is a member AND a package publisher — non-collapse:
`packages:` resolves it as a package, membership only grants trust and a soul).
`package-catalog.json` stays the official marketplace (decision 21); the `oats`
repo keeps `oats-dev` as dev capabilities. A fresh deployment directory (asked
for, never named by convention — decision 9) is the acceptance: `oats onboard`
→ `sync` → `approve` → spawn every roster soul `--no-launch`.

### D3 — Souls to `souls/<name>` and the six package-expert souls (decision 20)

Each package repo carries `souls/<pkg>-expert` (okf-expert, aweb-expert,
jira-expert, linear-expert, authoring-expert, dev-expert), the expert in that
package, with a node in the central base from day one. **Seams named in the
charters** (roster amendment): `aweb-expert` READS
`aweb-protocol-expert` in base `aweb-oss-knowledge` (repo
`github.com/awebai/aweb`, root `knowledge/`, branch `main`, OKF 2.1.x
descriptor at `knowledge/okf-base.json`; owner `1913b77b-…`) through a
read-only store reference; `okf-expert` names its seam to the knowledge-theory
material in `oats-expert`. Whether the aweb bookshelf decisions the program
rests on are published into that node is the aweb side's call (asked).

### D4 — `oats.core` and `oats.setup` rewritten (decision 22, W9b)

Not patched: written for the v2 world. `oats.core`: home layout, `oats status`
with modules/soul/identity rows, spawn preview → apply, `sync --approve`, the
two-directory boundary, what a module is. `oats.setup` (held by
`oats-operator-expert`): onboarding that ASKS for the deployment directory and
the workspace URL, the hosting rule (decision 26), the public-member executable
rule, the rebuild guide as procedure with the operator node as rationale.
Developer souls in `oats.dev` gain `promotesTo: <node>` (roster amendment);
the harvester delivers to that node as a PR the owning expert reviews.

### D5 — Catalog update and 0.26.0

Catalog pins for the new package versions; **widen Desktop `ACCEPT_RANGE` and
the three pins FIRST** (minor bump rule); release notes; tag; the fresh
deployment from D2 rebuilt on the published artefacts by the OSS coordinator
(outsider verification) before the program board marks Phase D done.

## Adversarial review (per slice)

Each slice's swarm is followed by a review swarm with the standing lenses
(direction against the decisions; correctness by reproduction; security —
trust at acquisition, hoisted paths, hook approval, host-only keys; docs as
contract — every guide claim has a test), plus two Phase-D-specific ones: **the
outsider** (can a reader who was not in the room set OATS up from `oats.setup`
alone?) and **the seam** (does every cross-project read resolve to a real node
with a real owner?).

## Out of scope

Desktop (Phase F, its own boundary); oats.aweb 1.13.0 re-land (held on the
aweb release); legacy `~/OATS` deployment cutover (the operator's, on the
published 0.26.0).

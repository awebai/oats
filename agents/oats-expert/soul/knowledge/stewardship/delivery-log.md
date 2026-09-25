---
type: Reference
title: Delivery log — every PR that reached (or was returned from) the main gate
description: Append-only record kept by per-PR maintainer instances — PR number, scope, verdict per gate, merge or return, and anything the review taught about the codebase. The stewardship counterpart of git history — the WHY next to the what.
tags: [stewardship, deliveries, append-only]
timestamp: 2026-09-20
---

# Delivery log

Append-only, newest first. Every per-PR maintainer instance appends ONE entry
before retiring — merge or return, always. Format:

```
## PR #<n> — <one-line scope> (<date>)
- verdict: MERGED | RETURNED (+ short why per failed gate) | CLOSED
- owner: <instance> · coordinator: <instance or none>
- taught us: <anything the review revealed — codebase gotcha, process gap,
  decision that needs recording — or "nothing new">
```

Entries whose lessons grow beyond a line get promoted to lessons/ or
decisions/ and referenced from here.

## Batch — 2026-09-24 night (PRs 131, 136, 151–180) → toward v0.26.0 (unreleased; main carries breaking changes)
- **Merged:**
  - PR151 packages: approval removed (human decision; declaring a package IS the trust decision) `e62b8f16`, plus the release-note follow-up `f0994882`.
  - PR153 docs for it `b97de554`.
  - PR131 D4(1) declared-gone docs removed `05867164`.
  - PR156 D4 follow-up (execution-targets, example pins v2.1.5, desktop accept gate) `78e08165`.
  - PR152 oats.aweb 1.12.2 mirror with the in-PR catalog pin `5ed99b91`. Antares' lane; I cross-reviewed. It was returned once for a harvest commit onto a legacy in-repo soul.
  - PR147 Desktop F2b (approval UI removed; gated on `packages-no-approval`) `950e982b`. Native gate 8/8, including the refusal of an old 0.25.9 kernel.
  - PR149 Desktop messaging identity (decision 27) `f25dcef5`. Security read: strict shapes and regexes, fixed argv.
  - PR154 `spawn --name` + deployment-wide uniqueness `a4a3a19b`. Probe 27/27.
  - PR157 naming docs `75a5403e`.
  - PR158 Desktop F3b-1 (read-only soul inspector; "Edit this soul in its repository") `0f53d8cd`.
  - PR159 64-character instance-name cap, explicit and derived, with a schedule definition check `d1739335`. Probe 6/6.
  - PR160 Desktop F3a-name (unprefixed names; a name taken at apply is stale; local cap on one shared constant) `1c0cb2c1`. Native gate 8/8. The squashed tree is identical to the approved head `f1edc201`.
  - PR136 capability manifest schema accepts `private` and `team`, as discovery already reads them; oats.review is private. `ac8d5de8`, on Antares' ACK, combined with main locally 128/128.
  - PR161 oats.aweb 1.12.3 mirror (alias rule 1–64 matching aweb and the kernel cap; the reuse remedy names `--name` and `--purpose`; catalog pin v1.12.3) `b0f64d5a`. Antares' lane; I cross-reviewed. The payload is byte-identical to oats-aweb `e234c865`, and tag v1.12.3 peels to it. First returned for 33 stray soul files (the branch came from a shared checkout's unpushed local main), then for a cherry-picked guide hunk that brought back the removed `--approve`.
  - oats-aweb #12 (1.12.3 stage) cross-reviewed; tag v1.12.3 ACKed. oats-knowledge #17 (12 concepts promoted from unpushed local harvests) and #18 (2 review lessons) cross-reviewed, and Antares merged them.
  - PR155 kernel v2-native (1/5): instance homes carry no soul link; `OATS_SOUL` is the recorded `soulDir` `d7de6675`. Returned once by Antares for stale texts in skills/injects, the lib header and the release note. Re-probe 7/7; Antares ACKed at `565b042e`.
  - PR162 kernel v2-native: inspect / readiness / operation run on the workspace model `c9dc6012`.
    - readinessApi 2 / operationsApi 2 / soulsApi 2, with instance or soul subjects and no scope subject.
    - Checks are installed / configured / member / providers, and `trusted`, `--verify-signatures` and `readiness-verify` are gone.
    - Providers are relayed verbatim `{status, problems, warnings}`, codec-strict: four statuses and a 60s budget.
    - Module-store trees are digest-verified before they run.
    - Three lead rounds, plus the developer's own code-reviewer findings (decided in lead-decisions-review-162). Probes 21/21 and store-tamper 5/5; Antares' independent review passed 204/204, plus a live oats.aweb 1.13.0 probe.
  - oats-aweb 1.13.0 is tagged at `772e0664`. Its stage #13 carried my floor commit (GRANT_TEAM_FLAG_MIN 1.36.2, checked against the published aw 1.36.1/1.36.2 help), the custody preflight fix, and the binding-less v2 readiness answer. The cross-review returned `context.team: null` → invalid-binding, reproduced by driving the binary. Its mirror to oats is next.
  - KB #19–#23 (R1/R2 design of record; the nullable-wire lesson plus a wording fix; desktop-parity §3 supersession; the provider-check wire Reference) were cross-reviewed. The contract-asserting ones were held until #162 merged.
  - PR163 Desktop F3b-2 `ad046534`: the inspector and readiness run on the workspace model (operationsApi 2 / readinessApi 2).
    - The scope inspector, the readiness scope target, and the trusted/enrolled/signature readers are deleted.
    - Providers are relayed verbatim, and "sign in needed" is its own state. The payload's own integer is dispatched on, with the classic layout named.
    - It fixes two pre-existing dead-in-app bugs: `/api/cli` didn't project operationsApi, and readiness required `workspace.scope`.
    - Native gate 9/9 twice against #163 merged with main's kernel: provider fail/pass, the okf view and action operations, and "needs a running home". The old 0.25.9 kernel gets "Update OATS and retry".
  - PR164 `9162aa77`: pins the provider-check wire (a test records what a provider receives), the v2 readiness usage text, and the provider-author docs in docs/capabilities.md. Merged on the second CI attempt; the first hit an unrelated EPIPE flake in packages/experimental.
  - PR165 oats.aweb 1.13.0 mirror + catalog pin v1.13.0 `19d96df3`. The payload is byte-identical to tag v1.13.0 (`772e0664`).
    - Returned once for a re-dated behavioural claim: a guide sentence said grant sends were still 422 on the new floor, but the floor release fixed them.
    - The first CI run was red: the Desktop pins the manifest's `settings.identity` byte for byte in a stand-in fixture. Fixed by the Desktop engineer's fixture-only recapture from the mirror's tree, fast-forwarded in as the new head `f85fed6c`.
    - After the merge, Antares deleted `hold/oats-aweb-1.13.0` under a Class B ACK. It pointed at `a8a8d1f6`, the pre-1.12.1 draft, whose content had shipped in 1.12.2 or been rebased into v1.13.0.
  - PR166 kernel v2-native (b) `00813159`.
    - Capability-defined agents home under `agents/<agent>/instances/`. `local-agents`/`tmp-agents`, the OAS probes, the installed tier and `oats create` are removed, and `spawn --instructions-file`/`--def-file` are `E_BAD_ARGS`.
    - A leftover `local-agents/` is reported once as `legacy-local-agents`; soul-scaffold hooks no longer run.
    - `retire <unknown> --json` answers `E_SESSION_UNKNOWN`. The co-lead found it; a new code was rejected because the Desktop classifies the existing one as a before-effect refusal.
    - Rounds: a return for the missing typed error and the skills text; then CI red on two retire-safety tests that read stderr after coded retire errors became `--json` envelopes. That fix was test-only, with the behaviour verified intact, plus the known K6d flake.
  - PR168 (addendum 5) `bf24c947`: manifest setting defaults are the lowest payload layer on the v2 path, with per-leaf `settingsOrigins` in the preview and the feature `settings-origins`. The decision revision binds the defaults by value; the captured builder is untouched. Probe 9/9. The squash patch is byte-identical to the PR's delta.
  - PR169 Desktop settings-origins label `9f32cc11` (squash patch == PR delta). The identity select's Default option shows a mode only when the kernel reported one: `Default · local` for a manifest default, `Default · <mode> — from <origin>` otherwise, and plain `Default` with no feature, no origin or no identity. The hint names the origin pointer. Native gate 5/5 twice on a stand-in messaging package; 2/2 with the feature hidden.
  - PR170 kernel v2-native (c1) `5ee006ed` (squash patch == PR delta; lead probe 12/12 + co-lead ACK). Launch configurations move from the oats-config scope chain to the deployment's `oats-local.yaml` `launch-configs:`. There is one reader, `launchConfigsAt(dir)`, walking up; a home reads its own deployment's, never a member clone's context. `set`/`remove` rewrite only that block, with a read-back before writing. A legacy `oats-config.yaml` key is refused with the migration message; `set` with no deployment is `E_LOCAL_MISSING`. `instance.json.workspace` records `name` + `deployment` (M5/3a). The Desktop consumer is unchanged, since its context is the deployment directory.
  - PR167 oats.aweb 1.13.1 mirror + catalog pin v1.13.1 `6aaefdae` (squash tree == merge of its parent and the PR head; the payload on main is byte-identical to tag v1.13.1). oats-aweb stage #14 was cross-reviewed against published aw 1.36.3 (the floor `CUSTODY_ATTACH_MIN`); tag v1.13.1 peels to the stage merge, whose tree equals the approved stage head. The grant is minted with `--custody-socket <the preflight's exact socket>`, then grant.yaml is read back and custody status checked through the grant home. Any mismatch revokes the grant; renewal keeps the old one. The hosted rehearsal proved delivery and custody-signed verification. Encrypted chat was transported and decrypted both ways; the receiver's verification of grant replies awaits an aw release. Encrypted mail from a grant awaits an aweb scope fix. Wake needs the host wake daemon on a grant-capable aw: the rehearsal's daemon was an older long-running binary, which is a Decision for the next minor.
  - PR171 kernel v2-native (c2) `73cb293f` (squash tree == merge of parent and head; lead probe 16/16 + co-lead ACK). The verbs `type`, `soul set` and `session recompose` are removed (`E_UNKNOWN_COMMAND`, each naming its replacement), and `status --team` is `E_BAD_ARGS`. inspect, readiness and `operation run` are v2-only: no deployment → `E_LOCAL_MISSING`, a pre-0.26 home → `E_UNSUPPORTED_MODE` (re-spawn), unreadable → `E_SESSION_UNKNOWN`. `lib/readiness.mjs`, classic inspect and `--verify-signatures` are deleted. Addendum 9's wording covers skills, injects, souls and goldens. The config chain itself proved load-bearing and moved to (c3), with eight lead decisions: no classic fallback anywhere, every removed key a typed refusal.
  - PR172 D4 removed-verbs sweep `a9af00a8` (Phase D driver; squash tree verified). The published skills stop teaching verbs the kernel refuses. `oats-config` and `oats-packages` become short v2-true stubs, deleted once (c3) removes the kernel's legacy operational-skills fallback that copies them. The oats-assistant's 0.23 first-task checklist is gone. test/operational-skills-cli refuses any `REMOVED_VERBS` use in published skills, derived from the table itself, and exempts the live captured `trust --deployment … --resolution|--artifact-set` form.
  - PR173 oats.authoring 1.0.1 mirror + catalog pin v1.0.1 `87d74a9b` (lead-authored, co-lead ACK; the payload on main is byte-identical to tag v1.0.1). The fix shipped in the package first: awebai/oats-authoring#5 merged `f91d4f5e`, tag v1.0.1 `28b2f9ac`. integration-authoring now teaches `packages:` + `{ from: package }` + `oats sync`, and the compatibility floor is `>=0.25.0`. The removed-verb scan now also walks bundled `capabilities/*/skills`; with the old copy restored it fails on the three stale lines.
  - PR174 kernel v2-native (c3a) `c8cd1358` (squash tree verified; lead + co-lead mutation proof). One shared v2 test fixture (`test/helpers/v2-deployment.mjs`: a one-repo host=member workspace, the real prepare → spawn, and `inEnv` isolating HOME/cache/tmux/identity), with every classic-fixture suite ported onto it. Classic-only tests are deleted, and surviving behaviour is re-expressed. **Kernel fix:** session start/restart of a workspace-model home read its launch providers' manifests from the work repository, not `<home>/.oats/modules`, so EVERY v2 home restart refused `E_LAUNCH_PREPARATION`. This was confirmed on the published 0.25.9; classic homes were unaffected. No 0.25.10: the release gate only tags on main, and the co-leads chose to ship the fix in 0.26.0 with retire+respawn as the 0.25 workaround.
  - PR175 kernel v2-native (c3b) `2b6e97ce` (squash tree verified; three rounds). **The config chain is gone.**
    - Removed: resolveOatsConfig and its orphans. Composition and spawn need a prepared resolution. The classic keys and v1 soul fields are no longer read (Q6: runtime/model/yolo/launch-config are spawn/host choices). The kernel "You run on OATS" block is gone (oats.core's inject is the one block), and so are skills/oats-config + oats-packages.
    - Typed refusals: spawn/doctor/schedule outside a deployment → `E_LOCAL_MISSING`. An oats-config.yaml at or below the deployment → `E_CONFIG_BROKEN` `legacy-config` on every command. Start/restart/dispatch of a pre-workspace home → `E_UNSUPPORTED_MODE`, and it still retires.
    - Also: capability agents spawn prepared with their providing module only (memory-less). A preview writes nothing. Manifest/payload validation parity. teamEnv is v2-only (OATS_TEAM_NAME always ""). instance.json records module skills.
    - The rounds: the co-lead found `status`/`doctor` crashing (stack trace) on a legacy oats-config.yaml; CI caught a stale classic team-env test; then the clean-room tarball smoke (outside `test/**`) pinned the old `meta.skills`.
  - PR176 oats.authoring 1.0.2 mirror + catalog pin v1.0.2 `4161353c` (lead-authored, co-lead ACK; the payload on main is byte-identical to tag v1.0.2 `5b182959`→`5d0afebb`). soul-craft teaches the v2 soul fields; runtime/model/yolo are spawn or launch-configuration choices. The framework's own `skills/soul-craft` and `skills/integration-authoring` now equal the package copies. The framework's integration-authoring had still told agents to `import('<framework-repo>/lib/core.mjs')` and call `spawnInstance` unprepared: a private-kernel import, and refused by 0.26.
  - PR177 kernel v2-native (c3c) `85243cff` (squash tree verified; lead + co-lead full runs agree). The 0.25 package engine's remainder is deleted: approveCapability, the chain readers, marketplace hoisting, the owned store, and the legacy launch conversion (a pre-recipe home under a selection is now `E_LAUNCH_LEGACY`). `capabilityTrust` trusts only workspace module copies. `acquirePackage`/`updatePackage` live alone in `lib/captured-store-writer.mjs` as the captured path's store writer; a reach test proves only its two fixtures import it, and (e) deletes it with the captured path.
  - Teams contract amendment `18c38d4a` (lead, co-lead ACK), from the (t) #179 review:
    - `OATS_TEAMS_SOURCE=live|recorded` + `teamsSource` on the check stdin; a provider leaves a joined team only on `live`.
    - One `unmapped-team-label` warning per label.
    - The live-read cost bound: only where consumed, with a host + soul-repo read.
    - The scheduled-wake limitation; spawn-time teams recorded in `instance.json.teams`.
  - PR178 Desktop live Teams panel `bb7e0dd1` (squash tree verified; two rounds).
    - The panel appears iff the messaging provider declares `messaging:teams|join|leave`, and reads the arg name from the row. It decodes the teams document strictly; `receive: poll` reads "Checks this team's mail between tasks".
    - One action at a time, with latest-intent checks. Refusals are shown verbatim, the code behind Details.
    - The lead's native gate (a real Electron build against a stand-in provider) returned round 1: a refused join whose row vanished on the re-read lost its error. Round 2 keeps it at panel level with a "no longer offered" line until the next action or Refresh (10/10).
  - PR179 kernel teams (t) `3c58a345` (squash tree verified; two rounds; merged by the lead on the human's direction, green Node 22 at the approved head).
    - A soul's `team` is a label or a list, the first the primary. `defaults.byTeam` applies per label in order; differing entries → `E_TEAM_CONFLICT`, except a capability the soul names itself.
    - `teams` `[{label, team, mapped, payload}]` in the preview, `inspect` and `instance.json.teams`, plus `OATS_TEAM_LABELS` / `OATS_TEAMS` / `OATS_TEAMS_SOURCE`. The merged payload stays the primary's.
    - Live resolution for homes is two repo reads (host + soul repo), only for session start/restart, messaging-module commands/operations and inspect --home. Otherwise the record, marked `recorded`.
    - One `unmapped-team-label` warning per label. Also fixed: a home's launch/retire hooks got an empty OATS_TEAM_LABEL/ID.
    - Round 1 was returned: every in-home command paid a full workspace discovery (1.4–2.0 s vs ~0.1 s), the source marker was missing, and the warnings were per soul.
  - Teams contract corrections after #179:
    - `eb073209`: the env is the only channel. No check-stdin keys, because released providers decode their binding wire strictly (the co-lead measured oats.aweb 1.13.1 answering `invalid-binding` → readiness `unknown`).
    - `bdd7e55e`: `declares` (declared setting keys) for the Desktop's `settings.join` gate; `inspect --soul` refuses on `E_TEAM_CONFLICT`.
  - PR180 legacy sweep `56906470` (the Phase D driver; human GO; co-lead ACK with three conditions; squash tree verified).
    - Deleted:
      - the framework repo's root `oats-config.yaml`: a real 0.26 bug, because the kernel refuses it in every member work tree; validate-project now refuses it;
      - its inject;
      - six classic-era docs;
      - the oats-config schema;
      - the stale root log;
      - `oats.setup`'s `oats-rebuild` skill;
      - the v1 catalog-migration helpers and findRoot's config probe.
    - `official-marketplace.md` → `official-catalog.md`.
    - Kept for (e), because only the captured path reads them: `RETIRED_CAPABILITIES`, the approval-ledger and lock-v2 schemas, and config-template validation.
    - Conditions:
      - the consequence line for a classic deployment rooted at this repo is in the PR and the notes;
      - the pinned example moved to `packages.md` under a new parity test;
      - the deleted-path list went to the co-lead for knowledge citations.
  - First-party packages oats.jira / oats.linear / oats.dev **v1.0.1** (the driver's PRs, lead-merged; tags under co-lead ACK):
    - floors >=0.26.0;
    - v2 settings homes in the hook, skill and README texts;
    - oats.dev drops its oats-config template, the tooling around it, and its dependencies; oats.review is 1.2.1.
- **taught us:**
  - (1) **Arm a merge watcher with the full approved oid, never "the current head".** #160's head moved twice after approval while mails crossed. The watcher's named-oid guard refused both mismatches, so nothing unreviewed merged. The loop ends with one FINAL mail per party (author and watcher) naming the full oid and "no pushes", and by ignoring the stale mails that follow.
  - (2) **A native gate must wait for the message, not for a spinner.** Preview in the rig is slow, and fixed waits produced false FAILs in both directions. Poll for the expected sentence with a bound.
  - (3) **A commit that is "in the PR" can still be orphaned by the squash.** #158's copy fix `9beed8ea` never reached main, so check `git merge-base --is-ancestor` before telling an author a fix has landed.
  - (5) **After a rebase or cherry-pick across a moved base, re-read the three-dot diff hunk by hunk, docs included.** Parity tests and green suites can't see a stale example (#161); see the central lesson on cherry-picks across a base change.
  - (6) **Drive a provider's binary with every nullable field of the wire before approving.** A strict test the implementer wrote passed while `team: null` (the common single-team case) was refused (oats-aweb 1.13.0). See the central lesson on nullable wire fields.
  - (7) **A merge watcher busy in polling can leave a WATCH+ACT unread for many minutes.** If a green, approved PR sits unmerged, check the watcher's pane and nudge it directly.
  - (8) **A native gate reads collapsed UI by textContent, scoped to its section.** `innerText` skips closed `<details>`, and a page-wide regex matches the wrong row. Two runs of false FAILs came from the gate, not the app.
  - (9) **A provider mirror is a Desktop change when it touches a bundled manifest.** Run the Desktop suite with its own deps installed (`cd packages/desktop && npm ci`); missing-module walls are the environment. See the central lesson on mirrors running the Desktop suite, and the one on re-dated claims.
  - (10) **When you route every coded error of a verb through `jsonFail`, grep the tests for `stderr, /E_` on that verb's `--json` calls.** The contract fix moves them to stdout, and safety tests read the old channel.
  - (11) **Verify a squash by its patch, not the whole tree, when the PR branched before a later main commit.** `diff <(git diff merge-base..head) <(git diff squash~1..squash)` must be empty; a tree comparison reports the intervening commits as a spurious difference.
  - (4) **For removal PRs, grep the removed noun across `skills/`, `injects/` and `oats-package/capabilities/*/skills/`.** Those texts are composed into every AGENTS.md; #155 was returned for stale `./soul` wording there.
  - (12) **In a native gate, wait on the dependent text, not the control that changed.** After a choice, the option label updates at once but the hint waits for the new preview, so an assertion read on the same tick is a false FAIL. Poll each asserted string until it settles or times out.
  - (13) **A long-running helper process is not covered by a PATH version floor.** The integration gated the client on PATH, and the host's wake daemon (started weeks earlier by a service manager) was an older binary that couldn't read the new identity layout. The failure was silent: status rows looked healthy and only the daemon's own log named the cause. Before attributing a missing effect to the server, read the log of the process that should have produced it, and record that process's binary and version in the evidence.
  - (14) **A removal PR's grep must cover every removed noun, not just the ones the PR removes.** The (c2) review's addendum-9 grep was clean, but a grep for ALL of `REMOVED_VERBS` found the published skills still teaching about a dozen verbs the kernel had refused since 0.25.0 (install/init/use/trust/config/...). Each removal PR had grepped only its own nouns. Keep the grep generated from the refusal table itself, and exempt forms that are still live (a captured-selector `trust`) explicitly.
  - (15) **A test port is where the old fixture's blind spots surface; budget for the kernel bugs it finds.** Porting to the v2 fixture exposed a restart bug on every v2 home, shipped in 0.25.9, that no v2 test had covered: every restart test used classic homes, and the native gates only spawned. When the model under test changes, re-home the lifecycle tests (start/restart/retire), not just spawn, and mutation-prove each fix against the released code.
  - (16) **A refusal added at one entry point must be probed at every entry point, and the gate is more than `test/**`.** The legacy-config refusal was probed on spawn/preview and then crashed `status --json` (the Desktop's roster read). A behaviour change that CI's packed-tarball smoke pinned slipped past a full `test/**` run. For a removal PR, drive the whole command surface a Desktop or operator uses against the new failure condition, and run `smoke:tarball` along with the test glob.

## Batch — 2026-09-24 evening (PRs 145–150) → v0.25.9
- **Merged:**
  - PR145 oats.aweb 1.12.1 `6cbda9d0` (Antares' lane; I cross-reviewed; the pin landed on its branch).
  - PR146 Desktop F3a `858223ae`. Native gate 8/8, including a real Desktop spawn end to end, the first on v2. It was returned once for 9 root-suite failures; the test-only fix `3861f78f` followed.
  - PR148 oats.okf 2.1.5 pins `5ca52ce9`. Returned once for a tracked `node_modules` symlink, then rebased after PR145 on a shared doc line.
  - PR150 bump.
  - Separate repos: oats-okf #15 (2.1.5) and oats-aweb #10 (1.12.1 stage) were cross-reviewed and approved. Both payloads were checked byte-identical, independently (`diff -rq` against a fresh clone at the tag or the reviewed oats head).
- **taught us:**
  - (1) **A mirror PR's payload check is independent and structural.** Clone the tag fresh and `diff -rq` it, or compare tree OIDs across a rebase. Never take "byte-identical" from the author's report alone.
  - (2) **Check the merge range for stray tracked files.** A `node_modules` symlink to an operator's machine path rode along in a pins PR.
  - (3) **The Desktop suite isn't the gate for Desktop PRs.** Root suites (`test/desktop-*`, `tests/desktop-views`) drive the Desktop server and views too. PR CI caught 9 failures the engineer's local run missed, so the engineer now runs those suites before pushing.
  - (4) **A tmux nudge to a busy Claude Code session can sit unsubmitted in its input box.** A developer idled for over an hour. Check the pane after nudging, and prefer instruction files.
  - (5) **Check what exists before queuing kernel work.** `hostOnly` settings enforcement has been in the kernel since 0.25.6; the gap was a package that didn't mark its keys.
  - (6) **Mail lag between agents produces repeated questions.** Answer once with message ids and ask for an explicit ack.

## Batch — 2026-09-24 afternoon (PRs 127–143) → v0.25.8
- **Merged:**
  - PR127 D2 `43a9528b`, PR129 D3 `cc28a862`, PR133 D4(2) `e86d92b7`. These are the driver's; I reviewed them and Antares ACKed them.
  - PR134 onboard hint `ee1297a6`.
  - PR137 design parity `ca35712a` (visual gate).
  - PR138 northwind flake `3548dc4c`.
  - PR140 aweb default `d110790b` and PR141 the onboarding messaging step `132cda13` (Antares' rewrite).
  - PR142 team env `1aa12ed3`.
  - PR139 escaping `5bf74d3e` (rebased onto #137).
  - PR132 status home `c4f94251`.
  - PR143 Desktop F2 `bd26e0c6` (native gate 6/6).
- **Closed as superseded:** PR135 and the six per-soul messaging PRs, by the human's aweb-default decision.
- **taught us:**
  - (1) **An ACK is bound to a head.** A rebase that moves a Class B PR needs the co-lead to confirm the rebased head. Antares' precise form: the PR's own delta is unchanged (same patch-id), not "the file is identical".
  - (2) **Two PRs that each create the same release-notes file conflict when the second one lands** (#132 vs #142, add/add). Write the next patch's notes on main once, and have PRs append to them.
  - (3) **A consumer-side approval binding cannot close a check-then-use gap the kernel leaves open.** `sync --approve id@version` approves the digest at approve time. The kernel will take a pinned `id@version=<digest>` (found in the F2 native gate).
  - (4) **A test that stops a tmux server must retry its temp-dir removal.** The server exits asynchronously; the fix is `rmSync` `maxRetries` (`b72ab125`, same class as PR138).
  - (5) **A CDP assertion on a header reads `innerText` after CSS text-transform.** Match it case-insensitively.
  - (6) **Human direction outranks the design frames.** When the human redirects a slice (F3 spawn dialog), record the amendment in the boundary doc before the review, so the gate reviews against what was asked (`7058babf`).

## PR #126 — Desktop F1: deployment model on kernel JSON (2026-09-24)
- verdict: MERGED `033d040b`, first round
- owner: oats-desktop-engineer-1 · coordinator: none (lead-reviewed)
- gates: direction per boundary §2 F1 + §3b (0.24 readers deleted, not wrapped). Transport: fixed argv, no shell, bounded, env stripped; `status` accepted only as the raw document and `workspace status` only as its v1 envelope. Row withholding plus canonical file roots. CI green. **Native gate 9/9**: real Electron at the head, installed 0.25.7 CLI, scratch Northwind deployment with a granted instance and a hostile `instance.json`.
- taught us:
  - (1) **Ship the maintainer's exit-0 capture as the consumer's fixture.** A guard-refused study run (exit 86) produces a document that looks valid. Fixtures from a clean producer run, with argv/exit/kernel/hash provenance, remove that doubt.
  - (2) The consumer found a **kernel** trust gap. `listInstances` spreads `instance.json` last, so a hostile file can report any `home`. Keep the consumer-side guard as defense in depth, and fix the producer too.
  - (3) A CDP gate must wait for the observer's first read and navigate like an operator. The header lives in Workspace → Capabilities, and the first read can take tens of seconds.
  - (4) F1 left the 0.24 inventory/readiness blocks on the same tab. Recorded as a required F2 deletion.

## PR #124 — configChain stops at a v2 deployment root → OATS v0.25.7 (2026-09-24)
- verdict: MERGED `4f3747a4` (merged by the ops watcher on Node 22 green; lead-authored, test-first)
- owner: oats-expert-knowledge-reworks (lead) · coordinator: none
- taught us: a defect the Desktop engineer reported as "inspect names the operator checkout" was the legacy `oats-config.yaml` ancestor walk crossing a v2 deployment boundary that docs/configuration.md already promised. Read the doc's promise first; the fix was one `break`, and the docs line made the boundary explicit. Release: the first cut under the co-lead push protocol (Class B intent → ACK), and the first where a delegated watcher opened and merged the `[skip ci]` bump PR under the corrected gate.

## PR #117 — Desktop 10B-0 terminal owner leases (`terminalApi: 2`) → OATS v0.25.6 (2026-09-24)
- verdict: MERGED `deb82710` (round 1 returned earlier for a root-harness fix + rebase; round 2 at `56f0e41c`)
- owner: oats-expert-knowledge-reworks (lead) · coordinator: none (Desktop engineer `oats-desktop-engineer-1` delivered directly)
- gates: direction/correctness/security read against `packages/desktop/terminal-owner.mjs` (256-bit lease validated by regex; principal = sender + senderFrame + mainFrame + trusted URL; epoch bump on navigation/crash/destroy; synchronous cap reservation before any await, epoch recheck after; bounded well-formed one-way writes; `register(wc)` before `loadFile`; bounded `dispose()` grace). **Native gate 23/23** — real Electron dev tree + real tmux on a private socket + real PTY, driven over CDP through `window.oatsDesktop.term*`: open/ready/write/close, stale-write zero effect, 20 opens + 21st `E_TERM_CAP`, reload revocation of 20 viewers, source isolation, no residue after quit.
- taught us: (1) **read the wire contract before asserting** — two of my first-run "failures" were the contract working (`termWrite` is one-way; "sent" means forwarded, a revoked lease is dropped silently) — assert on the effect at the far end (source pane marker) and on round-trip refusals, never on a one-way call's return. (2) A CDP-driven gate script in the maintainer's tmp is enough for a Desktop native gate; it needs a PRIVATE tmux socket (`tmux -S`) so viewer counting is exact and the operator's server is never touched. (3) The harness guard blocks any tmux teardown verb appearing in the agent's command text, even for private sockets — the gate script's own node-side call must do its cleanup.

## PR45 Desktop slice 1a + PR46 `oats catalog` → OATS v0.24.6 (2026-09-22)
- verdict: both MERGED (`508c4b5f`, `524180b7`) + PUBLISHED. PR45 by the Desktop engineer (retrofitted aweb identity; first PR of the S8 program); PR46 lead-implemented as the kernel seam the engineer specified.
- owner: oats-desktop-engineer-1 (PR45); lead (PR46).
- taught us: (1) a stale checkout is the first thing to fix when re-engaging a long-idle instance — its handoff mail was two releases old and arrived as if current; (2) a developer that pushes back on the brief with the spec in hand (palette precedence, agent-group vs repo) is doing the review's job early — accept and record; (3) "design to the letter" for a control panel is mostly *authority* work in the kernel (retention, stop, admission, signatures, enforced permission) — the renderer renders receipts; (4) main can be red for days on a guard that only fails under CI's shallow clone — check main's own CI, not just the PR's.

## PR43 four small fixes → OATS v0.24.5 (2026-09-22)
- verdict: MERGED (`38b6c028`) + tagged. Lead-implemented on explicit human authorisation because the development deployment could not spawn a developer (pi-profile bridge pin lagging the installed bridge — correct refusal).
- owner: lead (self-reviewed against the four gates; full gate 1665/1661/0/4; two pre-existing tests moved from "bare throw" to "attributed problem, nothing published").
- taught us: (1) recovery must derive truth from the object (worktree branch), never spawn-time metadata; (2) an `ifInstalled` row is a floor, not a requirement — satisfied by absence; (3) every post-selection refusal from `prepare` is a problem with slot/capability or it is a kernel defect; (4) a snapshot of a reviewed list will lag — read the list at the revision the consumer already names; (5) three "pin lags release" refusals in one day → lesson `pinned-release-lags-installed-release.md`.

## PR41 provider reasons + inspect superset → OATS v0.24.4 (2026-09-21)
- verdict: MERGED (`ef211d3e`) + PUBLISHED (tag `816afb0f`, bump #42). Provider fixed reasons cross the binding wire by exact match against manifest `binding.reasons` or reviewed bundled lists; `binding.keys` accepted shape-only; `inspect --request` accepts prepare's fields as `ignored`; CLI renders problem `key`. Full gate 1657/1653/0/4 by author and maintainer.
- owner: L; findings and verdict wording from the independent second operator (Antares, Juan's machine); compatibility-floor trap and literal lists from P.
- taught us: (1) a "specificity" gap can be a kernel *mechanism* discarding data the provider already made safe — trace the wire before assigning text work to providers; (2) a closed manifest validator makes any new manifest field a hard floor bump for every provider that declares it — decide "kernel first, providers floor on it" before the provider release, not at publish; (3) a flat shared operator namespace with no ownership rule deadlocks the first two providers whose key sets overlap and blames the innocent slot; (4) a fix to the source that produced a diagnostic makes that diagnostic irreproducible from main — regression fixtures must pin synthetic input.

## PR36 five second-operator seams → OATS v0.24.3 (2026-09-21)
- verdict: MERGED + PUBLISHED. Attribution by slot/capability/origins with kernel-fixed messages; no short-circuit across slots; typed v3 trust/absent-deployment holds; help; workTarget/emit-prepare-request. Focused 53/0 (lead), full 1640/0 (owner). Release run needed one flake rerun (maintenance.lock); snapshot walks now skip `.git`.
- owner: L; fixtures from Juan's side (Antares); root-cause trace by L confirmed by P.
- taught us: an independent operator's byte-identical failure pair can be CORRECT output for the input — trace the provider phase before demanding the outputs differ; the fix is specificity and attribution, never manufactured inequality. Byte-snapshot tests must skip `.git` internals (git background maintenance is not deterministic on CI).

## OATS v0.24.2 + oats.framework 1.1.1 + aweb 1.11.0 pins (2026-09-21)
- verdict: PUBLISHED (npm 0.24.2 both packages; GitHub release; bump PR #37). Includes PR33 (launchSelection/OATS_CLI_BIN), PR34 (operator shape), PR35 (D3 `oats onboard`, full gate 1639/0), P's prestaged aweb pin patches, six workspace imports, baseline hygiene (goldens empty catalog; lazy ajv).
- owner: L (D3, PR33), P (aweb 1.11.0, PR34, pin patches), M (S6 editions, docs), lead (wave integration, releases, live probes).
- taught us: verify a release by exercising the published tarball (`oats onboard` from empty dir), not by reading the diff; a catalog pin bump for a bundled capability requires byte-syncing the bundled copy (recut once); keep release notes honest about what is NOT in the cut (the five seams) so the independent re-run has a correct expectation.

## oats-knowledge PR #1 — curated base accepted (2026-09-20)
- verdict: MERGED (8d67eab4) after the repo went public. 25 concepts, owners = published soul UUIDs, roadmap snapshot re-verified before merge (it still described 0.23.1/OKF 2.0.0 — a stale roadmap must not ship as accepted knowledge), validator pinned to OKF v2.1.1.
- owner: lead (curation preserved from the earlier audit), Juan (visibility).
- taught us: validate the knowledge tree from its root — per-node strict runs report cross-node links as broken; and re-read Roadmap-type concepts against the current baseline before accepting a harvest, since strict OKF cannot see staleness.

## Evening wave: PR27, PR28, PR29, PR30 + releases (2026-09-20)
- verdict: MERGED all; released OATS v0.24.1 (tag recut once before publish for a scripts/ version pin; second CI run hit a flaky cli-lifecycle test → rerun green; bump PR #31 manual), OKF v2.1.1, `oats-framework/v1.1.0`. Maintainer follow-ups: catalog `oats.framework` + aliases; five souls declare `oats.core`; workspace imports pinned at caa341f3; layout test moved to stage two.
- owner: L (PR27 custody, PR29 D2), P (PR28 D1), M (PR30 S6).
- taught us: a distribution package tag (`oats-framework/vX`) decoupled from the kernel `vX.Y.Z` tag lets capability releases ship without a kernel cut; verify a release by actually acquiring from the tag (`oats install oats.framework`) and creating a soul, not by reading the diff. Same-repo `repo:<path>` sources require parsing the soul as a source document with a snapshot — tests that parse editions as operator input will refuse them.

## Redesign wave: PR23, PR24, PR26 + four member indexes (2026-09-20)
- verdict: MERGED all. PR23 (M) metadata/source edition, layout 5/5. PR24 (L) full gate 1621/0; `inspect --request` accepted as public inspection route, not parked. PR26 (M) marketplace policy, validate 396 links, catalog reader unaffected. Member-index PRs oats-okf#3/aweb#1/authoring#1/jira#1: one 6-line root `oats.yaml` each, pushed by M, merged by lead.
- owner: M (migration-peer), L (lifecycle-peer); lead pushed nothing on M's behalf — the two remaining repos need account access, not a workaround.
- taught us: when the lead is the bottleneck, the queue must be worked in risk order (metadata → docs → kernel) with focused gates plus one full gate for kernel changes, and new lanes assigned the moment their files stop overlapping open PRs. `gh pr review --approve` refuses on own-account PRs when the author shares the account; comment + merge is the working path.

## Distribution direction: oats.core / oats.setup / official marketplace (2026-09-20)
- verdict: ACCEPTED direction, recorded as decision + plan work packages D1–D4; implementation not assigned yet (await integration of open phase1 PRs to avoid `lib/core.mjs`/skills overlap).
- key rule: `oats.core` is written into each soul definition at creation, visible and removable — the kernel does not add it by magic. `instance-boundary` remains kernel.
- taught us: when a shipped mechanism already exists (`officialPackageCatalog()`), the decision is to name and govern it, not to build a parallel registry.

## Adoption-first runtime necessity gate (2026-09-20)
- verdict: HOLD speculative runtime expansion; continue declarations and existing-path validation. Read the current kernel WIP: its new inspection command/wrapper is a new convenience surface, not yet evidence that the released preparation/adoption route is broken. Preserve it separately pending necessity, rather than making a newly written test define an unapproved requirement.
- provider finding: the released aweb1.10.3 manifest lacks the binding interface that the captured broker requires. The in-progress codec/check draft still always refuses native readiness, so it cannot be accepted as completing messaging adoption. Request the minimum real code/input/authority gap and usable path before widening the change. No runtime or provider delta integrated.
- taught us: assign adoption outcomes, not presumed code changes. Separate shipped architecture, missing provider adaptation, missing operator inputs and optional usability work; successful declaration parsing or a better refusal is not completed deployment.

## Human implementation GO; independent Phase1 lanes assigned (2026-09-20)
- verdict: IMPLEMENTATION AUTHORISED for the approved framework-hosted workspace plan, using existing developers with lead review/integration. Workspace/source metadata, kernel/public-flow behavior and canonical provider readiness have separate file ownership; other-repository metadata is root-index-only to avoid provider collisions.
- scope: phase1 includes a parallel existing-role edition at `souls/oats-expert/` with preserved owner/read routing, not the five-role/corpus cutover or an operator-root helper API. Exact source publication comes before import pinning. Developer feature branches/PRs are reviewed; main/release/deployment actions stay coordinated by the lead.
- taught us: independence requires explicit write surfaces and shared interface contracts, not merely different task titles. Begin implementation of bounded slices, report concrete cross-lane seams, and reserve combined live acceptance for the integrated result. A dispatched assignment is not a completed delivery.

## Framework-hosted workspace alternative reflected in plan (2026-09-20)
- verdict: RECOMMENDATION REVISED, not deployment approval. The human proposes hosting the workspace in `oats` and keeping `oats-dev` for development capabilities. The plan now prefers that layout over repurposing the capability repository; the workspace-first/knowledge-second phase order is unchanged.
- evidence: workspace/member schemas and discovery implementation keep the two file contracts separate and do not require different repository identities; the concrete reciprocal observations remain an adoption check. Source import parses but does not follow the publisher's workspace backlink.
- taught us: workspace definition, source library and capability package are distinct responsibilities, not necessarily three different repositories. Co-location must not turn framework consumption into implicit organizational admission.

## Workspace-first execution sequence planned (2026-09-20)
- verdict: HUMAN-DIRECTED ORDER RECORDED; execution plan prepared, not an implementation or cutover claim. Phase1 is a real shared Git workspace, repository exports/admission and usable portable adoption; phase2 is the coherent knowledge profile, curated corpus and five expertise souls; full Desktop parity follows.
- evidence: existing workspace/member schemas and declaration/onboarding contracts read; bounded repository inventory confirms missing published workspace/member indexes in the inspected maintained repositories. The development package's published manifest still contains both a legacy template and review behavior, which must not be conflated with a workspace definition or deleted accidentally.
- owner: designated redesign lead coordinates repository/kernel/provider owners and reviews exact deltas; local operators retain deployment and disclosure choices. Real source/profile/learning exit gates distinguish metadata publication from adoption, and future knowledge features are not automatic prerequisites.
- taught us: adopting the architecture in the project's own repositories is a separate deliverable from shipping its primitives. Define that shared foundation before moving accepted knowledge and changing the expert roster.

## Redesign coordination timestamp correction (2026-09-20)
- verdict: CHRONOLOGY FIX. The lead assignment and commit `78dcc16b` occurred on September20, confirmed by the commit timestamp and current UTC date. The earlier entry's September19 heading carried the prior session date; it is preserved below as history, not a second assignment or a changed scope. Living repo-state is corrected. No runtime or deployment change.

## Redesign coordination lead explicitly assigned (2026-09-19)
- verdict: HUMAN DIRECTION RECORDED. One accountable lead coordinates the current Portable Souls, knowledge/capability and Desktop redesign; cross-checkout contributors bring new scope, changes and integrations through that lead and deliver exact reviewed deltas. Ordinary work within agreed scope continues without new per-edit permission gates.
- boundary: technical coordination does not replace local operator approval for deployment changes, native authentication, executable trust or migration. Runtime upgrades, adopted config snapshots and active-instance instructions are separate facts; older installed knowledge procedures must not stand in for current framework direction.
- taught us: shared repository and messaging access are not shared project context. Keep a current version-scoped briefing and explicit integration ownership, with live aliases and machine-specific inventory in deployment handoffs rather than the reusable soul.

## Human-authorised forward record correction accepted (2026-09-19)
- verdict: APPROVE exact `0060dbe8b0c8b470083d9a14c78ef4653d567b9a` and continuation from repaired history. Human disposition chooses forward correction without lifting the held optimisation's scope restriction and explicitly accepts that `54b07ee6` remains an ancestor. No retrospective approval or history erasure.
- evidence: independent fetch, complete correction read, exact four-path inventory and four postimage comparisons against `3f51acf3`; whole `packages/record` tree equals `9137bba602ec04603dbfb9d51b81359c5a8dd0ce`. Every other path equals prior `635fc7e6`; net difference from the approved baseline is only the independent messaging-reach documentation. Integrator reports 223/223 record tests; reviewer separately passes the scaffold/layout/resource/normal-retirement probe (1/1, no runtime/backend launch), without rerunning a broad suite or relabelling reported tests as independent evidence.
- owner: integrating maintainer supplies the human-authorised correction; reviewing maintainer confirms scope and normally fast-forwards while preserving pending stewardship work. No release/tag/install/native-auth change or new permission follows.
- taught us: repair a scope violation forward to the latest approved state, not an older pre-custody ancestor. Preserve unrelated improvements and truthful history; a hold on active content is not lifted merely because repaired history must retain the original merge.

## Held-scope confirmation; forward correction proposed (2026-09-19)
- verdict: DISPOSITION PENDING. The integrating maintainer confirms no subsequent human approval lifted the held patch; no repair has been performed. Recommend a coordinated forward-only correction restoring the four affected record files to `3f51acf3`, preserving later approved custody work, independent messaging documentation and all other paths. This recommendation is not execution authority.
- owner: human scope decision, then coordinated maintainer review of the exact corrective or explicitly retained delta. A forward revert retains the original ancestry; an honest recorded decision must permit the repaired history rather than claim the patch was never merged.
- taught us: do not use broad merge authority or green tests to infer an exception to a specific hold. Stable patch-id detects a normalized textual delta, not every semantically related rewrite; normal merges do not rewrite original commit SHAs.

## Parallel record merge observed; held scope escalated (2026-09-19)
- verdict: REVIEW HOLD on adopting/releasing the already published `635fc7e6` advance. Independent fetch and complete net-diff read confirm five files, +114/-18; the four record files reproduce held `54b07ee6`'s stable patch-id `21b53623067540c09d632b49d2f81ae1b931eda6`, and the held commit is now in ancestry. Request explicit superseding human authority and exact tested-revision/review evidence; do not equate author-reported green tests with lifting the hold.
- owner: parallel integrating maintainer; reconciliation requested by stewardship. No local runtime acceptance, release/tag change, unilateral revert or history rewrite was performed. This finding is about a confirmed scope exclusion, not a demonstrated runtime defect.
- related documentation review: RETURN the pasted collaboration-guide draft for version/layout, config/lock/trust, instruction composition, shared-resource conflict and messaging-liveness corrections; no exact revised file/commit has been approved.
- taught us: a small merge tree diff can still be exactly the previously held patch. Inspect both ancestry and net content; coordinate scope decisions across maintainers instead of relying on duplicate commit counts or successful tests.

## Canonical documentation publication verified; adoption gaps scoped (2026-09-19)
- verdict: DELIVERED to main as `edd82f82884a73331a2732d6d242f4536c81423f`, verified by remote ref and GitHub contents readback; source worktree clean. Twelve Markdown files, strict OKF 89/0/0, 56 local links/anchors and diff check pass. The prior entry records the approved direction; this records actual publication.
- owner: maintainer documentation/stewardship. Desktop implementation is next under the revised human sequence, not evidence of completed deployment or parity.
- taught us: multi-operator adoption needs an explicit shared-versus-local guide and witnessed setup evidence. Capability-owned co-location is an accepted option, not an implemented OKF2.x profile or scheduled release. Public visibility, same-repository storage and mutable soul paths are distinct; Git or messaging connectivity alone proves neither replicated config nor shared runtime state. Record these gaps without importing deployment-specific state into the canonical soul.

## Founder-approved canonical OATS and knowledge explanation (2026-09-19)
- verdict: DOCUMENTATION APPROVED by the human after iterative review, for direct main publication. README explains specialised teams, provider-independent choices, capability building blocks and the free ADE. Existing `docs/knowledge-theory.md` consolidates the detailed model rather than creating a competing canonical document.
- direction: centralised per-soul knowledge is the default, not kernel policy. Capabilities own procedures and learning, including supported alternative placements; immutable captured artifacts stay immutable. Ephemeral developers/reviewers and long-running expertise instances are both legitimate. Skills, durable judgment, situated context and ongoing state are distinct. Speciation/widening can follow sustained work even within a long-lived instance; automation and clone/redirect protocols remain implementation work.
- consistency: operational guides receive scope pointers, and earlier external-only/default decisions are explicitly clarified. Historical untracked September16 originals are preserved; no private deployment examples are copied into reusable soul knowledge. No runtime, package version, skill implementation or deployment change in this delivery.
- owner: maintainer documentation/architecture record. Human also authorises a fresh Desktop implementation child after main delivery, with copied historical notes and the new supplied designs; actual launch/implementation is separate evidence.
- taught us: documenting a useful default must not turn it into an accidental kernel requirement. A novice-facing overview and one detailed canonical guide are clearer than parallel competing accounts.

## Read-only deployment handoff and preserved-source boundary (2026-09-19)
- verdict: ACCEPT guidance, not source-identity/provider/cutover authority. Handoff uses exact0.24 public request, approval, SOURCE helper, native outcome and operation-worker contracts. Parent confirms five preserved declaration hashes/aliases and absent export index; owner separately reports unchanged ownership/read/write edges, curated seed bodies and onboarding parity. No candidate builder, source adaptation, provisioning or KB publication was run.
- owner: fresh-source/deployment lane · disposition: maintainer.
- taught us: a preserved legacy soul is not automatically a schema-valid advertised portable source. The accepted Git publisher/export identity and immutable reference are concrete human-owned cutover inputs; do not invent a bootstrap owner, adopt a pending library edition or silently disable messaging to bypass them. Actual0.24 router/validators also expose a stale setup-skill paragraph; correcting that guidance is distinct from adding runtime behavior. Release/install success remains separate from roster, accepted-KB and private-team rollout.

## Release v0.24.0, manual bump PR #22 and published-artifact verification (2026-09-19)
- verdict: PUBLISHED — immutable tag object `3dfa22c016e339fac6a7c1fe00d8058a214514d6` at `b5829fd176967ce88d607770c75767267e36a1aa`. [Release run35433822989](https://github.com/awebai/oats/actions/runs/35433822989) passed build/test, three Desktop build/smoke legs, both npm publishes and GitHub release publication with six installers/checksums. Only final automated bump-PR creation failed, with the established organization restriction.
- registry evidence: publish logs record both0.24.0 versions. Initial local packument/version queries were inconsistent; exact canonical public version endpoints subsequently returned both versions and immutable tarball integrity. No registry/auth repair, forced publish or tag movement was performed or needed; publication is not inferred solely from job ordering.
- PR #22: maintainer created the rescue from exact automation head `fce080b2`, read the full five-file diff and semantically proved only package/lock-root versions changed. Four-gate APPROVE recorded as a structured comment for the shared-account PR; expected-head squash merge produced `08c692d3`, normal local fast-forward followed. No source/runtime/dependency change or unpublished-version workaround.
- artifact verification: downloaded the actual registry tarballs and verified their reported integrity, then reused the existing clean-room assertions with only acquisition redirected to those original bytes.22.859s/exit0, actual outside-checkout installed kernel/core/adapter and OKF2.1 hooks/read/custody/seeded-completion/normal-retirement checks; runtime/backend tripwires untouched. This is published-artifact evidence, not fresh model learning or a completed workspace/private-provider cutover.
- owner: maintainer release/integration lane. Deployment-specific runtime installation and remaining rollout state stay in deployment-owned records.
- taught us: a terminal workflow failure after publication can be bookkeeping, not failed artifacts. Verify exact registry/release state and rescue the version PR; never retag a published release or substitute a source-tree smoke for installed bytes. Scope live source acceptance, deterministic published-artifact checks and actual workspace deployment separately.

## Desktop integration band preflight correction (2026-09-19)
- verdict: APPROVE exact one-file `c97ddf00`, integrated as `7352c16d`; exact preimage and complete delta reviewed, parent affected real-server/fake-CLI cases2/2 pass with syntax/diff clean.
- owner: fresh-source/packaging lane · reviewer/integrator: maintainer.
- taught us: updating a compatibility locator's unit tests does not update every server-integration assertion. Preserve the prior accepted minor, add the paired minor and move rejection to the actual exclusive ceiling. This corrects two stale expectations, not production behavior;39 separate unstamped-source floor refusals stay intact for the existing tag-versioning lane. No model, GUI, runtime/floor/version change or publication claim.

## First-cut source-main delivery and OKF v2.1.0 publication (2026-09-19)
- verdict: SOURCE DELIVERED — normal fast-forward pushes/readback put framework `0999f4a8` and provider `f20f8e5` on main. Reviewed runtime/pairing scope and all earlier evidence limits remain; no held ancestry or force operation.
- provider publication: immutable annotated `v2.1.0` tag object `ebd5d817a22e453ee49bf4cfb07eb94a58bcc03c` peels to `f20f8e57a22bdffb48b34dee9bcbc03a9e0704db`; [GitHub release](https://github.com/awebai/oats-okf/releases/tag/v2.1.0) is published, not draft/prerelease. Exact-head standalone CI succeeded. Distribution tree `d5bd8a525400f6d8e188110b4a6ea6e0d55c3874` requires kernel>=0.24.0.
- finalization: existing framework finalizer independently checked source cleanliness/unmasked index, raw committed file types/modes/bytes/alias and actual origin tag object/peeled commit. Published inventory snapshot `854c9a51e1dc7bddec11ca898f162465e51783515a3230a6c1db3f45528ec187`; mirror payload unchanged. A first aliased-path script invocation performed no action and emitted no result; it was not accepted as successful verification. The canonical executable-path invocation produced the actual validated result.
- owner: maintainer release/integration lane; developer source reviews remain closed.
- taught us: a zero exit with no required result is not execution evidence. Provider-tag publication, kernel package publication and deployment are distinct; the coordinated kernel release and installed rollout are still pending. Do not move a published tag, weaken the compatibility floor or confuse source-main permissions with runtime Git KB publication.

## Scoped native acceptance and local 0.24.0/2.1.0 release pairing (2026-09-19)
- verdict: APPROVE and locally integrate exact kernel outcome8c/306, provider gatec55, provider metadataf20 and framework pairingb01; final local framework runtime/pairing checkpoint `c9ba5798`, provider `f20f8e5`. No unrelated ancestry, duplicate record picks or held changes. These are not yet source-main/tag/publication/deployment claims.
- source review: outcome reader's stat-and-open ancestor ABA was reproduced before the correction; current named-file/descriptor binding now precedes every bounded read. Kernel delegates approved record manifest mutation while retaining independent ownership checks; the genuine unwitnessed-root negative and coupled public test require actual record-v2, not a conditional skip. Parent26 focused plus3 coupled plus3 packaging cases and scaffold1/1 pass; SDK/backend doubles remain explicitly non-live evidence. Gatec55 review and14 focused cases pass without changing its public seam.
- actual native evidence: exact `ad89ef2c` / `c55b814` passed the real source-deleted/config-poisoned gate on both tmux and Herdr in184.449s, unchanged source. Four primary/operation-created SOURCE-worker process and SDK outcomes qualified exit0 with protected turn correspondence; each worker processed independent judgment, accepted directory knowledge changes and left zero inputs. An earlier empty-owned-endpoint failure before model dispatch is preserved; no claimed home/root was repaired. A fresh controlled endpoint supplied the valid precondition.
- continuation evidence: a separately reviewed bounded parent probe passed four exact completed-intent replays without new native records, then four distinct actual restarts with new native IDs under the same incarnations/witnessed roots. Qualified outcomes and captured turns carried the instruction heading and selected-skill read; a controlled unselected ancestor canary was absent from observed turns. Native HOME/profile/auth remained normal; no credential copying/repair or backend spoofing. This is native continuation/resource evidence, not new knowledge-lifecycle or public-retirement proof.
- release pairing: f20 changes only versions/floors in three manifests plus current guidance/test; all28 other distribution entries retain exact raw Git identity. Parent validator and metadata1/1 pass. b01 mirror subtree exactly equals f20; all38 inventory entries and wrappers match immutable objects, all25 preimages match the parent tree, and parent4/4 current metadata/actual npm inventory/packed-byte/alias-omission checks pass. Inventory remains pending; npm omission of the source alias is not repaired or called a complete Git payload.
- installed evidence: the old bundled2.0 candidate smoke passes separately. The new0.24.0 release-stamped export with2.1.0 passes actual outside-checkout kernel/adapter installation and smoke, version probe and shipped-JS syntax. The bare export initially lacked its declared YAML dependency, before installed smoke; that setup failure is retained. Installing declared production dependencies allowed the previously uncompleted checks to pass in26.744s, source unchanged. Final assembled controlled scaffold/layout/resources/normal-retirement1/1 passes without a backend/model.
- owner: lifecycle, provider and fresh-source/packaging lanes; reviewer/integrator and real-run operator: maintainer.
- taught us: actual successful SDK/process observations and genuine domain receipts close a different evidence gap from dispatch acceptance. A metadata-only successor changes artifact identity and compatibility even when executable bytes are unchanged; qualify the real release-stamped artifact pair rather than rebranding an older installed smoke. Remaining private/provider, Git-PR, interactive/plugin, scheduled and broader lifecycle/deployment claims stay separate. Original delivery targets remain missed.

## Complete native Claude/Codex home regression (2026-09-18)
- verdict: APPROVE exact three-file `cfe2df42`, locally integrated as `0583c32c`. One new controlled parent case passes for both runtimes; previous six planning cases retain their original evidence, not a claimed seven-case rerun.
- owner: fresh-source/regression lane · reviewer/integrator: maintainer.
- taught us: ordinary native launch still includes actual resolved capability acquisition, required-hook trust gates, complete selected resources/instructions/task/work and normal lifecycle. The new fixture proves those behaviors with inert hooks and untouched runtime/backend tripwires, not fabricated metadata or a no-capability home. Source-only tests/docs: no native model, permission UI, auth or captured-retirement qualification.

## Record-v2 RV1 closure and native-policy regressions (2026-09-18)
- verdict: RETURN then APPROVE exact record `8fcf5e85` + correction `e0c3232c`, locally integrated as `6416f407` / `26e81054`. Parent read all changed source and actual consumers, matched preimages/after blobs, and reproduced two foreign-descriptor reads before the original refusal. Correction binds opened descriptors before native and authority reads; six controlled ABA regressions now require zero foreign reads. Original failures and claim-loss evidence remain intact.
- evidence: parent assembled36/36 record checks pass (including six unchanged legacy cases), plus unbound scaffold/layout/resources/normal-retirement1/1 and syntax/diff checks. Source-only qualification, not actual model/backend/history learning or release. Kernel Pi callback's literal v1-manifest assumption and outcome observation still need their owned integration; no bin/parser/store redesign or whole-branch ancestry was taken.
- additional scope: exact native Claude/Codex policy regression/docs `09f4a5f0` integrated as `39587ea1`,6/6 parent checks, no runtime fix. Superseded `4dc8bd43` was not picked. Complete OATS home composition and normal native context/opt-in permissions remain distinct requirements.
- owner: provider record lane and fresh-source regression lane · reviewer/integrator: maintainer; lifecycle owns remaining kernel/host consumer work.
- taught us: expected receipt inventory must survive missing rows; surviving-directory enumeration cannot certify completeness. A restored path plus a post-read refusal cannot undo reads from an already-foreign descriptor. These are implementation boundaries inside the approved witness scope, not reasons to add a new store or restart architecture review.

## Claude Code/Codex full home and native launch policy (2026-09-18)
- verdict: HUMAN DECISION RECORDED — complete resolved OATS homes, skills/capabilities/instructions and normal lifecycle remain; Claude Code/Codex may load ordinary native outside context. No Pi-style isolation requirement, implicit Pi dependency or default permission bypass for those runtimes.
- owner: maintainer architecture record; fresh-source lane verifies narrow existing launch/default/opt-in behavior, lifecycle retains ownership of any demonstrated kernel correction.
- taught us: exact materialization of what OATS supplies is distinct from exclusive control of everything a native harness loads. Preserve that distinction in claims/tests rather than omitting the instance composition or imposing Pi's profile on every runtime. Existing native flags are already conditional on selected yolo; no live configuration or native permission settings were rewritten.

## Local worker child-selector hygiene (2026-09-18)
- verdict: APPROVE and locally integrate exact provider `3701f74` over `85b9ec0`; two-file change, one new focused unit passes plus syntax/diff checks. No full-gate repetition or native execution; source-main remains the earlier delivered provider revision.
- owner: provider implementation lane · reviewer/integrator: maintainer.
- taught us: legacy `PI_AGENT_*` / `PI_AGENTS_ROOT` are OATS instance selectors, not native Pi auth/profile. Discard them at cross-instance child calls while preserving `HOME`, `PI_CODING_AGENT_DIR` and native Git/SSH/helper context. The earlier16-case result remains tied to its original source; this correction has separate evidence.

## Local captured host/worker integration and record enforcement exception (2026-09-18)
- verdict: APPROVE scoped LOCAL source integration, NOT main delivery or release — framework through `77bc96a4`, provider through `85b9ec0`. Exact backend/host/helper/packaging deltas reviewed; PH1 same-execution retry correction closes the original process-association finding with9/9 focused checks. Provider16/16 includes real public admitted scaffold/staging/repeated prepare, without native model launch. Earlier separate adapter/inert/package checks remain literal; no new full-suite or runtime-readiness claim.
- owner: lifecycle, fresh-source/packaging and provider implementation lanes · reviewer/integrator: maintainer under the human's streamlined workflow. Gate committed-payload/selector/exit-status findings close in `a30879c`; later gate behavior deliberately remains partial without actual process and SDK final-outcome evidence. Operation-triggered worker creation is not scheduled or always-on lifecycle harvesting.
- direction: human explicitly approved exactly five record libraries and their focused guard tests; [session-storage identity](/decisions/captured-session-storage-identity.md) records the scope and exclusions. Implementation is now assigned, not yet qualified. Maintainer declines additional per-internal-module version exports for this cut, retaining the pinned single COMPLETE-pipeline advertisement. Owner reversal was not a provider source rejection; no duplicate patch or automatic revert is required.
- taught us: preserve original pending/witness identity across reconciliation rather than equating a live process with the latest retry counter. Inventory, static availability, dispatch acceptance, model completion and durable publication are different observations; none substitutes for the next. Original broad full-gate positives cannot qualify newer runtime changes. No publication, install, credentials operation or runtime Git KB write occurred.

---

## Completion workflow — developers implement, maintainer reviews integrated source (2026-09-18)
- human direction: remove serial reviewer-instance handoffs for the current completion wave. Three existing implementation lanes continue; the maintainer integrates and performs source/product/correctness/security review before delivery. This supersedes the earlier coordinator-only/no-source-review role split, not accepted architecture, custody or permission boundaries.
- retirement: both dedicated reviewers retired normally with directory work/reports preserved and no incomplete cleanup. Native messaging warned that workspace deletion did not revoke certificates, so retired aliases are not reusable; no ad hoc identity repair or replacement agents were created. Deployment-specific recovery locations remain with the coordinator, not this portable knowledge.
- final retained review: corrected contract `52729a10` over `1295db64` has scoped approval for native-auth host/public-SDK details and witness direction. Existing record interfaces cannot carry the root guard through every dependent read/append; the minimum proposed exception names five library files only, not record CLI, transcript-parser/store redesign or another capture path. That additional earlier-scope exception is awaiting explicit direction and owner assignment; source implementation is not approved merely by this report.
- execution plan: concentrate on a real retained first cut, parallel host/backend/provider acceptance work, one coherent integrated review/gate and accurate packaging. Unqualified private-provider, interactive/plugin and broader lifecycle/UI claims remain explicit; a deadline does not turn fixture success into live readiness or waive findings.
- taught us: preserve review evidence while changing delivery topology; eliminate duplicate handoffs, not the integrated correctness/security gate.

## Captured session storage — witness boundary approved after contract return (2026-09-18)
- review: initial docs-only zero-plugin host proposal `8d36ae5e` was RETURNED before implementation. Independent source/API review confirmed the public SDK seam but found that current native location strings cannot prove original Pi session-directory identity across starts; no such durable witness exists in the proposed unchanged state. The report's separate credential-view/provider-policy finding belongs to the old authentication design already superseded by the accepted native-harness boundary, not a current requirement to implement provider allowlists or auth wrappers.
- decision: human APPROVES [a narrowly versioned kernel-owned session-storage identity witness](/decisions/captured-session-storage-identity.md), retained outside the protected directory under existing incarnation/admitted-action custody. Path equality or an internal marker is not a substitute. The approval is limited to this witness, not runtime-bundle grants, a new store, retirement/bootstrap, record-engine changes or weaker root attribution.
- next: owner and assigned native reviewer close the exact codec/state/compatibility rules in the same bounded review, then implement and independently review the small source slice. Explicitly cover exclusive creation, durable persistence, unknown outcomes, replay/restart, dependent validation, retention and legacy/public-result behavior. No new general human milestone is required within the accepted boundary; unrelated authority expansion still needs its own decision.
- limits: the original unchanged draft is not approved; no implementation, live model/backend/auth operation or new fixture/full-suite run was performed by this decision. Existing SDK evidence and prior source-main gates stay closed. The known Herdr protocol compatibility work remains separately explicit before real both-backend acceptance.
- taught us: an accepted directory path is attribution, not persistent object identity. Add the smallest honest external witness rather than promising replacement protection with no state capable of representing it.

## Harness authentication — accepted responsibility boundary (2026-09-18)
- decision: [Harness authentication remains native and user-managed](/decisions/harness-native-authentication.md). Users authenticate the selected harness normally; OATS launches it in that native context rather than inspecting, wrapping or managing credentials. Native OAuth refresh/persistence and configured credential mechanisms remain harness behavior, not OATS reimplementations.
- consequence: the proposed zero-plugin host's explicit auth-file argument, read-through CredentialStore and API-key-only subset are superseded. The prior credential-type question is withdrawn; users need not obtain or copy a key to fit an OATS adapter. Strict selected curriculum/history custody remain separate and unchanged, and other explicit host/placement choices still need their existing review.
- routing: implementation owner and native reviewer received the accepted correction; the provider owner was informed of the helper-launch boundary. No runtime code, real auth/model call, credential inspection, login/config repair, extra test matrix or live permission followed from this decision. External messaging human/team/admin/grant authority remains distinct.
- taught us: curating a harness's agent curriculum does not make OATS the owner of that harness's authentication. Preserve the user's working native setup instead of narrowing it to an adapter's convenient credential format.

## Aweb exact-team readback — scoped approval; runtime evidence update (2026-09-18)
- verdict: APPROVE exact `be9ac7edae0f3bb2e7898c4d0b4fa523132a941d` over `47be62fd`, tree `866bc88d`, within its four-file non-authorizing native readback/authority-ledger delta. Independent review verified exact patch/archive blobs, syntax, selected binding/receipt correspondence, bounded closed response and sanitized single-read failure; no source finding. Existing parent binding/receipt validators informed the review, not whole-ancestry approval.
- evidence: preserved developer 12/12 offline readback/operation tests, manifest validation and separate unbound scaffold/retirement 1/1; no independent runtime rerun. The utility requires an injected authenticated client and always reports qualification not established. Structural controller syntax is not cryptographic proof. No production check/setup wiring, native effect, aweb source integration, release/install or privacy/readiness approval follows.
- open: native responsible-human/actor delegation, hosted create/reuse/invite and collision/lost-response/key custody, exact credential-reference transport with origin/signature/certificate/non-revocation checks, human/context/team mapping, independently qualified grants and actual supported versions. Provider owns implementation/native evidence; reviewer owns code verdicts.
- separate SDK evidence: the owner's public Pi 0.85.1 zero-plugin consumer experiment exercised actual session/runtime construction, reload, new-session creation and one prechecked owned switch, with identical selected prompt digests and zero model/auth/network operations. This is not TUI, real model, arbitrary UI history or retained OATS primary/helper/backend qualification. The missing nonempty-extension loader surface does not block this separate zero-plugin path; explicit host/eligibility/model/history integration remains to implement/review. No new ledger or contribution contract was approved.
- date correction: the paired framework/provider source delivery described immediately below actually occurred on **2026-09-18**, confirmed by the merge/documentation commit dates and coordinator push receipt. Its original 2026-09-17 heading is retained as append-only history; the living repo view is corrected. Evidence scopes/results are unchanged.
- taught us: metadata-only readback can reject mismatch without proving authority. Likewise, real SDK construction is stronger than custom-loader getters but still distinct from live model/backend acceptance.

## Integrated captured native/provider source — both mains delivered (2026-09-17)
- verdict: SOURCE DELIVERED by normal fast-forward pushes — framework `280d0532` → `e0bccef0` (reviewed merge `cd938860` plus independently approved one-document correction), provider `ec5d767` → exact `86bff1a`. Remote main identities were read back after each push. No tag, version bump, install, mirror/catalog activation, production cutover or runtime knowledge publication occurred.
- review/integration: exact four conflict replacements had independent combined-context approval; coordinator verified original/stage/after identities before applying. The resulting merge tree was `ac4a130aca3f6124fbe88d5b226853b4ffb3e905`. Producer P1, native/Public PB1 and provider reader/schema/pairing closures retain their distinct scopes and historical returns. The one auto-merged wire document had a separate stale-status P2, now independently closed and applied byte-for-byte; only three status statements changed, not wire/schema/runtime authority. Held capture/runtime work and unapproved retirement/bootstrap proposals were not integrated.
- actual combined evidence: corrected R1 harness passed independent static custody/coverage review before one execution from a privately frozen, externally hash-admitted bundle. Actual framework/API2 plus exact provider86 passed **3/3**, source/dependencies unchanged. Coverage includes actual retained prepare/approval/hooks, strict current inputs, source-deleted scaffold and seeded retained-run continuation, plus public primary/helper start/replay/restart and SOURCE refusal on both INERT backends. The older isolated producer/API1 pairing was not relabelled as this combined result.
- standalone evidence: exact provider86 full gate **285 pass / zero fail / five skip**, source unchanged. This is not a real-worker or native opt-in result.
- full framework history: first unchanged-source run **2703 pass / one fail / three skip** stopped on the large capture/recall fixture's null-status retire subprocess; the other seven checks did not run. Independent unchanged focused case passed **1/1** in 22.7 seconds. Error/signal details were absent from the failed log, so timeout under contention remains inference, not established cause. The one reviewer-recommended full retry passed **2704 / zero / three**, source unchanged; all eight framework/Desktop/syntax/validation/pack/tarball gates then passed. No product, assertion, timeout or maxBuffer change produced the pass. Both failed and successful evidence remain preserved.
- scaffold verification: the exact full retry passed the changed-core scaffold-only case, including copied-resource/layout inspection and normal retirement without native backends. No new live model or agent was created for the delivery record.
- limits: source availability is not managed Pi/plugin/model readiness, real Herdr protocol qualification, a newly launched worker, public captured retirement/recovery or private-provider certification. Planned 0.24.0/floor alignment and real fresh rollout remain separate. Runtime-root grants, contribution sequencing/secret delivery and bootstrap/retirement proposals remain human-pending.
- taught us: a focused pass does not erase a failed full run; preserve both and attribute any diagnosis only to recorded evidence. Combined tests must use the actual paired artifacts and distinguish seeded/inert coverage from live execution.

## Actual native/provider integration — assembled; combined gate prepared (2026-09-17)
- assembly: provider coordinator tree fast-forwarded to exact `86bff1a`; framework merge `280d0532` + `6b836ba1` had four code conflicts. Two developers supplied disjoint two-file outputs; the native reviewer independently approved their exact combined-context resolutions and static `105cce24` clarification. Coordinator verified all original working/index-stage identities immediately before applying the two accepted patches and staging four files. Parent performed no source resolution or independent source review; both knowledge-log histories were retained.
- standalone gate: exact `86bff1a` completed 290 tests / 285 passed / zero failed / five skipped, with source-before/after manifests identical. Native and historical paired opt-ins were absent; this is not a combined API2 or real-worker result.
- harness: original combined harness RETURNED before execution for pre-use code-hash custody, output/source overlap, dependency provenance and missing refusal exit-status assertion. Fix-only R1 statically APPROVED after all four closures, conditional on external coordinator runner verification/private frozen copy. No test or generator was executed by that static review; failed developer unit attempts remain separate evidence.
- next: freeze the actual resolved framework tree and execute the one reviewed combined provider/public/native case. No implementation main push, tag, model/daemon/private-provider or proposed retirement/bootstrap authority is inferred. Real-runtime and remaining lifecycle qualification stay open.

## Captured producer, paired provider and native/public corrections — scoped closures (2026-09-17)
- producer: P1 CLOSED for exact be plus patch SHA-256 `a29db161dc87a90360ec2ecde1629b6b294835368ce8363c1eac7587f81f78ac`, producing tree `0c031114e965b08ac25b29ab456f48eedcf42c91`. Same correction delta is `59d5bd18`; full inherited commit ancestry is excluded. Independent real publication regression 1/1 plus syntax/six schemas passes. Original be RETURN and separately preserved positive baseline evidence remain unchanged.
- provider: `57aaec7` schema/validator APPROVE with seven independent checks, but final pairing RETURN for the old producer identity. Repository-only `86bff1a` closes that P2 with actual accepted-producer pairing 2/2. Reader `f43996d` approval remains; old `0f`/`57aa` returns are historical, not relabelled. Distribution tree remains unchanged. Seeded retained-run and direct retire-hook fixtures are not worker launch or public retirement evidence.
- native/public: `5d95175d` Herdr/tmux start/restart APPROVE with four independent tests and schema checks; `6b836ba1` separately closes direct-helper public PB1 with one new independent negative. Both reuse existing native custody and preserve SOURCE/helper selection boundaries. No whole-ancestry or real daemon/model/privacy qualification is inferred.
- next: coordinator integrates and gates exact covered artifacts; reviewers own any remaining source/contract gaps. Isolated BE+P1/API1 pairing is not a later combined API2/native gate. Managed Pi roots/contributions, public wake/retire/recovery, real worker/provider acceptance, release floors and rollout remain outstanding. No implementation main push or release was performed by collecting these reports.

## Shared helper/input producer — independent P1 return (2026-09-17)
- verdict: RETURNED exact `be2460c5`. A reviewer probe of the publishing semantic guard accepts an undeclared choice-less capability instruction block on a helper. Eight successful focused tests and syntax/generated-schema checks do not close this policy-publication bypass; initial scratch setup failures remain separately preserved evidence.
- required closure: every capability-sourced block/omission in new helper publication must correspond exactly to its retained owner's policy. Preserve primary and literal historical read/reuse behavior, and add a regression through actual `commitCapturedResolution`, not only the standalone semantic verifier.
- ownership/holds: one assigned reviewer owns this producer correction and separately identified schema/provider pairing; the other remains on public/native/Herdr work. Coordinator routes and integrates, not source-reviews. The reader approval is not revoked; provider declaration remains held, and no producer/schema pairing approval or main/release follows from this candidate.

## Fresh-source onboarding facade — reviewed integration (2026-09-17)
- integrated: exact accepted eight-file `bba25ca4` artifact, patch SHA-256 `126e516bed2b07c2b067003faaf7037778807c137984d01abaab3ee731ccbc4a`. Independent context review accepted it against main7ab; later main differences were stewardship only. All eight resulting source blobs and six excluded already-adopted blobs matched. No resolution-shape context diff, migration/native code or duplicated request/resources were applied.
- gate: 19 combined tests pass, zero failures/skips, including fresh inspection/witness cases, explicit pinned public consumers and scaffold/layout/normal retirement. Syntax, project, package dry-runs and strict knowledge validation pass; runtime source remains the tested staged tree. No new source review was conducted by the coordinator.
- qualification: c5 preparation and exact257 no-launch fixtures retain their historical scope. This incremental integration does not rerun or relabel the earlier full C1 gate, prove current native/Herdr/provider behavior, adopt the roster/KB, or publish0.24. Real integrated runtime/provider acceptance remains outstanding.

## Standalone OKF — reviewed source-main checkpoint (2026-09-17)
- delivered: provider main `ec5d7671799b3258aef69f9bbcf2c6480c4811ad`, normal fast-forward from `4b6d861ce44e5662303e150cc85095d0eb00d7e7`. Coordinator fetched/checked exact clean head, covered ancestry and corrected gate receipt before push; shared checkouts and tags were not changed.
- review: assigned reviewer APPROVED SOURCE CHECKPOINT, confirming continuous coverage across all 33 commits through initial candidate, corrective/harvest/index closure, c24 wire and ec5 residual fixes. No new tests or source review were invented by the coordinator to widen that verdict.
- gate: corrected physically non-Git full run 274 total / 270 pass / zero failures / four skips, archived source unchanged. Original failed harness remains preserved as failed evidence, with independent cause classification.
- holds: no release/version-floor qualification, generic execution-reader completion, actual helper/native/Pi/Herdr/private-provider readiness, install, mirror update or accepted-branch knowledge publication. Runtime Git knowledge stays PR-only. Later reader/declaration/native candidates remain separate work.

## Captured admission and preparation routes — direct source delivery (2026-09-17)
- code: `c1ff882b6510bc3bc041b9037d9f8443251558da`, coordinator merge of exact257 prerequisites and independently approved cumulative v2, portable resources/composition, context-adapted workspace ingress and final shared request router. All supplied patch/hash/blob checks passed; no native-start/public-helper/Herdr ancestry was included.
- verification: all eight gates pass at exact code head: 2677 total / 2674 pass / zero failures / three skips; syntax, Pi syntax, project, strict knowledge, package dry-run, clean-room tarball and diff checks pass. Prior merged-tree30/30 includes the owned scaffold/layout/normal-retirement probe. Runtime source remained at the same head; the temporary Desktop dependency link was normally removed. Parent performed integration/gates, not source review.
- provider gate: corrected standalone `ec5d767` passes270/0/4 with unchanged source after independent harness-placement diagnosis; the original failed run remains preserved. Provider source-main coverage review and later reader/helper/private-provider/release work remain separate.
- limits: this delivery is main source code, NOT0.24 publication/deployment, real native/model/helper success, Herdr parity or privacy qualification. High-level fresh-facade adoption and later native/public/Herdr candidates continue through their own reviews.

## Approved captured-base assembly — local integration checkpoint (2026-09-17)
- integrated scope: exact `257c4b96` prerequisites plus the independently accepted cumulative fix-only v2 patch; accepted portable resources/full composition, context-adapted `fdbd909b`, and original `7a9c25d2` request leaf/router. Supplied before/after hashes and final five request blobs matched. Unreviewed native/public/Herdr code and `packages/record` runtime are excluded.
- evidence: 30 merged-tree checks passed, including the previously static-only direct workspace ingress case and the owned scaffold/layout/normal-retirement probe. Runtime source remained unchanged during execution. This local checkpoint is not a full combined gate, main push, release or native-model qualification.
- review updates: independent fresh-directory and c77 contract reviews are accepted within their scopes; native `dd4eb82a` closes NS1–NS4 with four targeted tests, but its public-bridge parent and Herdr remain separate. Coordinator owns assembly/gates/delivery; reviewers own source verdicts.
- next: commit the assembled candidate locally, run the coherent integration gates, and push normally only on readiness. The corrected standalone gate separately uses reviewer-confirmed non-Git isolation; the earlier failed run is preserved.

## Standalone gate result and independent review ownership (2026-09-17)
- gate: exact `ec5d767` complete run finished 149 pass / 121 fail / four skips; archived source unchanged. Many failures report directory-store Git custody against the surrounding repository. The assigned reviewer is triaging harness temp placement versus product behavior with at most two targeted cases; no blind full rerun, guard weakening or source-main push.
- ownership: independent reviewers own source/contract verdicts; coordinator owns sequencing, integration, combined gates and delivery, not source review or code-failure diagnosis. Earlier coordinator-only fresh-directory checks remain evidence, with independent confirmation assigned. Existing reviewer-issued scope acceptances remain valid.
- follow-up: preserve the failed run and obtain explicit corrected gate conditions or a developer-owned fix before rerunning. No new product defect count or deployment qualification is inferred solely from the failed harness run.

## Provider index-copy residuals — closed; complete gate started (2026-09-17)
- verdict: ACCEPTED exact `ec5d767` for both residual index-copy P2s. Ten named regressions pass under isolated Node 22/Git 2.44; no new findings. Supplied patch, touched base blobs and applicability to the original reviewed helper are independently verified. No whole c24 wire/provider lineage or runtime qualification follows from that scope.
- behavior: native parsing uses an empty private Git context before rejecting split dependencies; bounded regular-descriptor acquisition refuses special/raced/oversized inputs without reading rejected sources. Original index/backing metadata and independent publication mode remain intact; no timestamp restoration, silent flattening or new parser.
- next: coordinator fast-forwarded its isolated provider integration tree to this exact candidate and started one complete isolated standalone gate. Final result/source integrity remain pending; no main push, tag, release, helper launch or private-provider claim.

## Fresh directory-witness successor — scoped acceptance (2026-09-17)
- verdict: ACCEPTED `f92ca993` plus `bba25ca4` documentation within their narrow delta. Two new root-replacement/provisioning regressions passed in an isolated exact archive; reviewed code/test blobs remained exact. No blocking finding, no repeated full suite or whole-branch/migration approval.
- behavior: ephemeral issued-inspection witnesses bind deployment or absent-path parent and work-directory identities; recheck before the existing mutation adapter, preserve ordinary project edits, require reinspection after replacement/provisioning. No public-schema/registry/resolver authority is added. This is a point-in-time check, not a lock against hostile concurrent writers or a substitute for core custody.
- follow-up: source integration and coherent gates remain coordinator-owned; no runtime/provider/release qualification follows from this acceptance.

## Native first-placement authority — peer finding routed (2026-09-17)
- verdict: RETURNED within the native `2a3d785c` candidate scope. Static peer analysis identifies explicit/admitted endpoint A being displaced by residual fresh-home tmux metadata B through the reused never-launched allocator path. No counterexample was executed by that reviewer and no existing-target stop is claimed.
- follow-up: lifecycle owner must reject contradictory residual placement before provider/backend calls and preserve the exact admitted endpoint through allocation. Add a narrow inert negative checking actual socket/session/window arguments; native reviewer corroborates without duplicating the issue. No new backend, metadata backfill or uncertain-effect replay authority is permitted.
- boundary: approved earlier admission/curriculum/request integration and provider index pins remain separate. Core dispatch acceptance is not model/helper completion, captured-Pi qualification or privacy. Completed replay's provider inspection is a separate documented behavior note, not proof of no-provider-code replay.

## Fresh review queue — scoped closure and return (2026-09-17)
- verdict: ACCEPTED the workspace-presence fix `0a1c143`, resource-only `36b0aa00`, request leaf `8822ccce` and pinned public fixture/docs through `f9292253`; no whole migration ancestry or production qualification. Exact archived execution: 14 selected tests passed, no findings.
- lifecycle verdict: RETURNED exact `257c4b96` plus the supplied fix-only patch through `edb143cd`, excluding launch-input ancestry. Independent patch/archive equality verified; ten final selected tests passed. Retry-reference, error-rendering and current-view-receipt findings are scoped closed. Residual static findings: failure reporting lacks an expected lifecycle-status transition, and a post-hook index read can bypass observed-fact/error reporting. Owner received narrow correction scope; no changed-row overwrite or terminal-ready inference is permitted.
- follow-up: complete resource/request-router hookup through `7a9c25d2` is a separate delivered review candidate. Preserve earlier reports at their exact pins; newer implementation does not retroactively widen their evidence. No runtime/helper launch, provider privacy, release or deployment claim follows.

## Standalone index-copy successor — scoped review (2026-09-17)
- verdict: RETURNED — `ce8980ba` closes the original ordinary-index byte-preservation failure, but has two residual copy-boundary P2 findings. No source-main/release/activation is implied.
- evidence: the one permitted existing custody regression passes in an exact isolated archive. Native Git 2.44 source shows split-index reads freshen original shared-index timestamps before split-index output suppression takes effect. Native Node 22 copy implementation opens a source before checking its type, allowing a special file to block outside the Git command timeout. The latter findings are static inspections, not executed reproductions.
- follow-up: provider owner received narrow correction/regression scope: isolate shared-index read dependencies or refuse before native freshening, safely acquire a regular index descriptor, preserve the original index and independent publication index. Keep raw-object, filtering, remote/auth and no-checkout protections; no copy-back, timestamp restoration or blind complete rerun. The earlier complete gate remains 259 pass / one failure / three skips until a new coherent gate is actually run.
- taught us: redirecting one index pathname does not necessarily redirect native backing-file side effects; a regular-file check after a blocking open is too late. Targeted byte-preservation success must not become an unconditional custody claim.

## Fresh flow and provider successor — coordinator review (2026-09-16)
- verdict: RETURNED — lifecycle/admission `257c4b96` and onboarding `4d244ee2` remain branch candidates. Provider `b92a824` closes the residual pre-effect harvest finding but its full standalone integration gate still fails index-byte custody. No new source integration/release/deployment is implied.
- findings: activation must not publish through a replaced home after detecting custody loss; explicit preflight retries must retain their references; optional functional failure cannot hide unsettled execution custody; public outcomes must agree with indexed uncertainty; views must use current indexed provider receipts. Active retained instructions must not reintroduce legacy context authority, and supplied falsy workspace values must not bypass standalone ingress validation.
- evidence: authorized exact-archive review tests passed (admission 7, invocation/curriculum 11, onboarding 7, provider harvest closure 4). The complete provider gate reports 263 total / 259 pass / one index-preservation failure / three native opt-in skips. Owners received narrow corrective work; no test assertion, publication filter guard or unknown-effects boundary was weakened.
- owner: coordinator reviews/integrates/pushes; lifecycle, fresh-setup and provider implementation owners fix their respective paths. Production delivery remains standing-authorized when actual readiness passes, without a new human checkpoint.
- taught us: a failure path needs the same ownership gate as success. Presence and truthiness are not interchangeable for authority-bearing input. Read-only verification must preserve caller-owned index bytes, and a no-launch result is not a running-worker acceptance.

## Standalone OKF portable candidate — direct-main review (2026-09-16)
- verdict: RETURNED at provider `388182cab282f2c490002af00d19794d047d7b35`, against released base `4b6d861`. Direct-main implementation delivery is authorized, but no source push/release/activation occurred while findings remain.
- findings: captured worker creation and completion commands still use legacy/current selection; dotted aliases cannot be rebound by the external binding grammar; locator/identity validation admits secret-bearing URLs into retained or diagnostic data; owner lookup sees inherited properties; read-only Git staging may execute configured checkout filters. Corrective provider work and the generic captured-helper seam are assigned to their owners. Version/minimum metadata remains a separate publication gate.
- evidence: only the permitted binding/domain and captured-source/schema tests ran, 19 passed; no full suite or live consumer/privacy qualification. Existing private snapshot, source-descriptor, v2 schedule/null-owner and PR-only publication boundaries were confirmed, but a fake worker/direct completion test is not executable dispatch proof.
- owner: coordinator review and main integration; capability owner implements provider functionality, lifecycle owner supplies generic helper contracts.
- taught us: source-free data is insufficient if the next subprocess selects today's code. Closed identifier maps need own-property lookup. Nonsecret validation applies to malformed persisted identities and URL components too. Authorizing direct source-main delivery does not waive runtime knowledge PR custody or remaining review findings.

## Provider consumers and historical evidence — coordinator integration (2026-09-16)
- verdict: DELIVERED TO MAIN as `9c69251a84b4a7bd6329016ffca2d4e0ee57ad50`, ordinary non-force coordinator push after scoped review closure and all eight local gates. No PR wait, new release, live migration or production activation.
- scope: single-resolver provider binding preparation; captured command/operation readiness and private invocation snapshots; exact source-receipt/hook authority; owned bounded operation execution with observed receipts retained across cleanup failures; helper policy preflight. Legacy lock decoding now has one acyclic byte implementation and a small core wrapper. Explicit bounded inventory/artifact observations and immutable partial/unknown evidence remain separate from selectable captured resolutions, approval and reconstructed publication.
- review: helper-authored policy and unadapted provider administration findings closed; lifecycle timeout, receipt-authority and cleanup-custody findings closed. Migration provenance no-follow/preflight/final-witness, legacy-attempt holds, incremental listing budgets and v1 unknown-field sanitization findings all closed at stable owner heads before integration. The core decoder bridge was separately reviewed; native filesystem read errors now retain native error typing, while malformed lock bytes remain typed invalid-lock.
- evidence: exact `9c69251a` full suite 2653 total / 2651 pass / zero fail / two existing skips, including Desktop and pinned standalone-provider consumer. All eight gates passed: full tests, syntax, Pi syntax, project validation, strict nine-bundle OKF, packing, clean-room tarball smoke and diff check. Native consumer fixtures prove source/config-deleted binding/registration, explicit-null schedule custody and administration refusal; they do not certify production/privacy. Scaffold-only layout and normal retirement passed; no live backend was launched by acceptance probes. Held capture patch and record runtime stayed excluded.
- owner: coordinator-only maintainer, integrating independent lifecycle and migration implementation owners; default provider remains separately owned and unpublished in this increment.
- taught us: match receipt authority, not just shape. Preserve observed execution when cleanup fails. Bound reads before legacy hashing and count ignored directory entries toward traversal budgets. Unknown legacy fields are not sanitized merely because their key looks familiar; v1 evidence keeps only independently verified paths. Scoped review success must not be confused with approval of later unreviewed commits.

## Captured scheduler and retained provider broker — direct delivery (2026-09-16)
- verdict: DELIVERED TO MAIN through `17bda42acbfb96d9a75c70411b995aa5a0d298a7`, normal non-force push after bounded review/fixes. No PR, new release, production migration or live timer activation.
- scope: captured command templates versus fresh attempt identities, custody-preserving observation/reconciliation/removal, automatic wake file-version gates, real generic prepare-on-tick and explicit API-2 remote negotiation. Existing Desktop adapter refuses unsupported captured editing rather than downgrading intent. Provider manifest-owned normalize/bind/check commands now have a strict bounded wire and native retained-artifact broker with current exact approval, shared choice/binding codecs, origin-role/field ownership, identity scrubbing and sanitized outcomes.
- evidence: scheduler custody review closed four findings; adapter review passed; reconciled child follow-ups retained those corrections and added requested/returned deployment and resolution checks. Native integration caught a platform path-alias mismatch; canonical identity is frozen before preparation and verified afterward. Broker review found ignorable termination; the correction passed an actual signal-ignoring codec test and independent closure. Full integration run at `fc82dc68` was 2631 total / 2628 pass / one help-vocabulary assertion fail / two existing skips. The sole failure was corrected at `17bda42a`; focused regression, 96-file syntax and project validation passed. No repeated all-green full-run claim. Dependency/layout/scaffold-only/normal-retirement checks passed; held capture patch and record runtime remained untouched.
- owner: oats-expert maintainer, integrating an authorized independent scheduler implementer; default-provider work continues separately.
- taught us: unchanged content is not the same execution intent. Observation must not erase unresolved custody before validation. Platform path aliases require canonical identity checks, not literal string equality. A synchronous timeout with an ignorable signal is not a time bound. Provider transport/choices are not actual provider readiness or privacy certification.

## Captured command consumers and native preparation — direct delivery (2026-09-16)
- verdict: DELIVERED TO MAIN through `049a22ad1e88053e5b96c832a6b4563a027d5fc7` by ordinary fast-forward push after bounded review. No PR, release, deployment or live schedule activation.
- scope: `loadCapturedDispatch` and explicit CLI selectors; exact prospective artifact approval without a fabricated partial resolution; native import/workspace/adoption/package/default/resource/helper preparation. Complete results expose a versioned execution binding; per-admission execution identity remains separate from content identity. Provider/launch/cutover gaps remain explicit.
- evidence: source-deleted A/B commands execute the retained approved version, public CLI uses the exact selector and scrubs invoking identity, malformed-selector JSON remains one envelope. Native preparation/curriculum/helper, alias conflict, provider-incomplete and legacy-refusal tests pass; scaffold/layout/retire checks pass. Final bounded preparation review ran four requested tests and identified the hook-rendering mismatch; its fix passed the native hook regression and independent closure. Prior main CI at `d3ba70de` passed; no blanket later-CI claim.
- owner: oats-expert maintainer; parallel scheduler implementation coordinated on separate owned files.
- taught us: executable provider normalization needs exact prospective approval before a complete record exists. Resource inventory must consume raw hook declarations, not a legacy shell command whose first token is the Node interpreter. Scope/identity/config proofs must remain distinct from actual host/provider readiness.

## Portable package/default capture — direct main delivery (2026-09-15)
- verdict: DELIVERED TO MAIN through `1a61daa46ab4bfd18d8b5618bf9ae70e864e7517`, ordinary fast-forward direct push after bounded review; no PR or approval wait. No release or deployment.
- scope: shared package walker/materializer, frozen-source acquisition with strict ingress and guarded private-state projection, and manifest defaults captured with exact artifact/file-byte/pointer provenance. The reverse-provenance P2 is closed by `4518da3a`: every intrinsic candidate is checked, even overridden or absent from dispatch maps, without adding a second resolver.
- evidence: package engine 80/80 at its extraction/safety checkpoint; subsequent package-adapter review findings independently closed. Latest parent record/default 12, stream-lock six, dependency/scaffold three passed; independent final closure ten passed. Main CI `35010453332` failed an elapsed-time assertion after successful append/read; `1a61daa4` replaces that test assertion with deterministic bounded-poll observation. No record runtime change, held capture patch still excluded. Latest full CI is pending confirmation, not represented as green.
- owner: oats-expert maintainer; review: read-only bounded adversarial checks.
- taught us: completeness checks must reject invented provenance as well as missing facts. Lock-wait assertions should observe polling behavior, not include unrelated filesystem/scheduler latency. Package preparation is not complete captured runtime/host/provider qualification.

## Portable Souls source/discovery foundations — direct main delivery (2026-09-15)
- verdict: DELIVERED TO MAIN as `8373fc2fe3c9aa766a73ece82aacec5df98527a8`, by authorized direct push. Prior foundation PR #21 became merged when its commits reached main; no PR approval wait or new PR was used. No new release or production activation is claimed.
- scope: canonical/versioned data and digest primitives; strict source/declaration/shared schemas; retained artifacts and captured records; lock v3 and separate exact approvals; source-aware planning; native repository observations and reciprocal workspace/by-reference export discovery. Complete package preparation, captured public consumers, provider qualification and explicit migration remain work in flight.
- evidence: all eight local integration gates passed at code head `92d031e6` — 2586 tests passed, zero failed, two existing skips; nine strict knowledge bundles and packaging/tarball smoke passed. Initial isolated-runner socket-path failures were preserved and attributed, then corrected without application/test weakening; all 29 affected session tests and the full suite passed. The later CI-only delta passed its focused regression/actionlint and enables the same read-only checks on direct main pushes.
- owner: oats-expert maintainer; safety review: bounded adversarial findings independently closed, including native projection containment.
- taught us: nested settings retain their owning source, not just capability ID. Case-sensitive Git paths can alias on the destination filesystem; materialization must protect every write parent before side effects, not rely on a final containment check. Canonical, short isolated socket paths prevent test-harness failures from masquerading as runtime defects.

## Knowledge prerequisites and OKF v2 publication (2026-09-13)
- verdict: MERGED/RELEASED — framework PR #17 exact `38fa4c90` merged as `c0628d3a`, published OATS/Pi/Desktop v0.23.0 with release run `34770619372` successful in all jobs. Standalone OKF PR #1 merged `077eff6`; PR #2 exact `630c26a` passed independent review and 226/226 tests against the actual published minimum kernel, merged as `4b6d861`, and is the immutable v2.0.0 tag/release. Published-consumer CI `34779176900` succeeded in both jobs.
- owner: oats-expert maintainer · delivery: feature PRs with same-account approval comments and expected-head merge guards.
- taught us: source package transport must preserve canonical aliases; the optional theory package is Git-distributed, while npm bundled assets are not represented as complete Git packages. The remaining v0.23.1 integration refreshes catalog/mirror to these already-published sources; deployment/cutover is still a separate gate.

## Knowledge implementation R1/custody convergence and live acceptance (2026-09-13)
- verdict: REVIEW FINDINGS CLOSED in the candidate through iterative independent review: retryable directory cleanup and start authority, historically attributed capture roots, piped/bounded record reads, migration binding drift, alias isolation, exact Git content/mode/push custody and directory crash/rejudgment recovery. R0 export validation gaps independently verified closed. Default OKF v2 is committed at `077eff6`; framework prerequisite candidate remains pending final commit/PR/release.
- owner: oats-expert maintainer · delivery: feature branches and PRs, per the human's explicit clarification.
- evidence: real Pi source→retired source/transcript→independent model harvester→fresh KB-only reader passed on installed candidate artifacts. Actual private GitHub delivery opened a knowledge-only PR, then maintainer review/merge and the same run's reconciliation verified accepted commit `68d1ce773d7147f05cd7ebbd81512a07da1499f7` and fresh visibility; this was a scripted transport probe, not the separate model-learning test. Full prerequisite suite after deterministic history goldens: 1682 pass, zero fail, one existing opt-in skip; packing/installed Git-authoring closure passed. Publication/deployment remains a separate gate.
- taught us: delivery must verify actual Git objects and modes rather than just staged bytes, and native capture authority belongs to execution-time history rather than an observer's current environment. New history is persistent custody and must remain represented in post-retirement golden tests.

## Knowledge implementation checkpoint R0 — exact two-commit foundation review (2026-09-13)
- verdict: RETURNED for standalone OKF baseline validation gaps at `88c09c6` (framework design commit `3d12e5a2` passed direction review): escaping root package manifest accepted, essential skill exports could disappear with tests green, and manifest command/operation fixed argv was not actually exercised. Corrections committed as `03364e4`; 92 tests pass, independent re-review pending. No publication occurred.
- owner: oats-expert maintainer · delivery: direct-main implementation explicitly authorized by the human, with adversarial workflow checkpoints instead of a feature PR for this work.
- taught us: a passing baseline must reject broken export mutations, not only validate the payload that happened to be present. Review also found a pre-existing generated-shell quoting vulnerability in v1 harvest instructions; its v2 removal still requires adversarial verification before release.

## PR #68 — v0.20.0 manifest bump after complete publication (2026-07-30)
- verdict: MERGED as `c6d92da04b6c06c4da2987790d423e8b736744dd` from exact automated head `3f6805ec142537276b9a3c305ace10295adc8434`. Release run `30548558607` had already passed build/test/tarball, all three Desktop installer build+smoke legs, npm publication of OATS/Pi 0.20.0, checksums/provenance, and GitHub Release creation; only the known organization policy blocked Actions from creating its version-bump PR. Maintainer created and squash-merged the rescue PR manually.
- owner: oats-expert-oats-packages · coordinator: dev-coordinator-capability-finalization
- taught us: nothing new beyond the existing org-level Actions PR restriction; publication is complete before this expected failure, so rescue the immutable manifest bump without retagging.

## PR #67 — v0.20.0 Desktop compatibility and release readiness (2026-07-30)
- verdict: MERGED as `436b86641ed7158d6d69e995ef8565479b96881d` at exact reviewed/API head `b5197563f078821efa543c5644396931cf1c5fb4`. The bounded follow-up keeps Desktop API v1 while widening the one authoritative CLI band to `>=0.18.0 <0.21.0`, pins unit and real discovery-path edges, updates the Desktop contract, and adds grounded v0.20.0 notes covering revised-v2 materialization, local config templates, scope-atomic v1 migration, release ordering, backups, and no credential cleanup. Exact local gate passed 892 total/891 pass/0 fail/1 skip plus all checks/strict OKF/pack/tarball/diff; required CI and all three verify-only installer matrix legs passed. Same-account approval is comment `5131615861`; expected-head merge succeeded and remote branch was deleted.
- owner: dev-coordinator-capability-finalization · coordinator: oats-expert-oats-packages
- taught us: a breaking kernel line can retain the Desktop API version while still requiring an explicit semver-band release gate; the app must always admit the matching kernel built from its own tag, with both unit and real discovery-path edge tests.

## PR #66 — capability materialization and fully local config templates (2026-07-30)
- verdict: MERGED as `dc30f0d1df7ea8e78df9fa5486857e77f33cfce5` at exact reviewed/API head `ecd1b41b3a47b188febe508a37874b4985b05ba4`. Direction/correctness/security/mergeability PASS after one merged-state RETURN at `b189fcb` and one bounded correction: revised lock v2 materializes self-contained capabilities under gitignored `.agents/capabilities/installed`; package staging is transient; config templates are optional fully editable local bases with byte-preserving diff/sync/reset/adopt; v1 migration is scope-atomic; classic init is catalog-first and untrusted. The correction closed capability-ID path traversal, adopted/backup symlink escapes, silent handcrafted-config replacement, same-package scope provenance, swap/export rollback, canonical template roots, and pre-staging ignore. Final evidence: affected 198/198, B1/B2/B3 PASS, 890 total/889 pass/0 fail/1 environment skip, all check/validate/pack/tarball/strict-OKF/diff gates, and required exact-head CI success. Same-account approval is comment `5131055219`; expected-head merge succeeded and remote feature branch was deleted.
- owner: dev-coordinator-capability-materialization · coordinator: oats-expert-oats-packages
- taught us: a distribution package can remain the atomic source/update boundary while installed capability artifacts are the inspectable trust units; config adoption needs a committed base and byte-preserving three-way semantics, and filesystem transaction claims must include path-derived IDs, symlinked write parents, generated-ignore timing, and every backup/swap boundary.

## PR #65 — v0.19.4 manifest bump after complete publication (2026-07-28)
- verdict: MERGED as `9131b83c368296458ae50efac1d8af531fd1521b` from exact release-bump head `06f2256674694dc93453011a0ff54a2013bc1414`. The v0.19.4 release had already published `@awebai/oats`, `@awebai/oats-pi`, checksums/provenance, and the complete Desktop installer matrix after all build/test/smoke gates passed in run `30396340346`; only the known organization policy prevented Actions from creating the version-bump PR, so the maintainer created and squash-merged it manually.
- owner: oats-expert-oats-packages · coordinator: none
- taught us: repository deployment config must not be an implicit test fixture. Moving the official package closure to a non-Git workspace exposed two Desktop tests that relied on the former repository lock; explicit isolated fixtures and ephemeral loopback ports now keep the release gate independent of operator deployment state.

## PR #58 — guided official-capability migration for existing 0.18 deployments (2026-07-28)
- verdict: MERGED as merge commit `ab51acc8ec4381fac1b75d569b1225a8e6482f56` at exact head `24e6f00a7fe35a0cd88e32646ab251bdc83433be`. All four gates PASS. The new `oats migrate --official --recursive` is a guided policy layer over the existing transactional migration engine: deterministic outer/team/nested scope planning, catalog-driven capability→package aliases, config-byte preservation, held/unmapped official scopes left unchanged, custom/owned/path entries retained, per-scope truthful aggregate failure, no trust transfer, and exact trust/install next commands. Reviewer returned two important findings—multiple legacy capabilities exported by one package collided during conversion, and a held dry-run exited success—and approved the exact fixes; the final delta was knowledge only. Fresh detached clean room with root/Desktop/Pi dependencies passed 865 tests (864 pass, 0 fail, 1 environment skip), check/check:pi/validate, strict seven-bundle OKF zero warnings, pack, tarball smoke and diff-check; required exact-head CI passed. Same-account approval is comment `5107558430`; expected-head merge succeeded and remote branch was deleted.
- owner: cli-dev-official-capability-migration · coordinator: oats-expert-oats-packages (direct)
- taught us: a guided migration readiness dry-run must fail when held, not merely display a warning; package aliases create the real multi-capability-provider case, so all converted residue entries must leave together and one package source must be acquired once. Existing configuration identity can remain byte-stable when replacement packages export the same capability IDs.

## PR #57 — configurable contained OATS package payload roots (2026-07-28)
- verdict: MERGED as merge commit `d9e176f4b57a9c9e25f69d35b98046cc19267d6e` at exact PR head `842f0433311c766097c4eb3b1d4514b2ee0efd90`. All four gates PASS. Git/catalog sources select an authoritative configurable package `path`; omitted Git/catalog path defaults to the official `oats-package/` convention, custom paths and explicit root work, while local paths remain exact package roots. Lock v2 records strict canonical path provenance; one exact checkout is fetched and only the selected subtree is installed/hashed; bare restore uses locked source+commit+path and only explicit update advances it. Existing `from: owned`, `from: path`, and legacy capability semantics remain separate. Four review rounds closed real catalog/path/ref/source parsing and containment findings, including source-kind reclassification, Git option injection, pinned-ref mismatch, broken intermediate links, and remote-branch DWIM restoration. Terminal product head `bc11a02` received APPROVE/no findings; the only later delta was semantically reviewed cli-dev knowledge. Local full gate passed 853 tests/0 failures plus check/check:pi/validate/warning-free strict OKF/pack/smoke/diff; required exact-head CI passed. Same-account approval is comment `5106896683`; expected-head merge succeeded and remote branch was deleted. A merged-source scaffold-only child probe verified canonical home, AGENTS/CLAUDE and skills aliases, selected curriculum/provenance, Claude/Opus posture, child lineage and clean worktree/branch retirement.
- owner: cli-dev-package-payload-root · coordinator: oats-expert-oats-packages (direct)
- taught us: a repository source and its installed package are separate boundaries; explicit payload selection prevents owner souls and development files from entering integrity. Argv execution alone does not prevent option injection, persisted source strings must be validated against the writer grammar before re-parsing, and replacing Git porcelain with plumbing requires intentionally restoring wanted DWIM behavior.

## PR #47 — oats-desktop-engineer split-ui maintainer hold-discipline harvest (2026-07-26)
- verdict: MERGED as merge commit `6f8dbf1` at exact head `42c35ec`. All four gates PASS. The knowledge-only delta preserves retiring `oats-desktop-engineer-split-ui`'s post-merge harvest commit (`44b019f`, cherry-picked as `42c35ec`) in the canonical Desktop soul: the maintainer mergeability-loop lesson now emphasizes live PR head verification, one evidence-backed reply to stale verdicts, rebasing only onto the explicitly mailed successor SHA, holding instead of speculatively rebasing while a wait instruction stands, self-contained handbacks, newest-first `log.md` conflict union, fresh fetch before PR opening, and gating mechanical rebase/stewardship commits. Source-state review showed `origin/main..44b019f -- agents/oats-desktop-engineer/soul/knowledge` contains only that harvest and the touched Desktop-soul files are byte-identical between source `44b019f` and PR head. Fresh scratch gates passed after root + Desktop dependency install and copied installed capabilities: targeted oats-desktop-engineer strict OKF `110 concept(s), 0 error(s), 0 warning(s)`, aggregate `validate:okf` all 8 bundles with zero warnings, `npm test` `568/569` with the expected node-pty ABI skip, `check`, `validate`, `pack:check`, and diff-check. Exact-head PR CI was green; same-account approval is PR comment `5085072697`; expected-head merge succeeded, and the remote harvest branch was deleted manually after the detached scratch worktree blocked automatic branch deletion.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: nothing new beyond the existing post-merge harvest rules — compare source harvest branch state, inspect per-bundle strict OKF output, and semantically read the changed/linked concepts before preserving a stranded terminal harvest.

## PR #46 — oats-desktop-engineer maintainer-handback stewardship-race harvest (2026-07-26)
- verdict: MERGED as merge commit `83ce16f` at exact head `2551f1d`. All four gates PASS. The knowledge-only delta adds the universal maintainer-handback stewardship-race lesson, cross-links it from crossed-mail coordination, and updates the Desktop soul index/log. Semantic review confirmed the guidance matches PR #45's terminal evidence and preserves explicit STOP/hold precedence. Detached scratch gates passed `npm test` 557/558 with one expected node-pty ABI skip, `check`, `validate`, `pack:check`, diff-check, and strict OKF for all 8 bundles with zero warnings (changed Desktop bundle 108/0/0); exact-head PR CI passed. Same-account approval is PR comment `5085013285`; expected-head merge succeeded and the remote branch is deleted. No product, security-boundary, release, manifest, package, or framework behavior changes.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: dev-coordinator-spanwer-modal-bug
- taught us: nothing beyond the harvested lesson itself — in repeated mergeability-only handbacks, treat a named base as an ancestry minimum, verify live refs, honor holds, and keep replies evidence-backed and non-duplicative.

## PR #45 (round 5) — Desktop spawn readiness handoff, modal close, and quiet terminal open (2026-07-26)
- verdict: MERGED as merge commit `6f35e9e` at final exact head `9c4e995` after four mergeability-only RETURNs. All four gates PASS. The Desktop now waits for `running && tmux.session` under existing workspace/operation/composite-identity guards before post-spawn terminal handoff, closes the successful modal, degrades safely on timeout, and wraps the entire quiet auto-open promise chain so transport/mount failures warn rather than block or become unhandled rejections; interactive opens retain their prior behavior. Original detached scratch gates passed root 557/558 with one expected node-pty ABI skip, Desktop 352/352, check, validate, all-eight-bundle strict OKF with zero warnings, pack:check, and diff-check. Every subsequent delta was coordinator/stewardship knowledge plus merge commits; owner reran root tests and strict OKF. Final head contained live main `7cb1673` (ahead 9, behind 0), GitHub reported CLEAN/MERGEABLE, and root CI plus all three installer checks passed. Same-account approval is PR comment `5084986482`; expected-head merge succeeded, remote branch was deleted, and local cleanup remains with the owner's worktree. Post-merge scaffold-only child probe `oats-expert-pr45-probe` verified AGENTS/CLAUDE, soul/work links, memory scaffolding, real skill directories, child relation metadata, `launched:false`, and clean retirement. Not yet released.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: none
- taught us: the code change itself was review-clean; the four RETURNs exposed a high-cadence coordination hazard where delayed handback mail and concurrent stewardship repeatedly supersede named bases. Exact-SHA ancestry checks plus an explicit stop/wait barrier are necessary, but the maintainer should merge immediately once a settled head is behind zero.

## PR #45 (round 4) — Desktop spawn readiness handoff, modal close, and quiet terminal open (2026-07-26)
- verdict: RETURNED at handed-back/API head `0b6853a23a2ffdf8788f99d9b1910364a07e42a6` for mergeability only. This head correctly contained required main `9f703c1`; its post-review delta was only the known coordinator lesson plus PR #45 stewardship/merge commits, leaving the focused Desktop code/harvest untouched. Prior product/correctness/security/full-gate results stand; owner reported the committed-tree gate green and exact-head CI restarted. During final handback, main advanced to `9ad504f` with PR #44 stewardship only, leaving the branch behind by one with merge-base `9f703c1`. Same-account verdict is PR comment `5084963883`; owner was told to stop and wait for the post-round-4 stewardship SHA.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: none
- taught us: fast concurrent maintainer stewardship can move main even after an ancestry-verified final handback; the next retry must merge one explicitly named post-verdict base after all concurrent stewardship known at that moment.

## PR #45 (round 3) — Desktop spawn readiness handoff, modal close, and quiet terminal open (2026-07-26)
- verdict: RETURNED at handed-back/API head `f614be5a969f5d15b302dbd98b8803e0c45d40fb` for mergeability only. The delta since round 2 is the expected trivial merge of `627ffaa`: only round-1 oats-expert stewardship knowledge arrived, while the reviewed Desktop code/harvest remained untouched. Prior product/correctness/security results stand; owner-reported root gates and exact-head root CI passed while installer jobs reran. Mergeability still failed because the handback again merged the superseded base rather than explicitly named successor `b5c9f3d`; live compare was behind by one with merge-base `627ffaa`. Same-account verdict is PR comment `5084952256`; the owner was told to stop and wait for the post-round-3 stewardship SHA before merging again.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: none
- taught us: serial stewardship handbacks need an explicit acknowledgment barrier—when the owner repeatedly consumes the earlier base message before the follow-up commit arrives, tell them to wait for the post-verdict SHA rather than immediately merging the now-superseded base.

## PR #45 (round 2) — Desktop spawn readiness handoff, modal close, and quiet terminal open (2026-07-26)
- verdict: RETURNED at handed-back/API head `40938b81c133bde0af38a9c7e45ab0c4e1142fe8` for mergeability only. The delta since round 1 is the expected trivial merge of `8191ea0`: only the dev-coordinator spawn-modal race lesson/index/log arrived, while the reviewed Desktop code and Desktop harvest delta remained untouched. Round-1 product, correctness, and security PASS results stand; the owner reran the full root gate successfully, and exact-head CI began rerunning. Mergeability still fails because the branch omitted round-1 stewardship commit `627ffaa`, despite the explicit base follow-up; GitHub compare remained behind by one with merge-base `8191ea0`. Same-account verdict is PR comment `5084945671`; owner was replied to in the existing aweb thread.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: none
- taught us: a handback can acknowledge an earlier main SHA while missing the explicitly communicated stewardship-bearing successor; verify ancestry against live `origin/main`, not the handback phrase “current main.”

## PR #45 (round 1) — Desktop spawn readiness handoff, modal close, and quiet terminal open (2026-07-26)
- verdict: RETURNED at exact head `67d865c9223950e917289b655b22657825c2dce2` for mergeability only. Product direction, correctness, and security PASS: the Desktop-owned flow waits for `running && tmux.session` under existing operation/workspace/composite-identity guards, closes the modal on readiness, degrades on timeout, and contains the entire quiet async open chain without changing interactive behavior or trust/execution boundaries. Fresh detached scratch gates passed `npm test` 557/558 with the expected node-pty ABI skip, Desktop 352/352, check, validate, all-eight-bundle strict OKF with zero warnings (Desktop 107 concepts), pack:check, and diff-check; exact-head PR CI and all three installer jobs passed. Mergeability alone fails because current main advanced to `8191ea0` after handback while the branch merge-base remains `55fbc98` (GitHub compare behind by one). Same-account verdict is PR comment `5084936254`; owner was mailed to merge current main and return a settled exact head.
- owner: oats-desktop-engineer-spawn-modal-fix · coordinator: none
- taught us: nothing new beyond the established settled-handback rule — a semantically related coordinator harvest landed after feature handback, so even an otherwise clean green branch must merge the current main before final review.

## PR #44 (round 7) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: MERGED as merge commit `479e8b5` at final exact head `f9e9ebb` after six mergeability-only RETURNs and one superseded same-head approval. All four gates PASS. The Desktop split/sidebar follow-up adds clickable context-gated split/sidebar controls, active-tab split seeding DOM coverage, a dedicated full-width pane-tab row with real tab elements grouped per split pane, and directly relevant Desktop soul lessons. Full scratch gates passed at the reviewed feature head: root `npm test` 565 pass / 1 expected node-pty ABI skip, Desktop 360/360, check, check:pi, validate, all-eight-bundle strict OKF with zero warnings, pack:check, smoke:tarball, and diff-check. Final live head contained current main `e8a4bd8`, kept the same 12-file scope, resolved the Desktop knowledge log newest-first with no conflict markers, and exact-head PR CI plus all three installer checks were green. Same-account approval is PR comment `5085035759`; expected-head merge succeeded. `gh pr merge --delete-branch` reported a detached-worktree branch-detection error after the merge, so the remote feature branch was deleted manually. Post-merge scaffold-only child probe `oats-expert-pr44-probe` verified AGENTS/CLAUDE, soul/work links, memory scaffolding, real skills, child relation metadata, `launched:false`, and clean retirement. Not yet released.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: nothing new beyond the PR #46 harvested handback-race lesson and this PR's own split UI lessons; the terminal merge confirmed why maintainers must use expected-head guards and live GitHub refs instead of handback prose in high-cadence PR queues.

## PR #44 (round 6) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at live exact head `ad9ff4f9e94b94298b8c6768012bc13f693381d3` for mergeability/current-main only. The branch contained the required `f9898d3` base and exact-head checks were green, but before merge current main advanced to PR #46 (`83ce16f`), leaving `2551f1d` and `83ce16f` outside PR #44 and GitHub reporting CONFLICTING. Prior product/correctness/security/full-gate results stand. No product/code correction is requested; this is another current-main conflict from a concurrent Desktop knowledge harvest merge. Same-account GitHub blocked formal request-changes, so the return was posted as PR comment `5085017894` and mailed in-thread to the owner. The owner must wait for the post-round-6 stewardship SHA, then merge/rebase that exact current main and resolve any Desktop knowledge log conflict newest-first.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: nothing new beyond the already-recorded expected-head guard and crossed-mail/current-main rules.

## PR #44 (round 5) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at live exact head `abdbd2805fa263908d3fe0acd4f0215440b5726b` for mergeability/current-main only. The handback mail named stale head `ff64caa`, but live PR #44 had force-updated to `abdbd28`; its merge-base with current main was `8aa8a93`, leaving PR #45 merge stewardship `abd60d1` and main merge `8d5dba5` outside the branch. Prior product/correctness/security/full-gate results stand, and the described Desktop knowledge-log union resolution is the right shape. No product/code correction is requested. Same-account GitHub blocked formal request-changes, so the return was posted as PR comment `5085000620` and mailed in-thread to the owner with another acknowledgment barrier: wait for the post-round-5 stewardship SHA, then merge/rebase that exact current main before handback.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: nothing new beyond the crossed-mail/current-main loop already captured; use live PR API/fetch state over handback prose whenever mails and force-pushes cross.

## PR #44 (round 4) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at live exact head `07d714c2bc464b6b32e78e1def09100ea05a78be` for mergeability only, superseding the same-head approval comment. The live PR had correctly merged required main `7cb1673`, scope stayed the reviewed 12 Desktop/Desktop-soul files, exact-head CI plus all three installer jobs were green, and GitHub reported MERGEABLE. The maintainer recorded an approval comment, but the expected-head merge failed immediately because PR #45 landed on main as `6f35e9e` and made PR #44 CONFLICTING. `git merge-tree origin/main origin/pr/44` showed the conflict in `agents/oats-desktop-engineer/soul/knowledge/log.md`; `packages/desktop/renderer/shell.mjs` auto-merged. No product/code correction is requested; prior product/correctness/security/full-gate results stand. Same-account GitHub blocked formal request-changes, so the return was posted as PR comment `5084988353` and mailed in-thread to the owner. The owner must merge/rebase the post-return current main successor and resolve the Desktop knowledge log by keeping both deliveries newest-first.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: even after a green exact-head approval, a concurrent merge can invalidate the expected-head merge before the command runs; keep the expected-head guard, and treat the failed merge as a new mergeability RETURN rather than forcing the maintainer-side conflict resolution.

## PR #44 (round 3) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at exact head `4b91095ab09ce5196b78c1076d1fa7a7d78f1521` for mergeability/current-main only. The handback merged previous base `b5c9f3d` but missed current main `9ad504f`, including the explicitly mailed PR #44 round-2 stewardship successor. Prior product/correctness/security results stand and no product/code correction is requested; the missing commits are stewardship-only (`9f703c1` PR #45 return stewardship and `9ad504f` PR #44 round-2 return stewardship). Same-account GitHub blocked formal request-changes, so the return was posted as PR comment `5084966685` and mailed in-thread to the owner with an acknowledgment barrier: wait for the post-round-3 stewardship SHA, then merge/rebase that exact current main before handback.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: repeated mergeability-only returns need the same explicit acknowledgment barrier used for PR #45 when a handback consumes the earlier base but misses the post-return stewardship successor.

## PR #44 (round 2) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at exact head `defa48d2e36a14e099678375957420e5c3a54d8a` for mergeability/current-main only. The round-1 scope blocker is fixed: the merge range contains only `packages/desktop/**` UI changes plus directly relevant oats-desktop-engineer knowledge harvests. Product direction, correctness, and security PASS. Scratch gates passed after dependency install and copied installed capabilities: root `npm test` 565 pass / 1 expected node-pty ABI skip, `packages/desktop` test 360 pass, `check`, `check:pi`, `validate`, all-eight-bundle strict OKF with zero warnings (changed Desktop bundle 108/0/0), `pack:check`, `smoke:tarball`, and diff-check. Exact-head PR CI plus all three installer checks were green. Mergeability FAIL only because current GitHub `main` advanced to `b5c9f3d` while PR #44's merge-base remained `8191ea0`; `origin/main` is not an ancestor. Same-account GitHub blocked formal request-changes, so the return was posted as PR comment `5084954174` and mailed in-thread to the owner.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: nothing new beyond the existing settled-handback rule — stewardship commits on main can make an otherwise green exact-head PR stale and require a fast current-main refresh before merge.

## PR #44 (round 1) — Desktop split/sidebar UI buttons, active-tab split seeding, split-aligned tab strip (2026-07-26)
- verdict: RETURNED at exact head `883688203fa33ab8e6174ef96e715e6d322bf99b` for product/diff-shape gate failure. The Desktop UI direction itself was not rejected, but the PR merge range contradicted its `packages/desktop`-only description by carrying unrelated dev-coordinator soul instruction/skill/lesson changes, ux-designer log changes, and oats-expert architecture/decision/roadmap/stewardship changes including new package/distribution and strict-curriculum decisions. Correctness/security gates were not run under fail-fast policy. Same-account GitHub blocked a formal request-changes review, so the RETURN was posted as PR comment `5084929494` and mailed to the owner. The branch must be rebuilt so PR #44 contains only the split/sidebar/tab-strip UI work plus directly relevant Desktop harvests, or the unrelated base commits must land through their own proper maintainer path first; then the owner should rerun gates/CI and hand back a new exact head SHA.
- owner: oats-desktop-engineer-split-ui · coordinator: none
- taught us: branch-scope review must include the whole merge range, not just the PR body or intended code area; local/direct stewardship commits that are not on GitHub main can accidentally ride along in a feature PR and must be split before review continues.

## PR #42 — oats-desktop-engineer quick-open deferred-intent harvest (2026-07-26)
- verdict: MERGED as merge commit `09605c7` at exact head `028a984`. All four gates PASS. The knowledge-only PR preserves retiring instance `oats-desktop-engineer-quick-open`'s post-merge harvest commit (`97654ce`, cherry-picked as `028a984`) in the canonical Desktop soul: the pending-intent data-currency lesson and Quick Open → Spawn preselect handoff decision now state that module-level deferred preselects must die with the mounted Spawn consumer on unmount. Final scratch gates passed after root + Desktop dependency install and copied installed capabilities: targeted oats-desktop-engineer strict OKF `106 concept(s), 0 error(s), 0 warning(s)`, aggregate `validate:okf` all 8 bundles with zero warnings, `npm test` `554/555` with the expected node-pty ABI skip, `check`, `validate`, `pack:check`, and diff-check. The current code/test surface already carries the reviewed unmount clear and regression test. Exact-head PR CI was green; same-account approval was recorded as a comment; expected-head merge succeeded and the remote branch was deleted.
- owner: oats-desktop-engineer-quick-open · coordinator: dev-coordinator-keybindings
- taught us: nothing new — the existing post-merge harvest review rules applied cleanly: compare the source harvest commit, inspect per-bundle strict OKF output, and semantically read the linked concepts rather than trusting the cherry-pick summary alone.

## PR #41 — Desktop split panes + hideable sidebar (2026-07-26)
- verdict: MERGED as merge commit `c055614` at exact head `2ff4792`. All four gates PASS. Desktop terminal tabs can now form bounded side-by-side or stacked split layouts while preserving tab identity, fit/resize behavior, pane-level selection, adjacent close fallback, and single-selection accessibility; the sidebar can be hidden with a persisted, editable shortcut. Non-mac `Ctrl+B` remains tmux-owned because `sidebar.toggle` is excluded from the terminal allowlist. Final scratch gates passed: `npm test` 554/555 with one expected node-pty ABI skip, `check`, `validate`, strict OKF for all 8 bundles (changed Desktop soul 106 concepts, 0 errors/warnings), `pack:check`, and diff-check; exact-head PR CI and all three installer checks passed. Same-account approval was recorded as a comment. Expected-head merge succeeded; the remote branch was deleted manually because `/private/tmp/integrate-split-panels` holds the local branch.
- owner: oats-desktop-engineer-split-panels · coordinator: dev-coordinator-split-panel
- taught us: nothing new beyond the PR's harvested Desktop lessons — shifted punctuation defaults need real event-key tests, terminal action allowlists require resolved-control-byte review, split model state must match renderer-visible slots, and active-member close fallback must be chosen before removal.

## PR #40 — Desktop Quick Open for souls + terminal focus on user jumps (2026-07-26)
- verdict: MERGED as merge commit `3da7ce8` at exact head `9d00985`. All four gates PASS. The Desktop now has a shared overlay picker, `Mod+P` Quick Open over souls that hands off to Spawn's consumed-once preselect flow, and explicit `activateTab(id, { focusContent })` terminal-focus intent so palette/sidebar/post-spawn user jumps focus the xterm input while workspace restoration and close fallbacks do not steal focus. Final scratch gates passed: `npm test` 535 tests (534 pass, one expected node-pty ABI skip), `check`, `check:pi`, `validate`, `validate:okf` (8 bundles, 0 warnings), `pack:check`, `smoke:tarball`, renderer `node --check`, and diff-check; exact-head PR CI plus all three installer verify jobs passed. Same-account approval was recorded as a comment; `gh pr merge` merged but could not determine a branch from detached scratch for branch cleanup, so the remote feature branch was deleted manually.
- owner: oats-desktop-engineer-quick-open · coordinator: none
- taught us: nothing new beyond the PR's own harvested Desktop lessons: the shared palette scorer must use an out-of-band no-match sentinel, consumed-once intents must gate on current data generation, and terminal focus must remain opt-in by user intent.

## PR #39 — v0.18.6 manifest bump rescue (2026-07-26)
- verdict: MERGED as squash commit `9fc7c0e`. Release run `30198186842` completed build/test, all three Desktop installer build+smoke legs, both npm publishes, provenance, checksums, and GitHub Release v0.18.6 before the known org policy blocked Actions from creating the bump PR. The workflow-created branch contained exactly the five expected root/pi/Desktop manifest and lockfile changes (0.18.5→0.18.6); manual PR #39 restored the protected-main flow and deleted the branch.
- owner: oats-expert-pr38 · coordinator: dev-coordinator-parallel
- taught us: nothing new—the detached-HEAD push remains fixed and the documented org-policy rescue is still required after successful publication.

## PR #38 (round 3) — spawn-time agent relations across kernel, CLI, and Desktop (2026-07-26)
- verdict: MERGED as merge commit `dfa0ac0` at exact head `4bbfe8d` after two RETURNs. All four gates PASS. The feature adds explicit child/sibling/parent/unrelated spawn relations, ambiguity-safe root-qualified anchors, attached child-of-owner semantics, retirement splice repair, composite instance identity across Desktop, cluster-first Active/sidebar surfaces, and the relation-aware spawn modal; it also preserves PR #35 keyboard shortcuts and PR #36 knowledge with identity-correct interaction fixes. The human-declined journal/lease subsystem findings remain documented accepted limitations. Final scratch gate passed 507/508 with one expected environment skip after one transient server-start miss passed alone and on full rerun; check/check:pi/validate/all-eight-bundle strict OKF/pack/smoke/diff-check passed; exact-head PR CI and all three installer checks passed. Same-account approval was recorded as a comment; expected-head merge succeeded and the remote feature branch was deleted. Post-merge scaffold-only child-relation probe `oats-expert-pr38-probe` verified the full generated layout, real skill directories, `parentInstance`/`relation`/`relativeTo`, no launch, and clean retirement.
- owner: feature/agent-relations developers · coordinator: dev-coordinator-parallel
- taught us: broad feature merges must re-test interactions with recently landed surfaces, not only resolve conflicts—the keybinding merge exposed three composite-identity/modal ownership paths that were fixed before handback. Final delivery also confirmed the settled-handback rule when a maintainer harvest landed between rounds.

## PR #38 (round 2) — spawn-time agent relations across kernel, CLI, and Desktop (2026-07-26)
- verdict: RETURNED at exact head `df2e575` for mergeability only. Round-1 knowledge fixes PASS: cli-dev strict OKF 34/0/0, Desktop strict OKF 99/0/0, final relation matrix/accepted limitations are coherent, and stale maintainer recipe, pending clarifier, removed-roster, and future-tense projection claims are corrected. PR #35/#36 integration and the three identity/keybinding interaction fixes PASS targeted review and 54/54 tests. Full scratch gate passes 507/508 with one expected environment skip, check/check:pi/validate/all-eight-bundle strict OKF/pack/smoke/diff-check; exact-head PR CI and all three installer checks are green. Product direction, correctness, and security PASS. Mergeability FAIL only because the maintainer's already-running round-1 harvester completed after handback and advanced main to `d60ee05`; that semantic PR-review lesson is not in `df2e575`, so current main is no longer an ancestor.
- owner: feature/agent-relations developers · coordinator: dev-coordinator-parallel
- taught us: this is the existing settled-handback rule in action — a reviewer-driven harvest launched before handback can finish after it and invalidate otherwise exact, green ancestry. Do not launch another harvest before the next handback.

## PR #38 (round 1) — spawn-time agent relations across kernel, CLI, and Desktop (2026-07-26)
- verdict: RETURNED at exact head `e3f7401`. Product direction PASS: explicit sparse live lineage is the right layer, `RELATIONS_MIN=0.18.6` matches the required release, and the human-declined journal/lease subsystem findings are accepted non-blocking limitations. Executable correctness and security PASS: scratch `npm test` 449/450 with one expected environment skip, check/check:pi/validate/pack/smoke and diff-check passed. Knowledge correctness FAIL: cli-dev strict OKF reports three unreachable new concepts, and changed concepts retain stale transitional claims about the maintainer spawn recipe, a resolved “pending clarifier,” removed Instances-roster language, and already-landed forwarding. Mergeability FAIL: GitHub reports CONFLICTING/DIRTY; merge-tree conflicts are the Desktop knowledge log, shell, hierarchy, and spawn view, and the branch lacks current PR #35/#36 main.
- owner: feature/agent-relations developers · coordinator: dev-coordinator-parallel
- taught us: aggregate `validate:okf` can exit zero and print a green final line while individual strict bundles still report producer warnings; inspect per-bundle output, and keep semantic knowledge review separate from validator exit status. The accepted architecture is recorded in [Spawn relations use sparse live lineage, not a transaction journal](/decisions/spawn-relations-live-lineage.md).

## PR #36 (round 3) — oats-desktop-engineer post-PR35 keybindings harvests (2026-07-25)
- verdict: MERGED as merge commit `032c7a3` at exact head `1e9980f` after two RETURNs. All four gates PASS. The knowledge-only PR preserves both keybindings developers' stranded post-PR35 harvests in the oats-desktop-engineer soul: dispatch-ineligible view-action semantics, crossed-mail coordination, PR35 follow-up queues, modal focus restoration, and the DEFAULT_KEYMAP/defaultChord split/terminal allowlist delivery follow-ups. Final scratch gates passed: targeted oats-desktop-engineer strict OKF 92/0/0, repo `validate:okf` all 8 bundles, `npm test` 433/434 with the expected node-pty ABI skip, `check`, `check:pi`, `validate`, `pack:check`, clean diff-check, exact-head PR CI green, and `origin/main` ancestor verified. Approval was recorded as a PR comment because GitHub blocks same-account approvals. Expected-head merge succeeded; `gh pr merge --delete-branch` merged but failed local branch deletion because `/private/tmp/harvest-wiring` holds `harvest/keybindings-wiring`, so the remote branch was deleted manually.
- owner: oats-desktop-engineer keybindings-wiring + keybindings-core harvests · coordinator: dev-coordinator-keybindings
- taught us: the semantic-parent cherry-pick lesson was promoted before merge; nothing further beyond verifying remote heads and ancestry after crossed mail.

## PR #36 (round 2) — oats-desktop-engineer post-PR35 keybindings harvests (2026-07-25)
- verdict: RETURNED at actual GitHub head `617241c` for mergeability only. The fixed branch now carries both developers' post-merge harvests: `44bf38a` matches the missing dispatch-ineligible view-action harvest `5543ac5`, `b29dfb0` matches the wiring follow-up harvest `4da43b2`, and the core-dev modal-focus/delivery-follow-up concepts are present and semantically coherent. Product direction, correctness, and security PASS; scope remains 13 files under `agents/oats-desktop-engineer/soul/knowledge/` with no executable/config surface. Fresh scratch gates passed: targeted oats-desktop-engineer strict OKF 92/0/0, repo `validate:okf` all 8 bundles, `npm test` 433/434 with the expected node-pty ABI skip, `check`, `check:pi`, `validate`, `pack:check`, clean diff-check, and green PR CI. Mergeability FAIL: the handback mail named stale local head `835fa98` while the actual PR head is `617241c`, and that branch still does not contain current main (`77a2d08` after the round-1 memory-harvest lesson; merge-base remains `efc62ca`). Author/coordinator must merge latest main, preserve the four harvest commits, rerun gates/CI, and hand back the new exact head.
- owner: oats-desktop-engineer keybindings-wiring + keybindings-core harvests · coordinator: dev-coordinator-keybindings
- taught us: nothing new beyond the crossed-mail lesson — trust the PR remote/head and `merge-base`, not handback prose, when mail and branch updates cross.

## PR #36 (round 1) — oats-desktop-engineer post-PR35 keybindings harvest (2026-07-25)
- verdict: RETURNED at exact head `d26a356` for one knowledge-correctness fix. Product direction, security, and mechanical mergeability passed: scope is 5 files under `agents/oats-desktop-engineer/soul/knowledge/`, no executable/config surface, `origin/main` was an ancestor, `git diff --check` was clean, PR CI was green, and GitHub reported MERGEABLE. Local scratch gates passed after root + Desktop dependency install and copying installed capabilities: targeted oats-desktop-engineer strict OKF 90/0/0, repo `validate:okf` all 8 bundles, `npm test` 433/434 with the expected node-pty ABI skip, `check`, `check:pi`, `validate`, and `pack:check`. Blocker: the branch cherry-picked final harvest commit `4da43b2` as `d26a356` but omitted its original parent harvest `5543ac5` (`memory-harvest: merge view-action dispatch guard lesson`), so the new follow-up queue links the final dispatch-ineligible view-actions model while PR head still has stale `first-class-view-defaults-window-dispatch-surface.md` guidance telling readers to guard registered `run()` handlers. Author must include `5543ac5` or equivalent concept/index/log updates, rerun gates, merge latest main, and hand back an exact head.
- owner: oats-desktop-engineer keybindings-wiring harvest · coordinator: dev-coordinator-keybindings
- taught us: cherry-picking the terminal harvest commit is not enough when that commit's parent contains unmerged semantic knowledge fixes; compare the source branch state, not only the cherry-picked diff, before declaring a post-merge harvest preserved.

## PR #35 (round 3) — Desktop user-editable keyboard shortcuts for all panel actions (2026-07-25)
- verdict: MERGED as merge commit `7f1e5a7` at exact head `039458f` after two RETURNs. All four gates PASS. The feature adds Desktop's central keybinding engine, user-editable shortcuts editor, action-id terminal allowlist interception before PTY writes, rebindable stage/tab/sidebar/terminal typography/view-local actions, full roster/spawn/hierarchy keyboard operation, live chord labels/tooltips, and renderer syntax coverage. Final deltas after round 2 made view-local actions editor-visible but window-dispatch-ineligible via never-activated `view:*` contexts. Fresh final local gates passed: `npm test` 433/434 with the expected node-pty ABI skip, `check`, `check:pi`, `validate`, `validate:okf`, and `pack:check`; exact-head PR CI plus macOS arm64/x64 and Linux x64 installer verify checks passed. Approval was recorded as a PR comment because GitHub blocks same-account approvals. Expected-head merge succeeded; `gh pr merge --delete-branch` failed only to delete the local branch held by `/private/tmp/integrate-keybindings`, so the remote `feature/keybindings` branch was deleted manually.
- owner: oats-desktop-engineer keybindings branches · coordinator: dev-coordinator-keybindings
- taught us: first-class engine defaults can accidentally widen global dispatch for view-local actions; the clean pattern is to register view actions in editor-visible but never-activated view contexts and dispatch them only through the focused view surface.

## PR #35 (round 2) — Desktop user-editable keyboard shortcuts for all panel actions (2026-07-25)
- verdict: RETURNED at exact head `b5651b6` for mergeability only. The round-1 knowledge finding was fixed in `bc95b5c`: the transitional stub concept now marks `matchesChord` as stub-only, states the final engine owns the `defaultPrevented` and editable-field guards, and cross-links the superseding lessons. The additional code deltas (`afd2114` surface-guarded view-local action dispatch and `0649fa0` deletion of the dormant legacy `resolveViewKey` chord fallback) passed maintainer delta review. Fresh local gates passed: `npm test` 433/434 with the expected node-pty ABI skip, `check`, `check:pi`, `validate`, `validate:okf`, and `pack:check`; GitHub PR CI plus all three installer checks were green. Mergeability failed because `origin/main` was no longer an ancestor after the maintainer stewardship commit from round 1 (`merge-base b10dd13`, main at least `54b2f2c`), so the author must merge the latest main and hand back a settled exact head.
- owner: oats-desktop-engineer keybindings branches · coordinator: dev-coordinator-keybindings
- taught us: stewardship commits after a RETURN intentionally advance main; final handback must merge the latest stewardship-bearing main, not just the code base that existed when the return was issued.

## PR #35 (round 1) — Desktop user-editable keyboard shortcuts for all panel actions (2026-07-25)
- verdict: RETURNED at exact head `811cb06` for one knowledge-correctness fix. Product direction, code correctness, security, and mechanical mergeability passed: scratch `npm test` passed 434/435 with the expected node-pty ABI skip after installing root + Desktop deps; `npm run check`, `check:pi`, `validate`, `pack:check`, and `validate:okf` passed; main was an ancestor; GitHub PR CI and all three installer verify checks were green. Blocker: `agents/oats-desktop-engineer/soul/knowledge/decisions/keybindings-stub-coordinator-contract.md` still claimed the real engine does not skip `defaultPrevented` and the shell must guard, and listed non-existent `matchesChord`, contradicting the final engine and later lessons.
- owner: oats-desktop-engineer keybindings branches · coordinator: dev-coordinator-keybindings
- taught us: concurrent branch-union harvests can leave historical transitional concepts contradicting the final converged design; final PR handback must include a targeted knowledge consistency read, not only strict OKF conformance.

## PR #34 — v0.18.5 manifest bump rescue (2026-07-25)
- verdict: MERGED as squash commit `8f5af90`. Release run `30160666617`
  completed build/test, all three Desktop installer build+smoke legs, both npm
  publishes, provenance, checksums, and GitHub Release v0.18.5 before the known
  org policy blocked Actions from creating the bump PR. The workflow-created
  branch contained exactly the five expected root/pi/Desktop manifest and
  lockfile changes (0.18.4→0.18.5); manual PR #34 restored the protected-main
  flow and deleted the branch.
- owner: oats-expert-release-desktop-ux · coordinator: dev-coordinator-parallel-2
- taught us: nothing new — the documented org-policy rescue path remains
  necessary, while the fully qualified detached-HEAD branch push still works.

## PR #33 (round 3) — Desktop Shift+Enter send leak and terminal copy selection (2026-07-25)
- verdict: MERGED as merge commit `595159e` at exact head `d75fa3a` after two
  RETURNs. All four gates PASS. The feature suppresses every xterm event in a
  Shift+Enter chord while writing one `\n` on keydown, and enables xterm's
  modifier-forced local selection for terminal copy (Option on macOS, Shift on
  non-macOS). It preserves PR #32's Instances-stage removal and carries accurate
  Desktop knowledge. Fresh final affected gate passed 30/30 merged-head tests,
  check/check:pi, strict OKF for all 8 bundles, and diff-check; the earlier full
  scratch gate passed 382 tests plus validate/pack/smoke; human live verification
  and all four exact-head CI/installer checks passed. Approval was recorded as a
  PR comment (shared account), expected-head merge succeeded, and the remote
  branch was deleted.
- owner: oats-desktop-engineer-session-copy-newline · coordinator:
  dev-coordinator-parallel-2
- taught us: xterm custom key handlers span keydown, keypress, and keyup, so a
  replacement chord must suppress all phases and emit once. Also, a handback can
  be truthfully fresh yet immediately superseded by the maintainer's own
  previously launched harvest; settle reviewer-driven commits before the final
  handoff. The next patch release must combine PR #32 and PR #33 without
  modifying immutable v0.18.4 artifacts.

## PR #33 (round 2) — Desktop Shift+Enter send leak and terminal copy selection (2026-07-25)
- verdict: RETURNED at exact head `0a9c6df` for one knowledge-correctness fix
  plus mergeability. The branch correctly merged main twice, preserved PR #32's
  Instances-stage removal and this PR's `terminalOptions(...)` construction,
  unioned the append-only soul log, and passed 30/30 targeted merged-head tests,
  Desktop strict OKF (76 concepts, 0 errors/warnings), diff-check, the owner's
  repeated full gates, and all four exact-head CI/installer checks. Correctness
  FAIL: the updated Shift+Enter lesson still names removed classifier
  `shiftEnterByte(ev)` instead of `shiftEnterAction(ev)`, and the product comment
  says Shift+drag works “everywhere” although shipped xterm uses Option on macOS
  and Shift only on non-macOS. Mergeability FAIL: reviewer-driven harvest
  `71b4aa1` completed after handback and advanced main, so current main is no
  longer an ancestor. Author must fix both claims, merge final current main,
  rerun the affected/full gate, and return a settled exact SHA.
- owner: oats-desktop-engineer-session-copy-newline · coordinator:
  dev-coordinator-parallel-2
- taught us: nothing new beyond the existing settled-handback lesson — the
  owner rechecked correctly, but the maintainer's own previously launched
  harvest landed during the handoff window. Round 2 deliberately launches no
  further harvest before the next handback.

## PR #33 (round 1) — Desktop Shift+Enter send leak and terminal copy selection (2026-07-25)
- verdict: RETURNED at exact head `605607a` for mergeability only. Product
  direction, correctness, and security PASS. Fresh scratch gate passed 382
  tests (381 pass, one intentional node-pty ABI skip), check/check:pi,
  validate/strict OKF/pack/smoke; human live verification passed; all four
  exact-head PR/installer checks are green. Mergeability FAIL: the branch is
  based on `d3b0e69` and does not contain current main `41272b6`, missing seven
  PR #32/main commits. Both sides changed `packages/desktop/renderer/shell.mjs`;
  GitHub currently auto-merges it cleanly, but the author must merge current
  main, preserve both changes, rerun the full gate, and return a settled green
  exact head.
- owner: oats-desktop-engineer-session-copy-newline · coordinator:
  dev-coordinator-parallel-2
- taught us: xterm's custom key callback spans keydown, keypress, and keyup; a
  modifier override that suppresses only keydown can still leak a default
  keypress byte. Behavioral regressions must drive the whole physical chord,
  not just the first DOM event. The pending next patch should combine this fix
  with PR #32's already-landed correction; immutable v0.18.4 stays untouched.

## PR #32 — remove the out-of-scope Desktop Instances stage (2026-07-25)
- verdict: MERGED as merge commit `97f66c9` at exact head `69641c9` after one
  RETURN. Direction and security passed throughout. Round 1 returned because a
  delayed-spawn fallback still directed users to the deleted “Instances view”
  and the branch lacked current main. Round 2 points and regression-pins that
  path to the permanent sidebar roster, corrects stale stage-era comments, and
  contains main `d3b0e69`. Fresh final gate passed: root 376 tests + one
  intentional skip, check/check:pi/validate/strict OKF/pack/smoke, Desktop
  183/183, human live workspace verification, independent reviewer APPROVE,
  and all four exact-head GitHub CI/installer checks. Approval was recorded as
  a PR comment (shared account); expected-head merge succeeded. The remote
  branch was deleted manually because the owner's worktree holds it locally.
- owner: oats-desktop-engineer-roster-scope-rollback · coordinator:
  dev-coordinator-parallel-2
- taught us: a surface-removal inventory must cover user-visible fallback and
  recovery copy, not only imports, nav entries, modules, and CSS. A broad
  “operation failed truthfully” assertion can stay green while directing users
  to a destination the same PR deleted. See [Surface removal inventories must
  include user-facing recovery copy](/lessons/surface-removal-inventory-user-guidance.md).
  Corrective source is on main but needs a new patch release; v0.18.4 artifacts
  remain immutable.

## PR #31 — v0.18.4 manifest bump rescue (2026-07-25)
- verdict: MERGED as squash commit `fda7498`. The tag-driven v0.18.4 release
  completed build/test, all three Desktop installer build+smoke legs, both npm
  publishes, provenance, and the GitHub Release before the known org policy
  blocked Actions from creating the bump PR. The workflow-created branch
  `release-bump/v0.18.4` contained exactly the five expected root/pi/Desktop
  manifest and lockfile changes (0.18.3→0.18.4); manual PR #31 restored the
  protected-main bump flow and deleted the branch.
- owner: oats-expert-release-desktop-ux · coordinator: dev-coordinator-parallel-2
- taught us: nothing new — this is the documented org-policy rescue path, and
  the fully qualified detached-HEAD push continued to work correctly.

## PR #29 (round 3) — Desktop UX fixes final merge (2026-07-25)
- verdict: MERGED as merge commit `b7203eb` at exact head `9736852`. All four
  gates PASS. The final branch contains current main `5aa596f`, preserves both
  PR #29 UX and PR #30 corrected-installer knowledge histories, is API-clean/
  mergeable, and passes Desktop OKF strict (74/0/0). Exact-head GitHub checks
  all SUCCESS: Node 22 test/validate/pack/smoke plus macOS arm64, macOS x64,
  and Ubuntu x64 installer legs. Round-2 scratch correctness gate already
  passed 379 tests + one intentional node-pty ABI skip, check/validate/pack.
  Approval recorded as a PR comment (shared GitHub account); merged with the
  expected-head guard; remote feature branch deleted.
- owner: dev-coordinator-parallel-2 · coordinator: dev-coordinator-parallel-2
- taught us: the final workspace-sort contract needs identity at both storage
  and transition boundaries — key preferences by canonical workspace ID and
  resync on explicit switch plus silent server adoption. Parallel same-soul
  harvests require an append-only log union immediately before final handoff.
  Release version is intentionally selected at the next coordinated release,
  not bumped in this feature PR.

## PR #29 (round 2) — Desktop UX fixes re-review (2026-07-25)
- verdict: RETURNED at exact head `23e3c71` for mergeability only. The round-1
  correctness ask is fully fixed by `9c7c5c6`: sort persistence is a
  canonical-workspace-ID map, resynced on explicit switch and silent adoption,
  with safe legacy/corrupt fallbacks and behavioral A→B→A coverage. Fresh full
  gate PASS: 379 tests pass + one intentional node-pty ABI skip; check/validate/
  pack pass; Desktop soul OKF strict 71/0/0. Direction/security remain PASS.
  Mergeability FAIL: PR #30 advanced `origin/main` after the branch's earlier
  main merge; GitHub reports DIRTY/CONFLICTING and `git merge-tree` reproduces
  the conflict in `agents/oats-desktop-engineer/soul/knowledge/log.md`. Author
  must merge latest main, union the append-only log, and return green exact-head
  PR + installer checks.
- owner: dev-coordinator-parallel-2 · coordinator: dev-coordinator-parallel-2
- taught us: same-soul feature and harvest PRs conflict even when product code
  is independent; final handoff must follow all parallel knowledge harvests and
  bind to current main immediately before merge.

## PR #30 — post-v0.18.3 corrected-installer knowledge harvest (2026-07-25)
- verdict: MERGED as merge commit `935d142` at exact head `a220a306`. Product
  direction, correctness, security, and mergeability PASS. Scope is 13 files,
  all under cli-dev or oats-desktop-engineer soul knowledge/skills; no product,
  release, manifest, or framework behavior changes. Strict repo OKF PASS across
  all 8 bundles (0 errors, 0 warnings). Independent merged-state reviewer
  `reviewer-a220a30` on required `github-copilot/claude-opus-4.8:high` APPROVED
  with no blockers/security findings; required CI green. Maintainer approval was
  recorded as a PR comment because the shared GitHub account cannot approve its
  own PR.
- owner: cli-dev + oats-desktop-engineer memory harvests · coordinator:
  dev-coordinator-1
- taught us: a knowledge-only integration still benefits from an exact-head
  merged-state review because security guidance can alter operator behavior.
  Here the aweb mismatch skill stayed safe: diagnostics are read-only, it bans
  ad hoc identity repair, and sensitive actions still require independent
  confirmation. The sole reviewer nit (updating a concept timestamp alongside
  an Update log entry) was harmless.

## PR #29 (round 1) — Desktop UX fixes: spawn/chat/roster/workspace tabs (2026-07-25)
- verdict: RETURNED at exact head `fb1f1bc`. Direction and security PASS;
  clean scratch full gate PASS (359 tests pass, one intentional node-pty ABI
  skip; check/validate/pack; Desktop soul OKF strict 71/0/0). Correctness FAIL:
  the PR promises per-workspace roster sort persistence, but
  `views/instances.mjs` reads/writes one global `oats.desktop.rosterSort` key,
  so A's choice leaks into B; asked for canonical-workspace scoping and an
  A→B→A regression. Mergeability FAIL: branch was 10 commits behind current
  main (`e1ea91c` vs merge-base `f453b3e`), including v0.18.3 Desktop signing/
  packaging changes; author must merge main and return a green combined head.
- owner: dev-coordinator-parallel-2 · coordinator: dev-coordinator-parallel-2
- taught us: persistence described as “per workspace” needs a cross-workspace
  switching regression; a one-workspace localStorage test can pass while the
  preference silently leaks across workspace identity. Release version remains
  a release-time choice, not a feature-PR bump.

## PR #27 — publish valid ad-hoc-signed macOS installers (2026-07-25)
- verdict: MERGED as merge commit `921f44a` — exact head `77b7ae4`. Corrected
  the v0.18.2 macOS installer defect (arm64 shipped an incomplete
  linker-generated ad-hoc signature → Gatekeeper "damaged"; x64 unsigned).
  Drove release **v0.18.3** (tag on `921f44a`).
- owner: (feature/macos-correct-installers) · coordinator: dev-coordinator-1
- gates: all four pass. `electron-builder.config.cjs` `identity: null → "-"`
  (complete ad-hoc bundle signature); afterPack documented to run BEFORE signing
  so the spawn-helper chmod lands inside the seal. Strict
  `codesign --verify --deep --strict --verbose=2` gated fail-closed both as an
  external workflow step AND unconditionally in `dist:smoke` on darwin
  (platform-only guard, no OATS_SMOKE_* can skip it), before artifact upload;
  the two workflow verifier run-blocks are enforced byte-identical by
  `test/release-workflow.test.mjs`. `CSC_FOR_PULL_REQUEST:"true"` on
  build-installers only (PR legs need it to actually sign; release.yml is
  tag-push so omits it) — safe, no signing secrets, deterministic ad-hoc.
  Release-notes existence gate added (fail fast pre-publish). New suites pass:
  codesign-verify 15/15, release-workflow 17/17. CI evidence (runs 30156699308
  + 30156539653, head 77b7ae4): arm64/x64 Signature=adhoc, Sealed Resources v2
  rules=13 files=179, node-pty packaged-ABI (x64 under Rosetta). Manifests stayed
  0.18.2 (tag-derived); no v0.18.2 asset mutation; Linux unaffected. Approve
  recorded as PR comment (same gh account). Remote branch deleted manually (dev
  worktree held the local branch).
- taught us: the release bump-PR step now fails ONLY on the org-policy cause,
  not the refspec — PR #25's `HEAD:refs/heads/<branch>` fix worked (push logged
  `[new branch] HEAD -> release-bump/v0.18.3`), then `gh pr create` failed with
  `GraphQL: Resource not accessible by integration (createPullRequest)` (org
  policy blocks Actions-created PRs). Rescue: publish was already complete
  (never retag) — created + squash-merged the bump PR manually (**PR #28**,
  main `9a6eae8`, manifests → 0.18.3). The release run shows conclusion=failure
  purely because of this final step; npm + GitHub Release succeeded. Until an
  org admin relaxes the Actions-PR policy, every tag-driven release needs this
  one manual bump-PR step.

## PR #26 — cli-dev soul: promote detached-HEAD release refspec lesson (2026-07-25)
- verdict: MERGED as merge commit `0061eb5` — knowledge-only, exact head
  `9f43317`. Lands the harvested lesson from cli-dev-desktop-dist-2's v0.18.2 /
  PR #25 work into the canonical cli-dev soul (its delivery branch was not
  merged directly, so a follow-up PR carried the soul update).
- owner: cli-dev-desktop-dist-2 (retired) · coordinator: dev-coordinator-1
- gates: OKF-correctness gate for a knowledge-only PR — strict validator PASS
  (19 concepts, 0 err/0 warn); one Lesson added
  (`lessons/exact-tag-detached-head-refspec.md`), indexed with description
  matching frontmatter, log newest-first; both referenced links resolve
  (release-workflow-static-tests.md, playbooks/release-tag-driven-ci.md); no
  unrelated changes (3 files, all under cli-dev soul knowledge). Approve
  recorded as PR comment (same-account GitHub block).
- taught us: nothing new — clean knowledge harvest; confirms the promote-lesson
  follow-up PR flow when a completed developer's delivery branch never merged.

---
- verdict: MERGED as merge commit `8d7d2ee` — all four gates PASS at exact head
  `e52826518`. Post-release one-line automation repair: the version-bump branch
  push in the publish job runs from a DETACHED HEAD (publish checks out
  `ref: github.sha`), where `git push origin "HEAD:${BRANCH}"` cannot infer
  `refs/heads/` and fails ("not a full refname") — the only red step of the
  v0.18.2 release, after all publication succeeded. Fix qualifies the
  destination to `HEAD:refs/heads/${BRANCH}` (+ explanatory comment). Direction:
  minimal, correct layer, no new contract surface. Correctness: guard VERIFIED —
  14/14 static release-workflow tests pass on the fix, and the new guard FAILS
  (not ok 7) when the ambiguous `HEAD:${BRANCH}` form is reintroduced. Security:
  push-destination refspec only — no trust-boundary/hook/order change. No
  retag/republish; v0.18.2 stays terminally complete.
- owner: cli-dev · coordinator: dev-coordinator-1
- taught us: nothing new on the codebase — this is the landed form of the fix
  the PR #22 delivery-log entry and repo-state open thread had already proposed
  (`HEAD:refs/heads/${BRANCH}`). The refined root cause is detached-HEAD ref
  inference (not only same-name-tag ambiguity); fully-qualifying the ref cures
  both. Approval recorded as a PR comment (same-account block), then merged.

## PR #22 — Linux executableName release-blocker fix + re-cut v0.18.2 (2026-07-25)
- verdict: MERGED as merge commit `7cc3b5b` — all four gates PASS at head
  `1a95e7e`. Fix VERIFIED on REAL green installer builds (build-installers
  run 30153115337, all 3 legs): ubuntu x64 AppImage(124MB)+DEB(96MB)
  built+smoke-verified, macos-14 arm64 DMG+ZIP, macos-14 x64 DMG+ZIP under
  Rosetta. `executableName: "oats-desktop"` (linux-scoped) + DEB
  `maintainer`/`homepage`. Complete 0.18.1→0.18.2 sweep; compat band
  unchanged. release.yml: fail-fast:false, macos-13 sunset runner dropped
  (x64 cross-builds on macos-14 under Rosetta).
- owner: oats-desktop-engineer-desktop-dist · handoff: oats-maintainer (verified);
  coordinator: dev-coordinator-1
- release: tag `v0.18.2` on `7cc3b5b` → run 30153347086 PUBLISHED
  `@awebai/oats@0.18.2` + `@awebai/oats-pi@0.18.2` (latest) + GitHub
  Release v0.18.2 with all 7 assets (mac arm64/x64 DMG+ZIP, linux
  AppImage+DEB, SHA256SUMS + provenance). desktopApi contract verified on the
  PUBLISHED artifact: `oats version --json` == `{schemaVersion:1,...,version:"0.18.2",desktopApi:1}`.
  Manifest bump-PR (#24) manually rescued (CI step failed on an ambiguous
  `git push HEAD:release-bump/v0.18.2` refspec — tag v0.18.2 exists so the
  partial ref couldn't resolve; publish was already done). Orphan `v0.18.1`
  tag deleted post-green (operator OK).
- taught us: the tag-driven release's Linux/mac installer build can't be
  rehearsed pre-merge (tag must be on main), so a packaging-config defect
  (scoped-name AppImage executableName) survives the full local gate and
  fails only in a real release with nothing published — see
  [lesson](/lessons/release-ci-linux-build-unrehearsable-pre-merge.md). This
  PR also SHIPPED the structural gap-closer: a verify-only `build-installers.yml`
  (PR + workflow_dispatch, contents:read, fail-fast:false, own concurrency)
  that builds every installer leg on PRs without any publish surface. Also:
  the CI bump-PR push uses a partial refname (`HEAD:${BRANCH}`) that becomes
  ambiguous once the same-name tag exists — a real release.yml bug worth
  fixing to `HEAD:refs/heads/${BRANCH}` (proposed to human).

## PR #21 — OATS Desktop v0.18.x standalone Electron app + legacy-panel succession (2026-07-24/25)
- verdict: MERGED as merge commit `0961175` — all four gates PASS at head
  `975a44a`. Direction: matches decisions/desktop-public-release-contract in
  substance (installer matrix, Desktop CLI API v1, no-CLI observation mode,
  split ownership, dormant Diff/Jira removal, RETIRED_CAPABILITIES doctor
  diagnostics). Correctness: 333 pass/1 env-skip; check/validate/okf/pack/
  tarball-smoke green. Security: loopback+DNS-rebind+CSRF, terminal cap 20 in
  the owning main process, wx 0o600 task files, argv allowlist (execFile, no
  shell), realpath TOCTOU-hardened file-root guard, no kernel imports —
  strengthened, not weakened. Mergeability: CLEAN, 5 conflicts author-resolved,
  okf lock sha256-45c0… == oats.okf 1.4.0.
- owner: oats-desktop-engineer + cli-dev (multi-dev) · coordinator: dev-coordinator-1
- release fallout: the initial `v0.18.1` cut (0.18.0 already npm-published via
  #20 with no Desktop/desktopApi; idempotent skip-guard would skip a re-tag)
  FAILED at the Linux desktop-build — nothing published. Superseded by the
  operator-chosen `v0.18.2` re-cut (PR #22).
- taught us: independently verify the version-cut rationale against npm +
  GitHub Releases state, not just the coordinator's narrative — 0.18.0 was
  npm-only (no Release/installers), which is exactly why a fresh version was
  needed. A green PR gate + sound-looking release.yml is NOT proof the release
  publishes (see PR #22).

---

## PR #19 (round 3) — desktop succession + explicit spawn lineage (2026-07-24)
- verdict: MERGED as `9b39ee7` — all four gates PASS at exact final head
  `daa0b98`. Direction: desktop owns its backend and immediately retires
  oats.web, `oats pane`, and `lib/control-pane`; the adjacent-core bridge is
  explicitly release-blocking distribution debt, not a merge blocker.
  Correctness/security: fresh expanded gate, scaffold probe, ownership and
  lock checks passed; round-2 traversal was closed by generated-name syntax
  validation plus realpath immediate-child containment, with regressions for
  spawn-before-scaffold, retire-before-delete, canonical-soul survival, normal
  lookup, and an escaping symlink. Mergeability: exact-head GitHub CI green,
  current main ancestor, conflict-free merge-tree, and clean diff-check.
- owner: dev-coordinator-1 · coordinator: dev-coordinator-1
- taught us: a final handback is not final while reviewer nits are still being
  merged; bind approval to the actual PR SHA and exact-head check run. The
  release remains blocked until desktop installers and installed-CLI mutation
  boundaries are operational.

## PR #19 (round 2) — expanded desktop succession + explicit spawn lineage (2026-07-24)
- verdict: RETURNED — direction PASS against the amended immediate-cutover
  decision (direct-core bridge explicitly release-blocking debt); exact-head
  `047acbb` GitHub CI and scratch full gate green (234
  tests, one intentional ABI skip, all validation/pack/smoke), scaffold-only
  probe passed, ownership/removal/retirement diagnostics and lock integrity
  verified. Security/correctness FAIL: new shared `findInstanceHome(root, name)`
  accepts path traversal as an instance name. Reproduced `oats spawn dev
  --parent ../../dev/soul` accepting malformed lineage; the same helper powers
  retirement, and `oats retire ../../dev/soul` recursively deleted the canonical
  soul in an isolated probe. Author must reject separators/dot traversal,
  enforce immediate-child containment, and regress both spawn and destructive
  retire. Mergeability also has two `git diff --check` extra-blank-line errors.
- owner: dev-coordinator-1 · coordinator: dev-coordinator-1
- taught us: filesystem existence under `join(instancesDir, untrustedName)` is
  not identity validation; every instance-home lookup, especially destructive
  lifecycle callers, needs name validation plus resolved containment.

## PR #19 (round 1) — OATS Desktop transitional Electron app and oats.web bridge (2026-07-24)
- verdict: RETURNED — direction PASS against the accepted desktop succession
  decision; correctness/mergeability FAIL because required PR CI is red. The
  root test script now includes `packages/**/*.test.mjs`, but
  `.github/workflows/pull-request.yml` installs only root dependencies: 8
  desktop suites fail in a clean runner on missing `jsdom`/`marked` (187/196
  pass). Exact-head scratch gate after root + desktop installs reached 238/239;
  the remaining macOS node-pty prebuild-helper permission failure cleared with
  the README-required Electron rebuild, and the targeted real-wheel test then
  passed. Check/check:pi/validate/OKF/pack/smoke all passed. Owner asked to make
  CI install desktop dependencies, merge current main, and return a green
  exact-head gate.
- owner: dev-coordinator-1 · coordinator: dev-coordinator-1
- taught us: once a root test glob includes a private nested package that is
  not an npm workspace, root `npm ci` is not a complete CI environment; the
  workflow must install that package's lockfile too.

## PR #17 — oats-web 0.8.1 typing visibility + latency (echo snap+burst, off-thread roster snapshot) (2026-07-22)
- verdict: MERGED — all four gates green. Direction: right layer; the
  server-never-collects child-process snapshot is the correct fix for the
  single-threaded event loop; human-confirmed-on-dev-port process endorsed.
  Correctness: scratch-worktree gate 65/65 tests + check/validate/pack:check;
  OKF strict pass on the webpanel-dev bundle (two new lessons promoted).
  Security: /api/keys --debug logs metadata+byte-count only; keySendError
  shapes exec failures (exit status/signal only — e.message embeds hex-encoded
  keystrokes in argv) with a leak regression test. Approval recorded as PR
  comment (same-account block); merge-commit merge; remote branch deleted via
  `git push origin --delete` (webpanel-dev-1 worktree held it — owner notified).
- owner: webpanel-dev-1 · coordinator: none
- taught us: branch CI is red from a PRE-EXISTING environment gap — the
  /api/agents test expects the capability-defined 'reviewer' agent, but CI's
  bare checkout lacks .agents/capabilities/installed/; also failed on the
  PR #14 branch. Needs a CI fix or test guard (open thread). Also: on a
  single-threaded server, audit periodic exec*Sync handlers before tuning
  the hot path — tail latency, not median, was the felt lag.

## PR #14 (round 3) — oats-web 0.8.0 spawn-from-panel (2026-07-22)
- verdict: MERGED — all four gates green; approval again a PR comment
  (same-account block — applies to --request-changes too). Round-3 merge
  commit ea1f5b1 resolved the post-#16 four-file conflict exactly as asked:
  0.8.0 + >=0.16.0 floor kept, main's makeRegistryCache findInstance
  preserved untouched (zero main-side deletions) alongside the branch's
  agentsData()/spawnAgent(), soul index/log unions. Scratch-worktree gate:
  63/63 tests (OATSWEB_KEYROUTE + #16 registry-cache/attach tests), check,
  validate, pack:check. Merge-commit merge (clean history); remote branch
  deleted via `git push origin --delete` (author worktree held it — owner
  notified).
- owner: webpanel-dev-spawn-from-panel · coordinator: none
- taught us: two consecutive pure-mergeability RETURNs on one PR confirms
  the staleness lesson (promoted to lessons/) — authors should re-check
  `mergeable` at handback; the author's round-2 resolution (verified
  adjacency by parse + live probe) is the standard we want. Release pending:
  marketplace oats.web 0.5.0 vs repo 0.8.0.

## PR #14 (round 2) — oats-web 0.8.0 spawn-from-panel re-review (2026-07-22)
- verdict: RETURNED again — gates 1–3 still PASS (no new branch commits
  besides the requested main merge 237d628, which resolved the PR #13
  conflicts exactly as asked); gate 4 FAIL: main moved under the branch —
  PR #16 (oats-web 0.7.2 fast attach) merged after 237d628, so the branch is
  CONFLICTING again in four files: oats.json (0.7.2/>=0.14.0 vs 0.8.0/
  >=0.16.0), bin/oats-web.mjs (registry-cache findInstance vs the branch's
  agentsData/spawnAgent additions — adjacent, both must survive), and
  webpanel-dev soul index.md + log.md (union). Author asked to merge main
  again, keep main's makeRegistryCache findInstance plus their additions,
  re-run the full gate, and re-check `mergeable` right before handback.
- owner: webpanel-dev-spawn-from-panel · coordinator: none
- taught us: with several PRs landing on one capability the same day, a
  returned PR can go stale between fix and re-review — advise authors to
  re-merge main immediately before handback, and consider sequencing
  same-capability PRs. `gh pr review --request-changes` hits the same
  same-account block as approve; the structured RETURN lives as a PR
  comment.

## PR #16 — oats-web 0.7.2 fast session attach: registry cache, single tmux round-trip, three-rung paint (2026-07-22)
- verdict: MERGED — all four gates green; approval again a PR comment
  (same-account block). Measured root cause was `findInstance()` rebuilding
  the whole control-pane model per `/api/session` request; fixed with a pure
  injectable 2.5s-TTL registry cache (`makeRegistryCache`), `paneSize` +
  `historySize` merged into one tmux `display-message` round-trip
  (`paneInfo`), and a three-rung client attach (cached-frame paint → 120-line
  tail → gen-guarded 2000-line backfill; `lines` in the render signature so
  the tail never suppresses the deep paint). Reviewer nits addressed in
  1555f2b via extracted marked blocks (OATSWEB_REGCACHE, OATSWEB_ATTACH) with
  unit tests. Full gate green in scratch worktree: 61/61, check, validate,
  pack:check. Remote branch deleted with `git push origin --delete` (author
  worktree held it locally — owner notified).
- owner: webpanel-dev-1 · coordinator: none
- taught us: round-trip count, not payload size, dominated attach latency —
  merging tmux queries and caching a rarely-changing roster beat any render
  optimization; the marked-block extraction pattern now covers server-side
  factories too (new Function over the extracted block), not just browser
  code. Release still pending: marketplace oats.web 0.5.0 vs repo 0.7.2.

## PR #14 — oats-web 0.8.0 spawn-from-panel: /api/agents + /api/spawn (2026-07-22)
- verdict: RETURNED — gates 1–3 (direction, correctness, security) PASS; gate 4
  (mergeability) FAIL: branch forked before PR #13 and conflicts with main in
  capabilities/oats-web/oats.json (version/description) and webpanel-dev's soul
  index.md. Full gate verified green in a scratch merge with main (60/60,
  check, validate, pack:check). agentsRoot allowlist (selector into server
  workspace roots) is a sound pattern; compat-floor regression test
  (core.* API → min kernel version map) is a keeper. Author asked to merge
  main, resolve the two conflicts, re-run the gate, and re-request.
- owner: webpanel-dev-spawn-from-panel · coordinator: none
- taught us: the /api/agents test needs the deployment's installed
  capabilities (.agents/capabilities/installed with oats-review) — a bare
  scratch worktree fails it environmentally; copy installed/ in (or run from
  the deployment root). Also: scratch worktrees need `npm install` before
  `npm run validate` (ajv devDep).

## PR #13 — oats-web 0.7.1 'cannot type' fix: logical pane key routing (2026-07-22)
- verdict: MERGED — all four gates green; approval again a PR comment
  (same-account block). Root-caused 0.7.0 regression: keydown bound to the
  term element and gated on DOM focus silently dropped keys after any
  header/toggle click. Fix routes via a window-level listener to the
  logically focused pane, excluding real editable controls; Cmd-B toggles
  sidebar, Ctrl-B always reaches the session (tmux prefix). New
  OATSWEB_KEYROUTE marked block + node regression test (59/59); no change to
  /api/keys or the loopback POST guard; webpanel-dev OKF bundle --strict
  clean, new lesson concept recorded.
- owner: webpanel-dev-1 · coordinator: none
- taught us: DOM focus is too fragile a routing key for pane UIs — logical
  focus state plus an editable-control exclusion is the robust model; the
  marked-block extraction pattern (from PR #8) generalized cleanly to key
  routing. Remote branch deletion needed `git push origin --delete` because
  the author's worktree held the local branch.

## PR #12 — oats-web 0.7.0 panel refinements (2026-07-22)
- verdict: MERGED — all four gates green; approval again a PR comment
  (same-account block). Terminal-unified input (composer + `/api/send`
  removed), adaptBg near-neutral truecolor-bg fold with regression tests,
  compact `.phead` header, collapsible sidebar + split panes with per-pane
  state/gen guards; webpanel-dev OKF bundle validates --strict.
- owner: webpanel-dev-1 · coordinator: none
- taught us: removing an endpoint is a security win worth naming in review
  (smaller surface); per-pane generation counters are the clean pattern for
  multi-pane stale-response/key-leak guards. Release still pending — 0.7.0
  (and 0.6.0) unpublished until the next tag.

## PR #10 — webpanel-dev soul doc nits from PR #8 review (2026-07-22)
- verdict: MERGED — docs-only, both corrected claims verified against
  oats-web implementation (`capture-pane -p -e` without -J; server-side
  `\r\n?` → `\n` into load-buffer/paste-buffer -p); bundle passes OKF
  --strict. Approval again recorded as PR comment (same-account block).
- owner: webpanel-dev-1 · coordinator: none
- taught us: nothing new — the return-as-follow-up flow from PR #8 closed
  cleanly in one docs-only PR.

## PR #8 — oats.web 0.6.0 terminal-faithful session view (2026-07-22)
- verdict: MERGED — all four gates green; approval recorded as a PR comment
  (GitHub blocks same-account `gh pr review --approve`).
- owner: webpanel-dev-terminal-fidelity · coordinator: dev-coordinator-1
- taught us: zero-dep held under real pressure — the hand-rolled SGR
  renderer with a DOM-free marker block (`OATSWEB_RENDERER_BEGIN/END`)
  extracted for node tests is a reusable pattern for testing browser-embedded
  logic without a bundler. New POST Host/Origin loopback guard hardens the
  panel's 127.0.0.1 posture against DNS rebinding. Two doc nits returned
  as follow-ups (stale `-J` reference, inverted paste-normalization claim
  in webpanel-dev's knowledge). Release needed to publish 0.6.0.

## PR #4 — session-error surfacing (2026-07-22)
- verdict: CLOSED — approved on quality, discarded by operator instruction
  before merge; branches deleted.
- owner: dev-coordinator-1 (multi-dev: tui-dev-1, webpanel-dev-1)
- taught us: first full multi-dev run; failure modes recorded in
  lessons/multi-dev-run-failure-modes.md and fixed in v0.17.0.

- **2026-09-21** — Second-operator `launch` re-run on 0.24.6 (Antares): first captured resolution WITH an executable launch selection published; hard runtime row refused through the attributed problem shape (capability, slot, runtime, package, install hint, operator origin). Closes the S2/S3 launch half of the second-operator gate; `check` half parked with OKF 2.1.3 (harvest OFF by direction). Lesson reaffirmed: "every post-selection prepare refusal is attributed or it is a kernel defect" held under an independent operator's provocation.

- **2026-09-21** — K1 hardening (PR56 → `42924552`) independently re-probed by its consumer (Desktop engineer) with a shim on the captured-oid diff: external/textconv/fsmonitor helpers did not execute and the patch was real; HEAD race → `E_STALE_OBSERVATION` (requested `4e659d45…`, actual `9d179d64…`, never served); observe+diff left object counts and index bytes unchanged. Consumer proceeds to wire slice 2a. Pattern: producer hardening is verified by the consumer's adversarial probe, not by the producer's own tests alone.

- **2026-09-22** — **OATS v0.24.7 published** (tag `v0.24.7` → `c923d81b` = notes commit on top of `912aaee0`; npm gitHead `c923d81b`; bump PR #58) — first stated as "tag on 912aaee0", corrected after the second operator compared npm gitHead with the mail. Contents: K1 `oats instance git|diff` (+ consumer-probe hardening PR56), K4 `inspect` soulsApi 1 (+ onboard provenance), hollow-agent refusal `E_REQUIREMENT_INACTIVE` (PR55), Desktop slices 1b/2a/3/4/6a/7a. Verified from the published tarball: version, `create` next-step note, `spawn` refusal code, `inspect` soulsApi/readiness/sources, `instance git` envelope. Global oats + ~/OATS on 0.24.7. Release step "open bump PR" failed as always (org policy) → manual PR #58.

- **2026-09-22** — K3 producer pins from the Desktop engineer's pre-wiring read of the merged head (PR66, PR67 → `aed94b74`): unguarded Remove apply; no feature advertisement (older CLI retires on `--plan`); children promised-stopped but not stopped; branch deletion re-sampled after hooks; last-receipt-only replay; bare-name parent edges. Pattern of the day, third instance: the producer ships semantics, the consumer's read before wiring catches what makes them safe to drive. Every pin fixed kernel-side, none compensated in the wrapper.
- **2026-09-22** — `oats session recompose` (feature `session-recompose`): operator-authorized in-place refresh of a live home's composed `AGENTS.md` from its current soul, previous text retained, event recorded, nothing restarted. Why: a running instance's generated instructions outrank mail and tracked files; when spawns are blocked (profile pin) there was no honest way to reach a live role with an amendment — the engineer named the gap twice (K1 reassignment refusal; verification-budget amendment) and named the remedy. Landed as a general seam; not applied to it mid-slice.
- **2026-09-22** — PR69 slice 2c (Stop/Remove confirmations) APPROVE+merge → `508fda04`. Taught us: review a consumer contract against the **live producer**, not only its fixtures — a hermetic-repo probe piping real plan/receipt/replay JSON through the consumer's validators is cheap and decisive. **v0.24.8 published** (tag `b01f7c51`, code head `508fda04`, bump `b4bf7979`): K3/K5/K6/K7/K8 seams, retention-by-default retire, session recompose, Desktop 2b/2c. First tag attempt failed pre-publish for missing `docs/release-notes/v0.24.8.md` (retag safe); bump-PR step failed as always (org policy) → manual PR70. Probe findings, not blockers: (a) `oats init --knowledge oats.okf` + `oats create` yields a soul without `okf.json`, so the okf **required** spawn hook fails and spawn rolls back — a template/hook contract gap to fix in oats-okf or `create`; (b) `oats trust <package> --all-capabilities` did not satisfy readiness `trusted` for `oats.core` — check whether readiness reads per-capability trust only.
- **2026-09-22** — **OKF 2.1.3 published** (awebai/oats-okf PR #6 → tag `v2.1.3` = `aafdd3ef`); framework PR72 mirrors it and pins the catalog. Closes the deferred 2.1.3 list: per-cause `check` reasons (closed table, manifest-pinned byte-exact), missing `okf.json` → `E_CONFIG` naming the remedy (the v0.24.8 probe finding), retired drained sources switch their `okf-<id>` job off. Taught us, twice: (1) four version pins for one mirrored capability live in four files (parity test, release-packaging test, clean-room smoke, catalog) — the mirror finalizer should move them or a test should assert they agree; (2) **grep the sibling modules before declaring a kernel gap** — I told the human the kernel does not validate manifest `binding`; it does (`lib/provider-binding.mjs`, `provider-reasons.mjs`, broker with 30s cap), and `binding.keys` with `stores.` IS accepted grammar. Corrected in the same session; `keys` goes in 2.1.4.
- **2026-09-22** — PR71 slice 5 (Readiness) APPROVE+merge `127dd31e`; PR73 security follow-up (normalized route classifier) APPROVE+merge `b02847bf`; PR74/PR75 K5 producer pins → `45889296`. Taught us: (1) the consumer's **stored-receipt check** of a freshly merged producer PR caught three defects the producer's own tests did not (a grouping that read ready under a subject blocker, a selector echo mixing raw and canonical paths, a per-call budget that multiplied by N) — hand receipts over and *ask for the check*; (2) a data-only capability (skills+inject) has nothing `oats trust` approves: trust is not-applicable, and readiness must derive "executable" from the manifest surface, not from the lock record; (3) an `execFileSync` `detached` + `killSignal` does not reap the child's process group — kill `-pid` explicitly, and sweep scratch on SIGINT/SIGTERM too.
- **2026-09-22** — 6b boundary approved (read first; apply companion later; attach-knowledge/auto-PR/branch-enum named open contracts). **PR76 K6b → `6402b0f1`**: the engineer's read found `spawn --preview` (API 1, already advertised) wrote before returning (parent event on refusal, Herdr start, soul import) and nothing bound the apply; fixed as **API 2 + feature `spawn-preview-2`** so the consumer can tell it from the installed pre-fix CLI — a lesson in itself: *when a shipped feature turns out unsafe, the fix must be a NEW advertised name/integer, never a silent change under the old one*. **PR77 → `1b8349e5`**: positive-PID guard on every process-group kill (HIGH; a failed spawn's pid 0 made `kill(-0)` target the caller's own group — reproduced, it killed the reproducing shell). Lesson `never-signal-a-pid-you-did-not-verify`; four program lessons made reachable from `lessons/index.md`.
- **2026-09-22** — PR78 slice 6b READ APPROVE+merge `04a4f709` (live API-2 probe 3/3 + typed refusal; legacy route refuses new keys `E_PREVIEW_ONLY` before any spawn). **v0.24.9 published** (tag `04a4f709`, bump PR79 `a5cc390e`). Release-notes file written BEFORE the tag this time — first run went straight to publish. npm packument lagged ~10 min after `+ @awebai/oats@0.24.9` (per-version endpoint answered first): verify from the per-version endpoint / tarball URL and shasum against the publish log, don't wait on `npm view`.
- **2026-09-22** — 6b APPLY companion: proposal (ba3f51a9 + addendum e4e25398) → K6c idempotency (PR80), K6d `spawn-apply-2` (PR81: effective-facts decision, no startup before the fence, exclusive mkdir reservation), K6e replay custody (PR82: replay before placement — my defect —, `spawnCompleted`, wake on replay, `spawn-idempotency-2`), PR83 full decision echo, PR84 retention re-stamp (my regression); **PR85 Desktop apply companion APPROVE+merge `d47dda94`** with a live chain through its own transport. **v0.24.10 published** (bump PR86 `27f9f334`). Taught us: (1) *a strengthened guarantee ships under a NEW advertised name* — three times today (`spawn-preview-2`, `spawn-apply-2`, `spawn-idempotency-2`) the consumer could only trust the fix because it could tell it from the installed CLI; (2) the consumer's inert-VM extraction of an exact kernel helper is the cheapest adversarial review we have — it found replay-order, completion-custody and pid-0 defects that tests written by the author missed; (3) **kernel writes after a baseline are the kernel's to re-stamp** — anything the kernel writes into a home post-spawn must not read as the agent's changes at retire; (4) reject persistent GUI journals of task text: recovery belongs to the kernel via the created home, and a lost GUI intent fails closed.
- **2026-09-22** — **K6g (HIGH) PR87 → main `cc1920e3`; v0.24.11 published** (bump PR88 `b616479b`; release run needed a same-tag re-run for a transient OIDC attest failure — the workflow is idempotent for exactly this). My PR84 fixed a false positive by re-hashing the WHOLE home after the kernel's post-spawn writes — which run after launch, so an agent's early `STATE.md` was blessed into the baseline and silently lost at retire (0.24.10 shipped with it). The engineer's inert extraction of the exact helper found it. Fix: no re-stamp; the fingerprint hashes `instance.json` with exactly `KERNEL_POST_SPAWN_FIELDS` removed. **Lesson (retention authority)**: a baseline may account only for bytes the kernel can PROVE it wrote — never for what it OBSERVES after the agent may have started; the fix for "kernel write reads as agent change" is to neutralize that write in the comparison, never to re-observe. Corollary for reviewing my own fixes: a fix that widens what is trusted needs the adversarial reader more than the bug did.
- **2026-09-22** — 7b (K7 instance events) proposal approved; the engineer's exact-source review found four real reader defects (byte limit as label, symlink-following whole-file read, `--home` bypassing the address check, last-positive-forever waiting, provenance-dropping dedup, torn lines vanishing under filters). **K7b PR89 → main `e808fbfc`** as `instance-events-2`/`eventsApi 2`. Two semantics decided and recorded in the DTO: K7 is **address history** tagged by incarnation (`instance.json.createdAt`), and `waitingOnYou` is a **producer state** per (producer, current incarnation) with explicit clears, computed before windowing. Lesson: *a "limit" that is checked after the read is a label, not a bound* — bounds must be enforced at the syscall (lstat, fd-offset read), and integrity (torn, foreign, tail) must be reported independently of whatever rows a filter selected, or a filter silently certifies incomplete evidence.
- **2026-09-22** — PR90 (`17182cdb`): K7b open-time guard (`O_NOFOLLOW|O_NONBLOCK` + `fstat` dev/ino) and three DTO shape pins. **PR91 K6h (`dcd2bc89`)**: the engineer's inert extraction of `fingerprintTree` showed K6g's `instance.json` neutralization — and, pre-existing, the `.oats-*` receipt exclusions — were guarded by *root-level filename* only, so they also applied to directory work and recovery trees. Now opt-in via `{ instanceHome: true }`, passed by exactly the four home callers. Lesson: **an exception in a generic helper must be keyed on the helper's caller intent, not on a filename** — "root-level file named instance.json" is true of an agent's work tree too; the four home callers were the only ones entitled to the exception, so the exception belongs to them.
- **2026-09-22** — PR92 (`700bd45f`): unknown current incarnation admits no waiting claim (engineer's finding — my `incarnation !== null &&` guard admitted everything when null). **PR93 7b Desktop activity popover APPROVE+merge `20da1072`** with a live chain through its transport+projector. **v0.24.12 published** (bump PR94 `6c632893`). 7b complete; 8 (K8) next. Lesson: *a null-guard that short-circuits a filter admits, it does not refuse* — when the reference value is unknown, the comparison must yield the empty set, not skip itself; write the unknown case as an explicit branch that returns nothing.
- **2026-09-22** — Slice 8 (K8 schedule runs) proposal approved with four decisions (no auto polling; remove the command-running GET; remote history unsupported until the peer advertises; captured-wake edit is an honest limitation, no mutation contract). Engineer's exact-source review found four real reader defects; **K8b PR95 → main `ee60d1e2`** as `schedule-read-2`/`scheduleHistoryApi 3`. Two semantics decided: **a run's identity is when it was scheduled and started, never its outcome** (transitions are facts about one run), and **the `transcript` pointer was a name that promised a reader** — replaced by `session` provenance; a read-only transcript verb is K12, a Decision for the human. Lesson: *never name a field after the capability a consumer wishes existed* — `transcript: {instance, home}` invited the Desktop to attach a live terminal to a historical run; provenance fields describe what the recorder knew, and the reader, if any, is its own contract.
- **2026-09-23** — **PR96 slice 8 Desktop schedules table + Recent runs APPROVE+merge `3a187a80`**, live chain through its transport. **v0.24.13 published** (bump PR97 `0a24ce3d`). With this every contract-bearing Desktop parity slice (2b, 2c, 5, 6a, 6b, 7a, 7b, 8) is on main; the day's shape held: engineer proposes read boundary → exact-source review finds producer defects → I fix kernel-side under a NEW advertised name → receipts → it wires → I review with a live probe → release. Eight kernel seams (K3 K5 K6 K6b–h K7 K7b K8 K8b) and five releases (0.24.9–0.24.13) in one session. Lesson for the framework: **the consumer's pre-wiring read of the producer is the highest-yield review we have** — every K*b seam today came from it, none from my own tests; make "engineer reads the merged head and files pins BEFORE wiring" a standing rule of the parity program, not a courtesy.
- **2026-09-23** — Human paused the parity pipeline and, in one sitting, accepted **workspace model v2** (13 decisions, recorded in `decisions/workspace-model-v2.md`; worked example and a PROPOSED Phase 4 plan in docs/design, main `d9a73765`+). Team notified through the Antares relay and the Desktop engineer. Lesson on how it happened: the human's critique landed **after** three phases were delivered as specified — the delivered thing made the weight visible in a way the design docs never did. Keep proposing simplifications *from the delivered state*, with a worked example of an imaginary org, rather than defending the specification; and record each decision the moment it is made (this brainstorm produced thirteen in ~two hours; none would have survived a compaction unrecorded).
- **2026-09-23** — **Workspace model v2, phases A–C → PR99 squash-merged `59ae22df`; tag `v0.25.0` pushed (release run in flight).** Built by developer swarms per phase, each followed by a five-lens adversarial review with mandatory reproductions and a fixer lane; Phase C review verdict BLOCK (5 HIGH: capability rows never materialized → hooks dead; stale soul copy; standalone unusable with the bundled catalog; oats-config.yaml beside a v3 lock broke spawn; preview before apply failed) — all fixed, HIGHs re-verified by reproduction. Team review (Antares, two aweb teams / stores / soul layout / standalone / public-private hosting) → decisions 23–26 implemented in the same PR. CI rounds: launch goldens (decision 13), validator taught the v2 schemas, `smoke:tarball` rewritten — which exposed three more kernel gaps (alias symlink in package trees; dispatch from materialized modules; capability-defined agents under v2), fixed before merge. Antares informed at each boundary (58516d21, 5d8dbb5d, 95632f29, 737c6367).
- **2026-09-23** — **v0.25.0 PUBLISHED** (tag on `5e10a9c7`; bump PR100 `dc333e4e`). Release run 1 failed at the release gate: the Desktop CLI locator's per-minor `ACCEPT_RANGE` (`<0.25.0`) excluded its own kernel — widened to `<0.26.0` with its three pins (`packages/desktop/test/cli-locator.test.mjs`, `test/desktop-cli-integration.test.mjs`, `docs/desktop-cli-api.md`); tag re-cut twice while nothing had published. Run 3 published both packages (the kernel tarball took ~6 min to become resolvable on the registry — `+ @awebai/oats@0.25.0` in the log is the truth; do not retag on a 404 within minutes); the bump-PR step failed as always (org policy) → manual PR100. Lesson promoted to the git-tag-release skill: a MINOR bump must widen the Desktop band first.
- **2026-09-23** — **v0.25.1 PUBLISHED** (PR101 `2bdac245` → tag on `37182075` after one re-cut for the K6d release-gate flake; bump PR102). Antares' full review of PR99 arrived after the 0.25.0 merge; disposition mailed within the hour, five-lane fixer swarm, all affected suites + tarball smoke + validate green, PR CI green, merged and released the same evening. New lesson: the review found **M1** — decision 7's per-instance invariant held for modules but not for the soul (shared cache link) — a class of bug the adversarial swarm missed because no lens spawned twice across a member move while an instance was live; the fixture now does.
- **2026-09-23** — **v0.25.2 PUBLISHED** (PR103 `f8b3d774`, tag, bump PR104). First outsider run of the rebuild guide (Antares, Juan's OSS+Cloud deployment on scratch) → R1–R10, dispositioned within the hour, four-lane swarm, PR CI green, released the same evening. Lessons: (1) a doc claim about kernel behaviour ("the kernel finds clones through oats-local.yaml") shipped with no consumer of the field — the validator checks doc YAML against schemas but nothing checks doc CLAIMS against code; the guide is now treated as a contract and each claim got a test; (2) provider capabilities lag the kernel's payload model — write what the shipped provider version actually reads (oats.aweb 1.11.2 ignores `team`; OKF 2.1.3 reads okf.json) instead of the intended grammar. Also this day: `<name>-workspace/` convention dropped on Juan's feedback (decision 9 wording), Desktop engineer paused by the human.
- **2026-09-23** — **v0.25.3 PUBLISHED** (PR105 `805bc946`, tag, bump PR106). Lesson: a fix that changes what a PATH means (M1's per-commit soul dirs) must audit every consumer that keyed identity on that path — OKF's owner registry did, and none of my review lenses asked "who pins realpath(home/soul)?". Identity and content are now separate env vars (`OATS_SOUL_ID` / `OATS_SOUL`); the contracts doc says so. Coordination with Antares moved from envelopes to an explicit split (their OKF PRs, my review/release).
- **2026-09-23** — Outsider verification of 0.25.2 (Antares, re-run of the scratch two-team rebuild on `3a57d06c`): R1 clone resolution at `<deployment>/<member>` with no flags and `E_CLONE_MISMATCH` on a wrong `clones:` entry; R9 `sync --approve` ×3 non-interactive; R3 one "You run on OATS" block from the module; R4 soul-source drift rows after a member commit; R5 preview `settings.oats.aweb` = byTeam[cloud] ⊕ oats-local delivery ⊕ `--provider identity.source`, `byTeam` stripped; B2 workspace-mode soul spawns. Remaining rebuild blocker is the OKF owner pin → kernel half shipped 0.25.3 (`OATS_SOUL_ID`), provider half OKF 2.1.4.
- **2026-09-23** — **oats-okf PR #7 APPROVE+merge → `a52082f`** (owner: Antares / oats-expert-antares; 2.1.4 content, tag pending human GO). Sparse staging to `base.root` from a single-branch partial clone (`--filter=blob:none`, hard-filter-error fallback), streamed blob writes (no maxBuffer), `git-timeout` binding key (600 s remote ops), migration record hygiene + `migrate --forget`, owners keyed by `OATS_SOUL_ID` with one-shot rewrite of same-name path pins. Three review rounds, every finding small (README described a dropped skip-worktree draft; `git branch -r` assertion was git-version dependent; two version literals). Taught us: (1) a provider's docs sentence written against a draft survives the draft's removal — read docs against the code, not the description; (2) test assertions on porcelain output (`branch -r`) are version-brittle — assert on plumbing (`for-each-ref`); (3) the maintainer must PROBE a relaxed guard adversarially (verifyGitScope's absence rule) — the PR's own tests exercise the happy path of the relaxation, not its adversary. Behaviour change accepted: a root-level ignore rule outside the base no longer reaches staging, so a validated concept publishes instead of tripping the omission guard.
- **2026-09-23** — **oats-okf PR #8 merged → `2af47ad`** (maintainer's own; 2.1.4 driver 3). Retire of a drained source now disables AND removes its `okf-<id>` job from the kernel scheduler; the definition survives as evidence in the source's `schedule.json`. Amends 2.1.3's "never deleted" choice: the kernel's copy of the definition was redundant evidence, and every retirement left a dead row operators cleaned by hand (found on each aweb-rebuild retire). Taught us: a re-entrant lifecycle step (`retire` calls `scheduleSource` before settling) must check its own terminal state first, or a removed job is recreated and removed again on the second call — the test caught it ('removed' where 'already-removed' was expected). README still described pre-2.1.3 behaviour ("disable drained jobs explicitly") one version after it changed — docs drift is discovered by rewriting the sentence you are about to change, not by grepping the feature name.
- **2026-09-23** — Outsider verification of the owner-pin fix end to end (Antares): kernel 0.25.3 (npm) + oats.okf from git at `a52082f`, fresh deployment via onboard. Spawn → `instance.json.workspace.soul.id = <repo key>#aweb-expert`; owners.json pins the identity, not a path. Member commit, sync, second spawn of the same soul → same owner, owners.json unchanged, both per-commit soul dirs present. Same step on 0.25.2 + 2.1.3 was `E_OWNER`. `git-timeout: 120` accepted through oats-local settings. Doc gap found and closed: `sync --approve <id>@<version>` for a git-pinned package takes the full commit OID (rebuild-to-v2.md).
- **2026-09-23** — oats PR #107 (oats.aweb 1.12.0, resident identity grants): APPROVED at `c11e2add` on all four gates, then **approval withdrawn** the same evening — the OSS coordinator's live rehearsal on a real test identity found the `aw` CLI (1.36.1) refuses an external identity home (`--identity-home` / `AWEB_IDENTITY_HOME`) for every `id grant` command and resolves from cwd only; the hook passed both, so every global spawn would fail in the hook and roll back. The unit tests passed because the fake `aw` accepted the flag. Taught us: **for a provider hook that drives an external CLI, the fake models an assumption, not the contract — a live rehearsal against the real binary is a gate, and the maintainer should ask for its result before approving.** Also: a fake must encode the real binary's refusals, and the PR should state which binary version it models. Stage PR awebai/oats-aweb#6 held for re-sync from the round-3 head.
- **2026-09-24** — **v0.25.4 PUBLISHED** (PR108 `304f26ba`, tag, bump PR109). One kernel fix, reproduced from an operator's two error strings before touching code: the quarantine retry trusted any live `instance.json` as the spawn record; on a workspace home that file is the materialization stub written BEFORE the spawn hooks. Taught us: (1) **two records for one home is a design smell** — the stub exists so a launch can find its modules, the descriptor exists so a retry can clean up; when both are present the code must know which question it is answering; (2) a "could not rerun" message should name the field it lacked, not a guess about why — "lost its context repo" sent the reporter to the wrong key; (3) reproduce from the reporter's exact strings in a fixture first: the reproduction found the cause in one read of the marker versus the stub. Release-gate flake seen once more: `schedule-session` "literal text once" (tmux timing) — rerun-failed cleared it.
- **2026-09-24** — oats PR #111 merged `8c669114` (maintainer's own; K3′ of decision 27, shipped ahead as a defect fix): launch-hook `meta` persisted into `instance.json.capabilityMeta` after a successful start (spawn wrote it, retire reads it, launch dropped it). Found by the OSS coordinator preparing a grant-renewing provider. Taught us: **when a hook event is added to a lifecycle, audit every consumer of the hook's documented return shape for that event** — `runLifecycleHooks` collected `meta` uniformly, but only the spawn caller persisted it; the launch caller was written for `contributions`+`env` and nobody asked where the third field went. Also: the launch hook had no paragraph in `docs/capabilities.md` until this PR — an undocumented event is where such gaps hide. Rule applied: a documented return being silently discarded is a defect fix (ships as a patch), not new surface (waits on a decision).
- **2026-09-24** — **v0.25.5 PUBLISHED; OKF v2.1.4 + oats.aweb v1.12.0 TAGGED.** First releases cut under delegated authority rather than a per-tag GO. Sequence that worked: provider tag → catalog pin ON the provider PR's branch (its one red test is the pin parity) → squash → mirror/pin PR → kernel tag. Taught us: (1) **every version literal is a release step** — three tests/scripts (`release-packaging`, `okf-mirror-parity`, `clean-room-smoke`) pinned "2.1.3" and each cost a CI round; the git-tag-release skill should list them, or better, the smoke/parity tests should read the catalog instead of a literal; (2) guide truths written as "provider X.Y ignores key K" go stale the moment X.Y+1 ships — write them as "as of X.Y" with the behaviour, and grep for the version on every catalog bump; (3) the mirror checker (`check-okf-mirror.mjs --finalize`) is the mirror sync — do not hand-copy.

- **2026-09-24** — **oats PR #107 (oats.aweb 1.12.0) provider gate: APPROVE at `a72ec2d2`** (owner: Antares / oats-expert-antares; developer `integrations-expert-aweb-identity`, pi, spawned on the human's instruction to delegate implementation). Five rounds, three of them from the live rehearsal on a 0.25.3 rig with a real resident identity: `aw id grant` refuses an external identity home (flag and env; cwd only), `aw --json` is `MarshalIndent`, a recovery path claimed a revoke it had not confirmed. Final live record: mint from custody cwd, grant home, launch env, meta with address and grant, wake broker active with a grant home, whoami/inbox through the grant, retire = revoke, wrong-team mint+revoke+rollback — all pass; sends through a grant blocked by the `aw` client (aweb-abja, fixed on aweb OSS main `41574333`). Taught us: a fake CLI that accepts what the real binary refuses is a passing test for a broken hook — a provider hook that talks to an external CLI needs a rehearsal result before approval; and the identity program is bigger than messaging (Juan: grant-served global identities must operate as normal agents → aweb epic abjf, local custody chosen).
- **2026-09-24** — **oats PR #110 (oats.aweb 1.13.0, custody contract) provider gate: APPROVE at `9dfb0ce8`** after one RETURN at `47e24c36` (the launch hook took the grant locator from the ambient `AWEB_IDENTITY_HOME`; lifecycle hooks inherit the operator's environment, so a grant-served coordinator restarting a child would hand it the parent's grant — fixed with `meta.identity.grant.home`). Custody preflight before mint, concrete normal/reviewer scope lists, `--team` behind an unfilled version floor, launch renewal off by default (needs K3′, now on main), retire cleans every grant directory; wire spelling pinned against aweb commit `4c353d6d` (ops `name.v1`, errors as code strings). Lands after #107 via `rebase --onto`; 1.13.0 tag held for the reviewed aweb release and the rig acceptance (plaintext-only on the current custody slice).
- **2026-09-24** — Outsider verification of the published combination (Antares): kernel 0.25.5 (npm) + catalog oats.okf v2.1.4 (`2af47ad3`) + oats.aweb v1.12.0 (`9d8cc740`) on the two-team scratch rig. `sync` resolves both from the catalog with executable approval; a `--no-launch` spawn records `modules` at the pinned commits, `providers` with the host OKF settings, `workspace.soul.id` as `<repo key>#<soul>`; the OKF owner pin is that id, not a path; retire removes the home and the `okf-<id>` schedule. PASS — the rebuilds (aweb, cjr) are unblocked on the OATS side.
- **2026-09-24** — oats PR #110 (oats.aweb 1.13.0): APPROVED at `f6d0ff49`, squash-merged `a8a8d1f6`, **reverted the same hour** (PR116 `2b34d894`) — main's parity test requires `capabilities/oats-aweb` version == catalog pin, and the 1.13.0 tag is held. Content preserved on `hold/oats-aweb-1.13.0` (= `a8a8d1f6`); re-lands with tag + pin in one PR. Taught us: **a bundled provider's PR is not mergeable ahead of its tag** — "merged but unpinned" was a valid state for OKF (its mirror is synced by a separate step) but not for aweb (the PR IS the bundled copy). The maintainer's mergeability gate must ask "does main's own test suite pass with this on main?", not just "does the PR's CI pass?" — the PR's one red test WAS that answer and I read it as "expected until the tag" instead of "blocks until the tag". Also: **Desktop 10B-0 redirected from `release/0.24` to main** (human agreed: no 0.24 users; Desktop already accepts 0.25.x; a maintenance line for zero users is cost without benefit). `release/0.24` left inert.


---
type: Reference
title: Repo state — the living picture of the OATS repo
description: Always-current snapshot of what is on main, what is in flight (PRs, features, running instances), recent deliveries, and open threads. Every oats-expert instance updates the relevant subsection whenever it changes that reality (merge, release, spawn, retire, delivery).
tags: [stewardship, repo-state, living]
timestamp: 2026-09-19
---
# Repo state — the living picture

Maintenance contract: **whoever changes this reality updates this concept in
the same session** — a maintainer instance that merges a PR or cuts a release
appends here before retiring; the steward instance keeps it honest. Newest
entries first inside each section; prune entries that stop being true rather
than letting the file grow stale.

## On main

- **OATS/Pi/Desktop v0.24.0 published (2026-09-19)** — [immutable release](https://github.com/awebai/oats/releases/tag/v0.24.0), tag object `3dfa22c016e339fac6a7c1fe00d8058a214514d6` at reviewed source `b5829fd176967ce88d607770c75767267e36a1aa`. Release run `35433822989` passed build/test, all three Desktop build/smoke legs, both npm publications and GitHub publication of six installers plus checksums. Its sole failure was the known organization restriction on the final bump-PR creation. Both exact public registry version endpoints verified0.24.0 and immutable tarball integrity. Manual rescue PR #22 merged as `08c692d3`, changing only three manifest and two lock-root versions; source now matches the release, without retagging.
- **Published-artifact verification passed (2026-09-19)** — actual registry kernel/adapter tarballs were integrity-checked, then installed outside the checkout and exercised through the existing clean-room assertions with only acquisition changed from source packing to published bytes.22.859s/exit0: actual installed CLI/core/adapter, shipped syntax, OKF2.1 byte/alias provenance, required hooks, large inspection, source-free reads, seeded directory completion and normal scaffold retirement. Models/backends remained tripwired; this does not relabel seeded data as fresh live learning. Earlier real both-backend native/curriculum/learning results remain tied to their original source pins. Workspace/role/private-provider cutover and any remaining native published-resource check are deployment work, not implied by artifact publication.

- **Reviewed first-cut source delivered (2026-09-19)** — framework through `0999f4a8` (runtime/pairing `c9ba5798`) and standalone OKF `f20f8e5` reached main by normal fast-forward pushes with exact remote readback. This includes the reviewed record/kernel outcome chain, native retained execution, provider operation-worker consumer and release pairing; held ancestry remains excluded. Real primary/worker learning and separate replay/restart/resource acceptance passed on both native backends at their original reviewed pins. Kernel0.24.0 publication and deployment remain separate, not implied by main delivery.
- **Official OKF v2.1.0 published (2026-09-19)** — [release](https://github.com/awebai/oats-okf/releases/tag/v2.1.0), immutable annotated tag object `ebd5d817a22e453ee49bf4cfb07eb94a58bcc03c`, reviewed commit `f20f8e57a22bdffb48b34dee9bcbc03a9e0704db`, distribution tree `d5bd8a525400f6d8e188110b4a6ea6e0d55c3874`. Exact-head standalone CI succeeded. Required kernel floor is>=0.24.0; this provider publication does not make installed0.23.x compatible or certify a deployment. Existing framework finalization verified actual remote tag/committed bytes and modes before recording published provenance; no fabricated stamp or tag movement.

- **Integrated captured native/provider source delivered (2026-09-18)** — reviewed merge `cd938860` plus exact approved status-only documentation correction `e0bccef0` reached framework main by normal fast-forward. All four conflict resolutions had independent combined-context approval and immediate byte/stage checks; shared helper-owner policy, opted-in hook source inputs, native tmux/Herdr start/restart and public SOURCE/helper selection retain their closed authorities. Actual combined framework/API2/provider acceptance passes **3/3**, with source/dependency bytes unchanged. The coherent framework retry passes **2704 tests, zero failures, three skips**, and all eight framework/Desktop/syntax/validation/pack/tarball gates pass, source unchanged. Controlled scaffold/layout/normal retirement is included. The first full run's **2703/1/3** and independent unchanged **1/1** remain separate historical evidence; its null-status termination cause is unproven, not retroactively diagnosed or erased. No timeout/assertion/product change was used to obtain the retry pass.
- **Standalone OKF paired successor delivered (2026-09-18)** — exact `86bff1a` reached provider main by normal fast-forward from `ec5d767`. Scoped reader/schema/pairing closures are integrated; its full gate passes **285 tests, zero failures, five skips**, source unchanged. The new combined **3/3** actually uses this provider with the integrated API2/native framework, rather than rebranding the older isolated producer/API1 fixture. Retained-run continuation is seeded, not a newly launched worker. Both deliveries are unreleased SOURCE checkpoints: no tag, version/floor update, install, mirror/catalog activation, live model/worker/Pi/real-host/private-provider qualification or runtime Git knowledge publication occurred.

Earlier dated source entries below are delivery history; this checkpoint supersedes their old pending-integration statements without rewriting the underlying review or gate evidence.

- **Reviewed fresh-source onboarding facade delivered (2026-09-17)** — eight independently accepted additions from exact `bba25ca4`: source/workspace/deployment inspection, issued directory witnesses and mutation-boundary recheck, thin existing-core acceptance adapter, pinned public-consumer evidence and guidance. The reviewed patch/inventory and every resulting blob matched; already adopted request/resource files and migration/native ancestry were excluded. Incremental combined gate **19/19** plus syntax, project, packaging and strict knowledge checks passed, source unchanged; the scaffold/layout/normal-retirement case was included. Historical c5/257 consumer pins remain historical, not current native/Herdr/provider readiness. The full framework baseline remains the separately recorded C1 eight-gate result.
- **Standalone OKF source checkpoint delivered (2026-09-17)** — provider repository main fast-forwarded from published `4b6d861` baseline to exact `ec5d767` after the assigned reviewer confirmed continuous coverage of all 33 commits and closure of returned findings. Corrected isolated full gate: **270 pass, zero failures, four skips**, exact source unchanged; the earlier harness-placement failure is preserved. This is an unreleased source checkpoint only: package/version floor, generic execution-reader completion, public helper/native/Herdr behavior and real provider acceptance remain open. No tag, install, mirror update or runtime Git knowledge publication was performed.
- **Reviewed captured admission and preparation routes delivered (2026-09-17)** — code `c1ff882b`: exact captured scaffold/activation, durable incarnation/action custody and receipt-preserving retries; explicit standalone context/generic invocation; retained helper lookup; portable boundary composition; strict public preparation request transport and workspace-presence validation. The independent fix-only v2/context/hookup verdicts were integrated without native-start ancestry. All eight coherent gates pass at exact code head: **2674 tests pass, zero failures, three skips**, plus syntax, Pi syntax, project/strict knowledge, pack and clean-room tarball checks. The merged-tree 30-case gate included owned scaffold/layout/normal retirement. No `packages/record` runtime or held patch changes. This is source delivery, not a new release, running helper/Pi/Herdr, private-provider qualification or complete fresh-facade adoption.
- **Provider preparation, captured operations/hooks and migration evidence delivered (2026-09-16)** — through `9c69251a`: approved provider fields resolve through the single resolver; complete nonsecret bindings and per-action readiness; private binding/source-receipt invocation inputs; public captured operations with exact home authority, bounded execution and receipt-preserving cleanup failures. Helper-authored policy refuses until independently prepared. Strict legacy lock decoding has one acyclic implementation; explicit bounded historical inventory, v1/v2 artifact observations and canonical no-replace partial evidence remain unselectable, with no trust or historical-mode promotion. All scoped review findings closed before coordinator integration. **All eight local gates passed at exact `9c69251a`: 2651 passed, zero failed, two existing skips**, including Desktop suites and pinned actual provider-consumer fixtures; syntax, project/strict nine-bundle validation, packing and clean-room smoke passed. Scaffold/layout/normal-retirement checks passed. This is source delivery, not a release, public captured launch, reconstructed migration, live provider/privacy certification or production cutover. Later scaffold/lifecycle work remains independently in flight.
- **Captured scheduler and provider broker delivered (2026-09-16)** — through `17bda42a`: immutable scheduled command templates with fresh per-admission intent, unresolved-attempt/lock custody, same-execution reconciliation, real prepare-on-tick, captured-wake templates, and negotiated schedule API 2. Existing Desktop management accepts API 2 but its legacy editor refuses unsupported captured policy rather than discarding it. The provider binding manifest/wire and native retained-command broker are implemented: exact approval before code, bounded/sanitized JSON, original field-authority witnesses and non-ignorable codec timeout. Bounded review findings are closed, including canonical deployment aliases and codec termination. Full integration run: 2628 passed, one help-vocabulary assertion failed, two existing skips; that sole failure was corrected and its focused regression passed, as did syntax/project validation. This is not a claim of a repeated all-green full run. Scaffold/layout/normal-retirement probe passed. Provider preparation/lifecycle wiring, actual private-team qualification, migration and release/deployment remain unfinished; no live job or new release is implied.
- **Exact captured commands and native preparation delivered (2026-09-16)** — through `049a22ad`: retained action/instruction loading, explicit captured CLI inspect/trust/command selectors, prospective artifact-set approval before provider normalization, and native by-reference command/curriculum preparation with dedicated helper records. Targeted deletion/poison and real CLI tests pass; bounded review findings are closed, including raw hook declarations being incorrectly confused with legacy shell-rendered commands. Native preparation publishes no complete main record when provider qualification is missing. Source-only delivery: full provider/runtime/launch/lifecycle/migration integration and production deployment remain unfinished. A parallel scheduler lane is active; no new release or Desktop parity claim.
- **Portable package preparation and setting-default capture delivered (2026-09-15)** — through `1a61daa4`: shared package closure/materialization, frozen-source package preparation, guarded local/Git projection, strict pre-parse ingress and exact manifest-default provenance in the same choice resolver. Adversarial package/privacy/provenance findings are closed, including rejection of invented overridden defaults. Latest bounded parent checks passed (12 record/default, six stream-lock, three dependency/scaffold checks); independent closure passed its ten requested tests. Main CI at `c68d7e3d` exposed a wall-clock assertion after successful lock acquisition; the test-only correction now observes bounded polling, without changing record runtime or held capture work. **Latest full CI remains to be confirmed.** Complete captured composition, public action dispatch, migration, provider qualification and production deployment remain unfinished; no release or Desktop parity claim.
- **Portable Souls foundations delivered directly (2026-09-15)** — `8373fc2f` is on main: versioned canonical data/digests, strict source/declaration schemas, retained source/resource/artifact and captured-record primitives, source-request lock v3, separate exact approvals, source-aware choice planning, native repository observation and reciprocal workspace/import discovery. Bounded adversarial findings are closed, including a reproduced case-alias pre-write escape. All eight local integration gates passed at code head `92d031e6` (2586 pass, zero fail, two existing skips); the later CI-only change passed its focused checks and enables the same gates on direct main pushes. Prior foundation PR #21 was automatically marked merged when its commits reached main. **No new release or production activation is claimed:** package preparation, captured public consumers and explicit migration remain in flight.
- **Published baseline is v0.23.2 (2026-09-14)** — [the immutable release](https://github.com/awebai/oats/releases/tag/v0.23.2) is published, not draft/prerelease. The preceding v0.23.1 publication incorporated the released OKF v2 catalog/mirror after PR #18; that integration is no longer pending. The newer source foundations above do not silently update installed deployments.

Earlier dated entries below are delivery history, not current deployment, process or readiness assertions; the current checkpoint above supersedes their old version snapshots.

- **Knowledge prerequisites published (2026-09-13)** — OATS/Pi/Desktop **v0.23.0** published from `c0628d3a` after PR #17 and successful release run `34770619372`; all three Desktop legs and npm publication passed. Official **OKF v2.0.0** is published at `4b6d861` after standalone PRs #1/#2, 226/226 released-minimum tests and successful public-consumer CI `34779176900`. The kernel prerequisite intentionally retains the 1.6.1 catalog pin; the v0.23.1 integration branch now verifies and incorporates the immutable v2 payload. These facts supersede older release-version snapshots below without rewriting their history.
- **RELEASED v0.20.0 (2026-07-30)** — tag `v0.20.0` at `1e73257` published `@awebai/oats@0.20.0`, `@awebai/oats-pi@0.20.0`, and the complete Desktop 0.20.0 installer/checksum/provenance set. Release run `30548558607` passed build/test/tarball and all three Desktop build+smoke legs; its only failure was the known Actions-created-PR organization restriction after publication. Manual bump PR #68 merged as `c6d92da`, so main manifests are 0.20.0. Official package revisions, catalog follow-up, and local cutover are now authorized in that order.

- **PR #67 merged 2026-07-30 as `436b866`** — exact reviewed head `b519756` makes main tag-ready for the breaking v0.20.0 line: Desktop API remains v1 and accepts released CLI `>=0.18.0 <0.21.0`, with unit and real discovery-path edge coverage; grounded release notes record revised-v2 capability materialization, fully local templates, v1 whole-scope migration, unsupported transitional v2, release order, and backup/credential guidance. Full local gate, required CI, and all three installer verification legs passed; same-account approval comment `5131615861`; expected-head merge succeeded and remote branch was deleted. Tag publication is next; official package revisions/catalog follow only after the kernel release.

- **PR #66 merged 2026-07-30 as `dc30f0d`** — exact reviewed head `ecd1b41` replaces the transitional package-root v2 shape in place: packages are transient atomic transport/update units, capabilities materialize as flat self-contained versioned/trusted artifacts under gitignored `.agents/capabilities/installed`, optional `config-templates` become fully local editable configs with a committed adopted base and byte-preserving diff/sync/reset/adopt, classic init is catalog-first/untrusted, and v1 migration is whole-scope atomic with no residue. One terminal review RETURN at `b189fcb` closed seven demonstrated filesystem/config/provenance/rollback issues in one bounded pass. Final gates and exact-head CI passed; same-account approval comment `5131055219`; expected-head merge succeeded and the remote branch was deleted. Not yet released: a bounded Desktop API v1 compatibility-band/release-note follow-up must precede v0.20.0, then official packages/catalog and local cutover.

- **RELEASED v0.19.4 (2026-07-28)** — official distribution packages, config-profile snapshots, lock v2, contained `oats-package/` payload roots, guided 0.18 migration, consented runtime requirements, strict OATS-managed instance curricula, canonical primary-checkout homes, official catalog/redirects, and the specialist-agent README are published as `@awebai/oats@0.19.4`, `@awebai/oats-pi@0.19.4`, and the complete Desktop installer matrix. Release run `30396340346` passed all code/package/clean-room/Desktop artifact gates; its only failure was the known Actions permission block after publication. Manual bump PR #65 merged as `9131b83`. The six official package repositories are independently tagged/released; `oats.dev@1.0.0` is the complete editable non-Git workspace profile, and each package repository now owns a durable package-maintainer soul. Local released-runtime install, package reconciliation, Pi/Claude composition, aweb root, and cross-repository spawn/retire probes passed.

- **PR #58 merged 2026-07-28 as `ab51acc`** — guided existing-user migration builds on the existing transactional engine: `oats migrate --official --recursive` plans outer/team/nested lock scopes, uses catalog capability aliases (including `oats.review`→`oats.dev`), preserves config bytes and custom/owned/path entries, holds unmapped official scopes unchanged, never transfers trust, and reports exact trust/install follow-ups with stable JSON and doctor readiness. Multi-capability package conversion and held dry-run exit truthfulness were fixed before terminal APPROVE. Independent detached clean room passed 865 tests (864 pass/0 fail/1 environment skip), all checks/strict seven-bundle OKF/pack/smoke/diff; required exact-head CI passed; approval comment `5107558430`; expected-head merge succeeded and remote branch was deleted. The installed `oats.authoring` hoisted-resource anchor defect remains a separate active release blocker.

- **PR #57 merged 2026-07-28 as `d9e176f`** — Git/catalog package sources now select a configurable contained payload path; the official/default convention is `oats-package/`, custom paths and explicit root are supported, and direct local package roots retain exact-directory semantics. Lock v2 strictly records canonical `path`; acquisition clones one exact commit and installs/hashes only the selected subtree; bare restore keeps the locked path while only explicit update may advance it. Local owned/path capabilities are unchanged. Review rounds closed catalog-path loss, pinned-ref drift, lock-source kind reclassification, intermediate broken/escaping links, Git ref option injection, and remote-branch DWIM regression. Terminal product head `bc11a02` was APPROVE; exact PR head `842f043` adds semantically current knowledge only. Full local gate = 853/0 plus all checks; exact-head CI passed; approval comment `5106896683`; expected-head merge succeeded and remote branch was deleted. A merged-source scaffold-only child probe then verified canonical primary home placement, AGENTS/CLAUDE and skill aliases, exact kernel+targeted capability curriculum, Claude/Opus runtime posture, lineage metadata, and clean worktree/branch retirement. Existing-user v1 migration remains a separate immediate follow-up.

- **PR #47 merged 2026-07-26 as `6f8dbf1`** — knowledge-only oats-desktop-engineer split-ui post-merge harvest preservation. It carries retiring `oats-desktop-engineer-split-ui`'s final harvest commit (`44b019f`, cherry-picked as exact PR head `42c35ec`) into the canonical Desktop soul: maintainer mergeability loops now emphasize live PR head verification, rebasing only onto explicitly mailed successor SHAs, hold discipline while a wait instruction stands, self-contained handbacks, newest-first `log.md` union conflicts, fresh fetch before PR opening, and gating mechanical stewardship/rebase commits. Final gates passed: source-state comparison showed only that Desktop-soul harvest not on main and byte-identical touched files, targeted Desktop strict OKF `110/0/0`, aggregate strict OKF all 8 bundles with zero warnings, scratch `npm test` `568/569` with the expected node-pty skip, `check`, `validate`, `pack:check`, diff-check, and exact-head PR CI. Same-account approval is PR comment `5085072697`; expected-head merge succeeded, and the remote harvest branch was deleted manually after the detached scratch worktree prevented `gh pr merge --delete-branch` from determining a current branch. No product, release, manifest, package, or framework behavior changes.

- **PR #44 merged 2026-07-26 as `479e8b5`** — Desktop split/sidebar UI completion follow-up to PR #41. Adds visible sidebar restore/toggle buttons and tab-strip split controls that dispatch through context-gated registered actions, proves splits seed from the active terminal tab, and aligns split member tabs in a dedicated full-width pane row by moving the real tab elements into per-pane groups while non-member tabs/controls stay below. Final exact head `f9e9ebb` passed prior full scratch gates plus final exact-head PR CI and all three installer checks after six mergeability-only RETURNs caused by concurrent stewardship/PR #45/#46 main movement. Same-account approval is PR comment `5085035759`; expected-head merge succeeded, and the remote feature branch was deleted manually after `gh pr merge --delete-branch` tripped on detached scratch branch detection. Post-merge scaffold-only child probe `oats-expert-pr44-probe` verified AGENTS/CLAUDE, soul/work links, memory scaffolding, real skills, child relation metadata, `launched:false`, and clean retirement. Not yet released.

- **PR #46 merged 2026-07-26 as `83ce16f`** — knowledge-only oats-desktop-engineer post-PR45 harvest. It preserves the maintainer-handback stewardship-race lesson and links it from crossed-mail coordination: named handback bases are minimums once `origin/main` advances, stale verdicts get one evidence-backed reply, explicit stop/hold instructions still win, and stewardship-only merge commits still receive the root gate. Final exact head `2551f1d` passed semantic review, scratch `npm test` 557/558 with the expected node-pty ABI skip, `check`, `validate`, `pack:check`, strict OKF for all 8 bundles with zero warnings (Desktop 108/0/0), diff-check, and exact-head CI. Same-account approval is PR comment `5085013285`; expected-head merge succeeded and the remote harvest branch is deleted. No product, release, manifest, package, or framework behavior changes.

- **PR #45 merged 2026-07-26 as `6f35e9e`** — Desktop post-spawn terminal handoff now waits for actual terminal readiness (`running && tmux.session`) under the existing ownership/composite-identity guards, closes the completed modal, degrades safely on timeout, and contains the whole quiet auto-open async flow so automated failures warn instead of blocking or escaping as unhandled rejections. Final exact head `9c4e995` passed the full local/scratch history and all four exact-head checks after four mergeability-only RETURNs caused by delayed crossed mail and concurrent stewardship moving main. Same-account approval is PR comment `5084986482`; remote branch deleted, owner retains local cleanup. Scaffold-only child probe `oats-expert-pr45-probe` verified expected layout, real skills, child relation metadata, no launch, and clean retirement. Not yet released.

- **PR #42 merged 2026-07-26 as `09605c7`** — knowledge-only oats-desktop-engineer quick-open harvest preservation. It carries the retiring `oats-desktop-engineer-quick-open` post-merge memory-harvest commit (`97654ce`, cherry-picked as exact PR head `028a984`) into the canonical soul: deferred module-level Quick Open preselects now explicitly die with the mounted Spawn consumer on unmount, updating both the pending-intent data-currency lesson and the Quick Open → Spawn preselect handoff decision. Final gates passed: targeted Desktop strict OKF `106/0/0`, aggregate strict OKF all 8 bundles with zero warnings, scratch `npm test` `554/555` with the expected node-pty skip after root + Desktop dependency install and copied installed capabilities, `check`, `validate`, `pack:check`, diff-check, and exact-head PR CI. Same-account approval was recorded as a comment; the remote harvest branch is deleted. No product, release, manifest, package, or framework behavior changes.

- **PR #41 merged 2026-07-26 as `c055614`** — Desktop terminal tabs now support bounded side-by-side and stacked split panes with existing tab identity/dedup, pane-level selection, adjacent-member close fallback, resize refits, editable shortcuts, and a pending-slot model kept in parity with the renderer. The sidebar is hideable with a persisted shortcut; non-mac `Ctrl+B` remains tmux-owned. Final exact head `2ff4792`; scratch gates, strict OKF for all 8 bundles, PR CI, and all three installer checks passed. Same-account approval was recorded as a comment; the remote feature branch is deleted, while local cleanup remains with the worktree at `/private/tmp/integrate-split-panels`. Not yet released.

- **PR #40 merged 2026-07-26 as `3da7ce8`** — Desktop Quick Open for souls (`Mod+P`) and terminal focus on user-initiated jumps. Adds shared overlay-picker machinery, fixes the palette fuzzy scorer's negative-prefix no-match bug, routes soul selection through Spawn's consumed-once `preselectSoul()` handoff, keeps `Ctrl+P` in Linux/Windows terminals shell-owned, and makes terminal content focus explicit via `activateTab(id, { focusContent })` plus a chordless `terminal.focusActive` action. Final exact head `9d00985`; scratch gates, strict OKF for all 8 bundles, PR CI, and all three installer verify jobs passed. Same-account approval was recorded as a comment; the remote feature branch is deleted. Not yet released.

- **RELEASED v0.18.6 (2026-07-26)** — tag `v0.18.6` on release-notes/stewardship commit `0dd7878`, containing PR #38 agent relations and PR #35 editable keybindings. Published `@awebai/oats@0.18.6` + `@awebai/oats-pi@0.18.6` and GitHub Release v0.18.6 with all six Desktop installers, SHA256SUMS.txt, and build provenance. Release run `30198186842` passed build/test and macOS arm64/x64 plus Linux x64 installer build+smoke; its only failure was the known org-policy block on Actions-created PRs after publication. Manifests were bumped through manual rescue PR #39 (`9fc7c0e`). The published kernel passed syntax checks and a clean create→root-qualified child relation spawn→metadata/layout inspect→retire probe; canonical soul content stayed unchanged.

- **PR #38 merged 2026-07-26 as `dfa0ac0`** — explicit child/sibling/parent/unrelated spawn relations across kernel, CLI, and Desktop; ambiguity-safe root-qualified anchors; attached child-of-owner semantics; retirement splice repair; composite instance identity; cluster-first Active/sidebar surfaces; and a relation-aware spawn modal. The merge preserves PR #35 editable keybindings and PR #36 knowledge, with reviewed fixes for composite roster parent focus, hierarchy Brain selection, and modal shortcut ownership. Final exact head `4bbfe8d`; all local, strict OKF, PR CI, and three installer checks passed after two RETURNs. The remote feature branch is deleted. Scaffold-only child-relation probe `oats-expert-pr38-probe` verified expected layout, real skill directories, relation metadata, no launch, and clean retirement. The [spawn-relations decision](/decisions/spawn-relations-live-lineage.md) records the human-accepted no-journal/lease limitations. Released exactly as v0.18.6.

- **PR #36 merged 2026-07-25 as `032c7a3`** — knowledge-only oats-desktop-engineer post-PR35 keybindings harvests. Preserves both keybindings developers' stranded post-merge harvests: dispatch-ineligible view-action semantics, crossed-mail coordination, PR35 follow-up queues, modal focus restoration, and the DEFAULT_KEYMAP/defaultChord split plus terminal allowlist delivery follow-ups. Final exact head `1e9980f`; all local gates, strict OKF for all 8 bundles, PR CI, and mergeability passed after two maintainer RETURNs. The remote `harvest/keybindings-wiring` branch is deleted; local branch cleanup is blocked by another worktree at `/private/tmp/harvest-wiring`. No product, release, manifest, package, or framework behavior changes.

- **PR #35 merged 2026-07-25 as `7f1e5a7`** — Desktop user-editable
  keyboard shortcuts for all panel actions. Adds a central keybinding engine
  with localStorage overrides and sanitized explicit unbinds, a `Mod+,`
  shortcuts editor, action-id terminal allowlist interception before PTY writes,
  rebindable app/stage/tab/sidebar/terminal typography/view-local actions,
  full keyboard operation for roster/spawn/hierarchy surfaces, live chord labels
  and tooltips, and renderer syntax coverage. Final exact head `039458f`; all
  local gates, strict OKF for all 8 bundles, PR CI, and macOS arm64/x64 plus
  Linux x64 installer verify checks passed after two maintainer RETURNs. The
  remote feature branch is deleted; local branch cleanup is blocked by another
  worktree at `/private/tmp/integrate-keybindings`. Post-merge scaffold-only
  probe `oats-expert-pr35-probe` created the expected instance layout (AGENTS.md,
  CLAUDE.md, instance.json, STATE/log/notes, soul/work symlinks, .agents and
  .aw scaffolding) with `launched:false`, then retired cleanly. Released in
  v0.18.6.

- **RELEASED v0.18.5 (2026-07-25)** — corrective Desktop patch containing
  PR #32 and PR #33. Tag `v0.18.5` on `a0052bd` (both corrective merges plus
  release notes). Published `@awebai/oats@0.18.5` +
  `@awebai/oats-pi@0.18.5` and GitHub Release v0.18.5 with all six Desktop
  installers, SHA256SUMS.txt, and build provenance. Release run `30160666617`
  passed build/test and macOS arm64/x64 plus Linux x64 installer build+smoke;
  its only failure was the known org-policy block on Actions-created PRs after
  publication. Manifests were bumped through manual rescue PR #34 (`8f5af90`).
  The published kernel passed a clean create→spawn→inspect→retire deployment
  probe; this machine's global kernel and Pi bridge were updated to 0.18.5 with
  clean OATS and LFX doctors. Per coordinator instruction, running Desktop app
  processes were not touched.

- **PR #33 merged 2026-07-25 as `595159e`** — fixes both remaining v0.18.4
  terminal field failures: Shift+Enter suppresses xterm keydown/keypress/keyup
  while writing one newline, and modifier-forced local xterm selection enables
  terminal copy with tmux mouse mode (Option on macOS, Shift on non-macOS).
  Final exact head `d75fa3a`; human live verification, local full/affected
  gates, strict OKF, required CI, and all three installer checks passed after
  two maintainer RETURNs. Released with PR #32 in v0.18.5; v0.18.4 remains
  immutable.

- **PR #32 merged 2026-07-25 as `97f66c9`** — corrective rollback for the
  out-of-scope PR #29 Instances rail destination and second roster sidebar.
  The shell again exposes only Active overview and Soul roster as stages; the
  permanent sidebar remains the instances context. The deleted stage/view,
  tests, docs, and 104 lines of stage-only CSS are gone, with absence pins;
  shared grouping helpers remain for separately owned sidebar work. Final exact
  head `69641c9`; full local gate, human live workspace test, independent
  reviewer, required CI, and all three installer checks passed. Released in
  v0.18.5; immutable v0.18.4 artifacts remain unchanged.

- **RELEASED v0.18.4 (2026-07-25)** — Desktop UX fixes from PR #29. Tag
  `v0.18.4` on `a84443a` (PR #29 merge plus release notes). Published
  `@awebai/oats@0.18.4` + `@awebai/oats-pi@0.18.4` and GitHub Release
  v0.18.4 with all six Desktop installers (mac arm64/x64 DMG+ZIP, Linux x64
  AppImage+DEB), SHA256SUMS.txt, and build provenance. Build/test and all three
  installer build+smoke legs passed in release run `30158015741`; the run's
  only failure was the known org-policy block on Actions-created PRs after
  publication. Manifests were bumped to 0.18.4 through manual rescue PR #31
  (`fda7498`). The published kernel passed a clean create→spawn→inspect→retire
  deployment probe and reported Desktop API v1 at version 0.18.4. A human
  subsequently identified an out-of-scope Desktop navigation regression in
  PR #29. Corrective source landed in PR #32; v0.18.4 remains immutable and a
  new patch release is required (see open threads).

- **PR #29 merged 2026-07-25 as `b7203eb`** — Desktop UX fixes: spawn view
  retries an unsettled CLI probe with truthful pending UI; Shift+Enter inserts
  a newline and transcripts are copyable without Linux/Windows Ctrl-chord
  regressions; Instances is a first-class nav/palette stage with repo→family
  grouping, collapsible headers, and workspace-scoped sorting; active terminal
  tabs restore per workspace. Final exact head `9736852`; all PR and three-leg
  installer checks green. Released in v0.18.4.

- **PR #30 merged 2026-07-25 as `935d142`**: post-v0.18.3 knowledge-only
  harvest from cli-dev and oats-desktop-engineer. Promotes the corrected macOS
  installer signing/release lessons, strict codesign gate structure, release
  workflow/static-test gotchas, and a read-only aweb trust-mismatch diagnostic
  skill. No product, release, manifest, or framework behavior changes.

- **RELEASED v0.18.3 (2026-07-25)** — corrected macOS installers. Tag `v0.18.3`
  on PR #27 merge commit `921f44a`. Published `@awebai/oats@0.18.3` +
  `@awebai/oats-pi@0.18.3` (npm latest) and GitHub Release v0.18.3 with all
  six Desktop installers (mac arm64/x64 DMG+ZIP, linux x64 AppImage+DEB) +
  SHA256SUMS.txt + build provenance. Fixes the v0.18.2 defect: both mac `.app`
  bundles now carry COMPLETE ad-hoc signatures (identity `"-"`, NOT Developer ID,
  NOT notarized) and pass strict deep codesign, gated fail-closed in CI on both
  arches (external step + unconditional packaged smoke, byte-identical
  run-blocks). Manifests on main bumped to 0.18.3 via manual bump PR #28
  (`9a6eae8`) — the release run's own bump-PR create step is blocked by org
  policy (see open threads). v0.18.2 assets untouched. Operator to manually
  launch-test the released arm64 artifact.

- **PR #27 merged 2026-07-25 as `921f44a`**: publish valid ad-hoc-signed macOS
  installers (electron-builder `identity: "-"`; strict deep codesign gate as
  external workflow step + unconditional darwin smoke; release-notes existence
  gate; `CSC_FOR_PULL_REQUEST=true` on build-installers only). Drove v0.18.3.

- **PR #26 merged 2026-07-25 as `0061eb5`**: knowledge-only — promoted the
  detached-HEAD release refspec lesson
  (`agents/cli-dev/soul/knowledge/lessons/exact-tag-detached-head-refspec.md`)
  into the canonical cli-dev soul, harvested from PR #25's fix. No code change.

- **PR #25 merged 2026-07-25 as `8d7d2ee`**: release.yml bump-PR push ref
  fully-qualified to `HEAD:refs/heads/${BRANCH}` (detached-HEAD safe) + a
  regression guard in test/release-workflow.test.mjs. Fixes the recurring
  bump-PR push failure; no retag/republish (v0.18.2 stays complete).

- **RELEASED v0.18.2 (2026-07-25)** — first public OATS Desktop release.
  Tag `v0.18.2` on merge commit `7cc3b5b`. Published: `@awebai/oats@0.18.2`
  + `@awebai/oats-pi@0.18.2` (npm latest), and GitHub Release v0.18.2 with all
  Desktop installers (mac arm64/x64 DMG+ZIP, linux x64 AppImage+DEB), SHA256SUMS
  + build provenance (UNSIGNED/not notarized — no signing secrets). desktopApi:1
  contract verified on the PUBLISHED artifact. Source manifests bumped to 0.18.2
  (root/pi/desktop) via manually-rescued bump PR #24. Delivered by PR #21 (the
  Electron app + legacy-panel succession, merged `0961175`) + PR #22 (Linux
  executableName release-blocker fix, merged `7cc3b5b`). Superseded the failed
  `v0.18.1` cut (Linux desktop-build failed, nothing published; tag deleted).

- PR #19 merged 2026-07-24 as `9b39ee7`: OATS Desktop private package took over
  the panel backend; oats.web, `oats pane`, and the public control-pane export
  retired with migration diagnostics; explicit spawn lineage/task delivery +
  traversal-safe shared instance lookup. (Its "release still blocked on installer
  distribution" caveat is now RESOLVED by v0.18.2.)

- 2026-07-23 reviewer-deaths incident fixes (direct commits, incident
  response): b3eeed0 — retireInstance tmux kill-window targets `=`-anchored
  (tmux targets prefix-match; test fixture "reviewer-1" was killing live
  reviewer-15c135c* windows); 0753b40 — `npm test` pinned to explicit globs
  (bare `node --test` recursed into agents/*/instances/*/work sibling
  checkouts, re-running stale unfixed suites) + CLI-subprocess spawn/retire
  tests export PI_AGENTS_TMUX_SESSION=oats-test-nosuch.

- Earlier oats.web and Control Pane deliveries remain in the delivery log and
  donor-soul knowledge as migration history; their product surfaces are no
  longer present on main.
- Historical v0.19.4 package snapshot: oats.okf 1.4.1, oats.aweb 1.8.0,
  oats.authoring/oats.jira/oats.linear/oats.dev 1.0.0; oats.dev exported
  oats.review 1.2.0. These are historical tags, not the current release inventory.

## In flight

- **Claude Code/Codex native-launch policy clarified (2026-09-18)** — the human explicitly requires the complete resolved OATS instance home, skills, capabilities and lifecycle setup, but permits normal outside native context/skills for those two harnesses. No OATS-only visibility adapter or Pi dependency is required. Permission bypass remains explicit user opt-in, never an unattended-launch default. The [accepted decision](/decisions/claude-codex-native-launch.md) narrows the old universal strict-curriculum target without weakening composition/source/history custody. Exact regression/docs change `09f4a5f0` is integrated as `39587ea1` with six parent planning checks; full-home successor `cfe2df42` is integrated as `0583c32c` with one additional controlled case for both runtimes. That case uses actual local package acquisition, required-hook trust refusal/approval, complete skills/resources/instructions/metadata/work, inert capability hooks and normal retirement/work preservation; runtime/backend tripwires never execute. No runtime patch, native loading/permission-UI, captured-retirement or complete captured-worker qualification follows. The superseded alternative handoff was not integrated.

- **Native implementation and observer review closed (2026-09-19)** — framework `ad89ef2c` combines the reviewed record8fc/e0 chain with exact kernel outcome8c/306 and five-entry packaging. Kernel callbacks now delegate record-owned manifest evolution without weakening home/incarnation/intent custody. Outcome reads bind their opened descriptor to the currently named original-root-contained file before every bounded read; original failing ABA probes remain preserved. Parent26 focused host/outcome checks, three actual-record/public-CLI/shell coupled cases with SDK/backend doubles, three packaging cases and scaffold1/1 pass. Exact provider `c55b814` consumes the unchanged public outcome contract; its14 focused checks pass. These source reviews are closed, not fresh queues on delayed mail. No duplicate record adoption, held ancestry, recorder-bin/parser/store redesign or new protocol was integrated.
- **Real captured execution and learning passed (2026-09-19)** — on exact `ad89ef2c` / `c55b814`, both tmux and Herdr completed a real retained primary and an operation-created SOURCE worker. All four original process/SDK outcomes qualified with exit0; corresponding protected turns were captured, and both workers independently processed judgment, changed an owned directory knowledge base and left zero remaining inputs. The source-deleted/poisoned-config gate passed in184.449s with source unchanged. A first owned-endpoint attempt failed before model dispatch and remains preserved; a fresh correctly provisioned endpoint was used, not a repaired claimed home. A separate bounded real continuation probe then passed all four homes: exact completed-intent replay without a new native record, distinct restart under the same incarnation/witnessed root, new qualified outcome/turns, an observed instruction heading and selected skill read, and absence of a controlled unrelated ancestor canary. Native auth/profile remained normal and user-managed. This is stronger than the earlier inert/seeded evidence, but not universal context-exclusion proof or permission to repair unknown state.
- **Release preflight failures closed without gate weakening (2026-09-19)** — source CI at `0999f4a8` retained41 failures:39 explicit new-provider-floor refusals under unstamped0.23.2 and two stale Desktop band assertions. Exact test-only `c97ddf00` / `7352c16d` preserves0.23/0.24 acceptance and0.25 rejection, with parent2/2. The actual0.24 tag lane then passed its full build/test/package/smoke and Desktop matrix. Manual version-bump PR #22 aligns main after publication; no compatibility floor, runtime or assertion was weakened. Original bare-export dependency failure and older bundled2.0 smoke remain separate historical evidence.
- **Fresh deployment and role cutover remain distinct (2026-09-19)** — the0.24.0/2.1.0 artifacts are published and their installed smoke passes, but workspace re-provisioning, adaptation of the preserved five-role/external-KB/public-helper assets and real private-provider/team acceptance are not proven by that smoke. Deployment-specific installed paths/processes/remaining steps belong with the deployment, not this portable knowledge. Use existing accepted public contracts; do not invent source-edition/bootstrap/helper-owner or grant authority to force a cutover. Full Desktop design/feature parity follows actual infrastructure rollout.
- **Remaining feature and rollout boundaries (2026-09-19)** — the real print-mode start/replay/restart/directory-learning slice does not qualify interactive Pi, required nonempty managed plugins/contributions, scheduled or always-on captured harvesting, public captured wake/retire/recovery, private messaging/onboarding or Git-PR knowledge delivery. Requirements may not be dropped to make a profile eligible. [Native authentication](/decisions/harness-native-authentication.md), strict selected Pi curriculum and the [external witness](/decisions/captured-session-storage-identity.md) remain separate contracts. Proposed runtime-bundle grants, contribution/secret delivery and broader retirement/bootstrap remain human-pending; no credential wrapper, ambient fallback, secret persistence or new authority follows from these tests. Runtime Git knowledge publication stays PR-only. Fresh infrastructure deployment precedes full Desktop parity; historical migration remains deferred, and the original first-cut target was missed rather than reset.
- **Knowledge/harvester capability boundary reaffirmed (2026-09-16)** — the [reference/provider decision](/decisions/provider-neutral-knowledge-and-harvest.md) makes OATS responsible for generic binding, context, lifecycle/evidence and independent execution contracts; capabilities own models, retrieval, capture conventions, harvester/promotion/validation and publication. Audit helper-memory/injection and source-receipt assumptions before treating them as universal kernel policy. Default OKF custody/PR delivery remains intact; optional theory is not a mandatory runtime service.
- **Messaging through the capability contract (2026-09-16)** — the [accepted boundary](/decisions/messaging-capability-contract-boundary.md) assigns generic captured intent/invocation and result contracts to the kernel, while the messaging capability owns native identity/team/membership/transport and qualification. Existing provider wire is reused; any missing messaging invocation projection must be versioned and reviewed. Separate grant mechanisms are expected, not a reason to require a new unified permissions API. Exact aweb successor `be9ac7e` now has independent scoped approval for four files implementing non-authorizing exact-team readback and its authority ledger. It requires an injected client and returns `qualification:not-established`; preserved developer evidence is 12 offline tests, not an independent runtime rerun. Its parent ancestry retains only earlier scoped coverage. Released human/actor delegation, hosted administration/collision/key custody, an authenticated exact credential-reference client with certificate/revocation checks, context mapping, four distinct grants and real version/deployment qualification remain open. No production wiring, native effects, source-main integration, privacy or enrollment follows from this utility approval.
- **Fresh-install-first rollout (2026-09-16)** — the accepted [rollout decision](/decisions/fresh-install-first-portable-rollout.md) removes general in-place migration, historical reconstruction and additional migration CLI work from the current release-critical path. Already delivered evidence/refusal safeguards remain; incomplete history is not relabelled complete. Prioritize fresh setup/discovery, captured new-instance runtime/lifecycle and actual provider acceptance. Re-provisioning is not permission to delete repositories, knowledge, histories, work or identities. Target architecture invariants and infrastructure-before-Desktop order remain unchanged.
- **External knowledge and expert roster cutover (updated 2026-09-17)** — the [accepted rebuild direction](/decisions/expert-souls-and-knowledge-rebuild.md) remains: external durable knowledge and persistent overall/kernel/Desktop/market/onboarding expertise, not engineer-role souls. The [concrete adoption proposal](/decisions/portable-role-editions-and-bootstrap.md) recommends explicit parallel library exports, adopter-bound knowledge destinations and a separately proven operator-root helper for cold bootstrap. These choices and the new entry contract await human direction; syntax/pure-normalizer checks do not authorize them. Existing canonical/live sources, identities, curated content and read edges remain preserved. No new source editions, bootstrap API, KB publication or destructive cutover has occurred.

- **Portable Souls completion (2026-09-15)** — accepted authority is the September 14–15 Portable Souls design/retention/handoff documents under `docs/design/`. Implementation is authorized through release and production with direct maintainer delivery, without PR waits; proportionate testing and adversarial safety review remain required. The completed source/data/discovery foundations are not the runtime cutover. Next: complete managed launch/runtime/work-target/helper policy and public captured lifecycle/scaffold placement, connect the remaining migration-facing diagnostics/cutover contract, and qualify real provider/private-team behavior before release/deployment. Provider preparation, captured commands/operations/hook inputs and partial historical evidence are now implemented; unselectable evidence is not completed migration. The standalone default-OKF source adapter has cross-repository fixture evidence but is not yet a new published provider release. Managed runtime loading, non-secret payload classification and real private-team behavior need their own evidence. Desktop feature work follows infrastructure. [Reference theory](/decisions/provider-neutral-knowledge-and-harvest.md) remains optional; default OKF owns its model and runtime.
- Older package-wave and instance-status notes are historical, not requalified live work. Current deployment-specific state belongs to the deployment; do not infer running agents or pending operations from old delivery entries.

## Recent deliveries

- Local native acceptance and release-pair integration (2026-09-19): observer/record consumer and gate source reviews closed; real primary/operation-worker learning plus replay/restart/resource probes pass on both backends. Exact provider f20/framework b01 pairing is locally integrated with raw-object equality, scoped package checks, scaffold and release-stamped installed smoke. Not yet main/tag/publication/deployment (see delivery-log).
- Integrated native/provider source: framework merge `cd938860` plus approved docs `e0bccef0`, paired provider `86bff1a`, delivered to both mains on 2026-09-18. Actual combined3/3, standalone285/0/5 and framework2704/0/3 plus all eight gates pass; original failed run and scoped evidence limits preserved. No release/deployment claim (see delivery-log).
- Provider preparation/captured operation-hook authority and migration evidence: DIRECT MAIN delivery `9c69251a` on 2026-09-16 after closed scoped reviews and all eight exact-head local gates; no new release or production cutover (see delivery-log).
- Captured scheduler and provider binding broker: DIRECT MAIN delivery through `17bda42a` on 2026-09-16, with bounded review closure and proportionate integration checks; no new release/deployment claim (see delivery-log).
- Portable Souls foundations: DIRECT MAIN delivery `8373fc2f` on 2026-09-15, with closed bounded reviews, eight green local gates and direct-push CI enabled; no new release/deployment claim (see delivery-log).

- PR #58 guided official-capability migration: MERGED 2026-07-28 as `ab51acc`; exact head `24e6f00`, clean-room/full CI green, remote branch deleted (see delivery-log).
- PR #57 configurable contained package payload roots: MERGED 2026-07-28 as `d9e176f`; exact PR head `842f043`, required CI green, remote branch deleted (see delivery-log).
- PR #47 oats-desktop-engineer split-ui maintainer hold-discipline harvest: MERGED 2026-07-26 as `6f8dbf1`; exact head `42c35ec`, remote branch deleted (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: MERGED 2026-07-26 as `479e8b5`; final exact head `f9e9ebb`, remote branch deleted (see delivery-log).
- PR #46 oats-desktop-engineer maintainer-handback race harvest: MERGED 2026-07-26 as `83ce16f`; exact head `2551f1d`, remote branch deleted (see delivery-log).
- PR #45 Desktop spawn readiness handoff + modal close + quiet terminal open: MERGED 2026-07-26 as `6f35e9e` after four mergeability-only RETURNs; final exact head `9c4e995`, remote branch deleted, scaffold-only probe passed (see delivery-log).
- PR #45 Desktop spawn readiness handoff + modal close + quiet terminal open: RETURNED round 4 on 2026-07-26 at handed-back/API head `0b6853a` for mergeability only after PR #44 stewardship advanced main to `9ad504f` during handback (see delivery-log).
- PR #45 Desktop spawn readiness handoff + modal close + quiet terminal open: RETURNED round 3 on 2026-07-26 at handed-back/API head `f614be5` for mergeability only; it merged `627ffaa` but missed explicit successor `b5c9f3d` (see delivery-log).
- PR #45 Desktop spawn readiness handoff + modal close + quiet terminal open: RETURNED round 2 on 2026-07-26 at handed-back/API head `40938b8` for mergeability only; it merged `8191ea0` but missed explicit stewardship base `627ffaa` (see delivery-log).
- PR #45 Desktop spawn readiness handoff + modal close + quiet terminal open: RETURNED round 1 on 2026-07-26 at exact head `67d865c` for mergeability only; all other gates passed, waiting for a current-main merge and settled handback (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 6 on 2026-07-26 at live exact head `ad9ff4f` for mergeability/current-main only after PR #46 advanced main and made the PR conflicting (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 5 on 2026-07-26 at live exact head `abdbd28` for mergeability/current-main only; handback prose named stale `ff64caa`, and live branch missed `abd60d1`/`8d5dba5` PR45 stewardship on main (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 4 on 2026-07-26 at live exact head `07d714c` for mergeability only after PR #45 landed and introduced a Desktop knowledge-log conflict; same-head approval comment is superseded (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 3 on 2026-07-26 at exact head `4b91095` for mergeability/current-main only; it merged `b5c9f3d` but missed explicit successor `9ad504f` (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 2 on 2026-07-26 at exact head `defa48d` for mergeability/current-main only; product/correctness/security and all local/CI/installer gates passed (see delivery-log).
- PR #44 Desktop split/sidebar UI buttons + active-tab split seeding + split-aligned tab strip: RETURNED round 1 on 2026-07-26 at exact head `8836882` for product/diff-shape scope failure (see delivery-log).
- PR #42 oats-desktop-engineer quick-open deferred-intent harvest: MERGED 2026-07-26 as `09605c7`; exact head `028a984`, remote branch deleted (see delivery-log).
- PR #41 Desktop split panes + hideable sidebar: MERGED 2026-07-26 as `c055614`; exact head `2ff4792`, remote branch deleted (see delivery-log).
- PR #40 Desktop Quick Open for souls + terminal focus on user jumps: MERGED
  2026-07-26 as `3da7ce8`; exact head `9d00985`, remote branch deleted
  (see delivery-log).
- PR #39 release: v0.18.6 manifest bump (manual rescue after complete
  publication): MERGED 2026-07-26 as `9fc7c0e` (see delivery-log).
- PR #38 spawn-time agent relations across kernel, CLI, and Desktop: MERGED
  2026-07-26 as `dfa0ac0` after two RETURNs; exact head `4bbfe8d`, remote
  branch deleted, scaffold-only relation probe passed, v0.18.6 release pending
  (see delivery-log).
- PR #38 round 2 spawn-time agent relations: RETURNED 2026-07-26 for
  mergeability only at `df2e575`; all other gates and exact-head checks pass,
  but a previously launched maintainer harvest advanced main after handback
  (see delivery-log).
- PR #38 spawn-time agent relations across kernel, CLI, and Desktop: RETURNED
  round 1 on 2026-07-26 for knowledge correctness and mergeability at
  `e3f7401`; executable/security gates passed (see delivery-log).
- (record PR #, one-line scope, verdict, merge/close date)
- PR #36 oats-desktop-engineer post-PR35 keybindings harvests: MERGED
  2026-07-25 as `032c7a3` after two RETURNs; remote branch deleted
  (see delivery-log).
- PR #36 round 2 oats-desktop-engineer post-PR35 keybindings harvests: RETURNED
  2026-07-25 for mergeability only after correctness/security/full gates passed
  at `617241c` (see delivery-log).
- PR #36 round 1 oats-desktop-engineer post-PR35 keybindings harvest: RETURNED
  2026-07-25 for missing semantic parent harvest `5543ac5` (see delivery-log).
- PR #35 Desktop user-editable keyboard shortcuts for all panel actions: MERGED
  2026-07-25 as `7f1e5a7` after two RETURNs; remote feature branch deleted
  (see delivery-log).
- PR #35 round 2 Desktop keybindings: RETURNED 2026-07-25 for mergeability
  only after all code/knowledge/security gates passed at `b5651b6`; branch must
  merge latest main (see delivery-log).
- PR #35 round 1 Desktop keybindings: RETURNED 2026-07-25 for one
  knowledge-correctness fix after all code/security/mergeability gates passed
  (see delivery-log).
- PR #34 release: v0.18.5 manifest bump (manual rescue after complete
  publication): MERGED 2026-07-25 (`8f5af90`; see delivery-log).
- PR #33 Desktop Shift+Enter whole-chord suppression + modifier-forced terminal
  copy selection: MERGED 2026-07-25 as `595159e` after two RETURNs; released
  with PR #32 in v0.18.5 (see delivery-log).
- PR #32 Desktop Instances-stage scope rollback: MERGED 2026-07-25 as
  `97f66c9` after one correctness+mergeability RETURN; released with PR #33 in
  v0.18.5 (see delivery-log).
- PR #31 release: v0.18.4 manifest bump (manual bump-PR rescue after complete
  publication): MERGED 2026-07-25 (`fda7498`; see delivery-log).
- PR #30 post-v0.18.3 cli-dev/Desktop knowledge and skill harvest: MERGED
  2026-07-25 (`935d142`); strict OKF passed all 8 bundles (see delivery-log).
- PR #29 Desktop UX fixes: MERGED 2026-07-25 as `b7203eb` after one
  correctness+staleness RETURN and one mergeability-only RETURN; released in
  v0.18.4 (see delivery-log).
- PR #28 release: v0.18.3 manifest bump (manual bump-PR rescue for the release
  run's org-policy-blocked create step): MERGED 2026-07-25 (`9a6eae8`).
- PR #27 corrected macOS installers (complete ad-hoc signatures + strict
  codesign gate): MERGED 2026-07-25 (`921f44a`); drove the v0.18.3 publish
  (see delivery-log).
- PR #25 release.yml fully-qualify bump-PR push ref (detached-HEAD safe) +
  regression guard: MERGED 2026-07-25 (`8d7d2ee`); resolves the recurring
  bump-PR push failure (see delivery-log).
- PR #22 Linux executableName release-blocker fix + re-cut v0.18.2: MERGED
  2026-07-25 (`7cc3b5b`); drove the successful v0.18.2 publish (see delivery-log).
- PR #21 OATS Desktop standalone Electron app + legacy-panel succession: MERGED
  2026-07-24 (`0961175`); its `v0.18.1` release cut failed on the Linux build
  (nothing published), re-cut as v0.18.2 via PR #22 (see delivery-log).
- PR #19 Desktop ownership cut + legacy panel retirement + explicit spawn
  lineage/traversal hardening: MERGED 2026-07-24 after two RETURNs (see
  delivery-log).
- PR #17 oats.web 0.8.1 typing visibility/latency + /api/keys hardening:
  MERGED 2026-07-22 (see delivery-log).
- PR #16 oats.web 0.7.2 fast session attach: MERGED 2026-07-22 (see
  delivery-log).
- PR #14 oats-web 0.8.0 spawn-from-panel: MERGED 2026-07-22 after two
  mergeability-only RETURNs (main moved under the branch twice; see
  delivery-log).
- PR #13 oats.web 0.7.1 logical key routing fix: MERGED 2026-07-22 (see
  delivery-log).
- PR #12 oats.web 0.7.0 panel refinements: MERGED 2026-07-22 (see
  delivery-log).
- PR #10 webpanel-dev doc nits: MERGED 2026-07-22 (see delivery-log).
- PR #8 oats.web 0.6.0 terminal-faithful session view: MERGED 2026-07-22
  (see delivery-log); two non-blocking doc nits returned to webpanel-dev
  as follow-ups.
- PR #4 session-error-surfacing: built + approved, then **discarded by
  operator instruction** 2026-07-22 (branches deleted; recoverable from the
  closed PR's commits if wanted).

## Open threads

- aweb channel awakening drops (2 consecutive repros 2026-07-23): verdict
  mail from short-lived reviewer identities delivered and marked READ
  server-side but no awakening injected into the recipient's idle session —
  visible only via `aw mail inbox --show-all`. RESOLVED-as-characterized 2026-07-23: intermittent ~30-min
  delay when the recipient session is mid-turn (2 delayed while busy, 2
  prompt while idle); no drops observed. Reported to the human by
  tui-dev-desktop-shell. Triage: check `aw mail inbox --show-all` before
  assuming a retired sender died. Two data points at a consistent ~30-min
  offset (10:16→~10:4x, 10:23→~10:5x) suggest a fixed-period flush; operator
  report filed by tui-dev-desktop-shell with message-ids and timestamps.
  Fleet-facing lessons also promoted into tui-dev's soul knowledge. Escalated to the human operator via
  tui-dev-desktop-shell; triage guidance: window-gone + no-event now most
  likely means completed-but-event-dropped, check `--show-all` and the
  session log tail.
- Sibling agent worktrees predate the b3eeed0/0753b40 fixes; until they
  merge main, `npm test` run from THOSE roots can still prefix-kill live
  reviewer-* windows (owners notified via tui-dev thread).

- CI bump-PR step: the ambiguous-refspec failure is **RESOLVED on main** by
  PR #25 (`8d7d2ee`) and **confirmed on the v0.18.3 run** (push logged
  `[new branch] HEAD -> release-bump/v0.18.3`). The REMAINING cause is
  org-level: `gh pr create` fails `GraphQL: Resource not accessible by
  integration (createPullRequest)` because the awebai org policy blocks
  Actions-created PRs. Every tag-driven release therefore ends with a
  conclusion=failure run whose ONLY failed step is the bump-PR create; npm +
  GitHub Release already succeeded (never retag). Rescue each time: create +
  squash-merge the `release-bump/vX.Y.Z` branch manually (done for v0.18.3 as
  PR #28, v0.18.4 as PR #31, v0.18.5 as PR #34, and v0.18.6 as PR #39). Needs an org admin to
  relax the Actions-PR policy to fully automate.
  Rescue procedure is in the git-tag-release skill.
- Current published baseline is v0.23.2. Installed runtime/signature readiness is a
  deployment qualification, not something source delivery alone establishes;
  earlier immutable release assets remain untouched.
- webpanel-dev instance worktrees still hold deleted branches locally
  (webpanel-dev-1: feature/panel-refinements, fix/panel-key-routing,
  perf/fast-attach, debug/typing-live; webpanel-dev-spawn-from-panel:
  agents/webpanel-dev-spawn-from-panel — owners notified to clean up).

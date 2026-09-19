---
type: Reference
title: Delivery log — every PR that reached (or was returned from) the main gate
description: Append-only record kept by per-PR maintainer instances — PR number, scope, verdict per gate, merge or return, and anything the review taught about the codebase. The stewardship counterpart of git history — the WHY next to the what.
tags: [stewardship, deliveries, append-only]
timestamp: 2026-09-19
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

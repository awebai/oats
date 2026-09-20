# Adopt the OATS development workspace

OATS hosts the shared `oats-workspace.yaml`. Its separate `oats.yaml` advertises
source-complete exports and declares its own reciprocal membership. `oats-dev`
remains a development-capability repository, including `oats.review`; membership
neither activates that package nor replaces its existing configuration templates.

This guide covers the shared repository graph and portable expert source editions,
beginning with **the existing oats-expert**. Source publication is not a live
five-role roster or curated knowledge cutover, a shared runtime, private-team
enrollment or Desktop feature parity.
The [phase plan](design/2026-09-20-workspace-and-portable-adoption-plan.md) and
[knowledge model](knowledge-theory.md) retain those separate boundaries.

## The five framework experts

The indexed source editions are `oats-expert`, `oats-kernel-expert`,
`oats-desktop-expert`, `market-research-expert` and `oats-assistant`. Each declares
`owns` for its own same-named node and `reads` for the other four through logical
store `oats`, preserving the reviewed owner UUIDs. These are knowledge-routing and
context declarations, not access grants or proof of accepted knowledge. The parallel
`souls/` editions neither replace the legacy `agents/` roster nor adopt the curated
KB or change live instances; actual adoption still needs compatible providers and
explicit bindings. All five now explicitly declare `oats.core` under
`requires.capabilities`, with `source: repo:oats-package`. This retains the complete
package from the same reviewed source revision.

The dependency is visible and removable in the authored definition, not a change
to existing captured records. An edited edition needs its own reviewed publication
and import update; changing today's source does not rewrite an older pinned import.

## Shared versus local

| Git-shared declaration | Operator-local input or evidence |
| --- | --- |
| Workspace membership candidates and reviewed source import pins | Local source access and qualified repository observations |
| A repository's backlink and real package/soul export paths | Working checkout mappings and the explicitly chosen work target |
| Intrinsic capability requirements and logical knowledge interests | Provider settings, explicit store binding, private human/team choices |
| Complete immutable instructions and skill resources | Native harness/model/auth, backend endpoint, home and durable state |
| A reviewed source revision | Exact executable approval, current readiness and deployment acceptance |

No machine paths, credentials, private team identifiers, accepted-store locator or
owner registry belongs in the public workspace. Knowledge publication and acceptance
(S7) remain separate; no ready knowledge export is advertised. Preserve the parked
roster/curation and every old home, lock, source, pending job, history and worktree.

## Planned onboarding: OATS Soul Setup (D3)

**The D3 onboarding flow remains pending.** It will create and instantiate
`oats-setup-expert`, declaring both `oats.core` and `oats.setup` from the
[official marketplace](official-marketplace.md). Those capabilities are now
published in `oats.framework` 1.1.0 and listed; the separate setup-expert edition
and onboarding entry point do not become available merely by listing the package.
This flow was not shipped in the 0.24.0 or 0.24.1 kernel releases.

- The setup expert will help the operator adopt repositories, select capabilities
  and carry out the normal prepare/approve/scaffold/start steps. It bypasses no
  executable approval, provider readiness, identity or permission boundary.
- Every soul created by that flow will declare `requires.capabilities.oats.core`
  and its source explicitly. The operator can remove or replace that dependency
  by editing the authored definition, not a captured record; the kernel will not
  silently reinsert an absent one.
- The CLI/Desktop entry point still requires separate implementation and review.
  Do not invent a workspace init/adopt command, create a setup soul from this
  sketch, or treat a listed package as installed. Existing instances and retained
  resources are not rewritten by the plan.

## Stage two: published experts and pinned imports

- `oats-workspace.yaml` explicitly admits `oats` and the six intended capability
  repositories: `oats-dev`, `oats-okf`, `oats-aweb`, `oats-authoring`, `oats-jira`
  and `oats-linear`. It activates no additional capability; tasks default to none.
- `oats.yaml` exports all five `souls/<name>` editions above and the actual package
  roots `oats-package` (`oats.framework`) and `capabilities/oats-authoring`, not
  the npm root as a fictitious OATS distribution. Its workspace backlink names
  the same framework repository.
- The editions are parallel to, not replacements for, the live `agents/` roster.
  Each contains canonical instructions, `CLAUDE.md -> AGENTS.md`, and its reviewed
  private procedures where applicable. No durable KB is copied into them; legacy
  roster cutover remains deferred until S7 knowledge publication.
- Each edition preserves its knowledge owner, owned node and four cross-reads.
  Store `oats` requires the explicit `stores.oats` binding; no publisher writer,
  production store or grants are supplied. An acceptance fixture is parent-owned
  and cannot be counted as production knowledge adoption.
- Knowledge **oats.okf@2.1.1** and messaging **oats.aweb@1.10.3** are explicit hard
  requirements, not optional defaults. They are published starting revisions,
  **not proof that their combined bindings/runtime profile is ready**. The provider
  owner supplies that evidence and any subsequently reviewed compatible revision.
  Do not replace either requirement with none or erase a read edge to launch.

At these starting pins, the provider boundary is concrete:

- Published OKF2.1.1 supports `inherit: stores.oats`, normalized to
  `/bindings/knowledge/stores/oats`. The explicit `destination: oats` preserves
  routing; omitting it would instead require `write.default`. No new schema,
  owner or production locator is needed for this declaration.
- Released aweb1.10.3 (`24efa6f9`) has **no mandatory portable binding interface**,
  so it still blocks this pilot's portable preparation. Adapter work is tracked
  in the [program board](design/2026-09-20-redesign-program-board.md); a candidate
  is not a published compatible successor or native lifecycle qualification.
  Human/native-principal, private-context, admin/grant and admitted-lifecycle
  requirements remain provider/integration-owner work.
- Published OKF2.1.1 accepts retained Claude/Codex helpers with the complete approved
  capability closure and native-default model intent. Strict Pi still requires an
  explicit model and the sole-OKF profile; Pi plus messaging remains unqualified.
  This provider release alone is not combined-profile acceptance. Do not silently
  switch runtimes, force a model, or drop capabilities.

These are explicit readiness holds, not reasons to weaken the source. Parent must
select reviewed compatible provider revisions and update the source pin deliberately
before claiming an operational pilot; metadata-only repository indexes change none
of these runtime facts.

Stage one used an empty imports list until source publication. Stage two is now
committed: all five imports pin **`caa341f34009e37006567419a983d5a743037a79`**, the
published edition revision containing explicit core requirements and the package.
The later workspace commit `375b9f42` added those imports. Live source inspection
against published main resolved all five as `ready-for-preparation`; this is
metadata readiness, not provider binding, approval, enrollment or a running pilot.

## Preserve source-before-import publication order

1. Publish complete, reviewed source editions before pinning them. The current
   source is `caa341f34009e37006567419a983d5a743037a79`; future revisions must likewise
   exist before their workspace import update. Never use an invented SHA, a mutable
   branch or an unreviewed local candidate as the accepted source.
2. In each of the six repositories, review a root `oats.yaml` against its actual
   source head and actual `oats-package/oats-package.json`. The declaration is:

   ```yaml
   schemaVersion: 1
   workspace:
     source: git:github.com/awebai/oats
   exports:
     packages:
       - path: oats-package
   ```

   Preserve payloads, versions, old tags and legacy templates. This does not
   activate oats.dev, messaging or either optional task integration. Indexes are
   published on `main` in all six capability repositories (oats-okf, oats-aweb,
   oats-authoring, oats-jira, oats-dev, oats-linear); their publication proceeded
   separately from the framework's own source imports.
3. A subsequent workspace commit pins the published source, never itself or a
   future commit. The current first import is:

   ```yaml
   imports:
     - source: git:github.com/awebai/oats
       soul: souls/oats-expert
       revision: caa341f34009e37006567419a983d5a743037a79
       alias: oats-expert
   ```

   The [actual workspace](../oats-workspace.yaml) contains all five imports at that
   same revision; this excerpt is not a replacement for the full list. The layout
   test now checks stage-two imports and source-document declarations. Do not
   change stable export paths or owners merely because the workspace advances.
4. Qualify reciprocal admission at the now-published observations. A missing
   backlink, a fork's copied file or a stale workspace observation is not membership.
   Cross-repository indexes may land separately; until both sides exist, report the
   specific unqualified member rather than claim the whole graph is ready.

Membership selectors and backlinks omit `revision` deliberately: the repository
adapter observes the hosting provider's actual default branch, not a guessed
`main`. Within one preparation, observations are frozen. In particular, the
framework's self-member and workspace backlink must resolve to the **same commit**.
A separately pinned older workspace with backlinks resolving to a later head is
correctly stale; choose a fresh coherent observation, never rewrite an old retained
record. Imports have their own immutable source revision and need not track each
new workspace metadata commit.

Importing the exported soul directly does **not** follow the publisher's workspace
as adopter policy. A different workspace, or an explicitly standalone operator,
may consume it without membership in the OATS development workspace.

## Inspect source metadata before preparation

The public source inspector ships in [OATS 0.24.1](release-notes/v0.24.1.md),
following PR24 integration. Use an installed CLI containing that implementation.
It is **not supported by the original 0.24.0 release**: that older inspect route
can ignore the request flag and consult ambient classic configuration. Do not
infer command availability from a capability's version floor or today's catalog.

```sh
oats inspect --request /absolute/inspection.json --json
```

With the stage-two imports published, the authored inspection input can use the
same repository for workspace, member and source:

```json
{
  "deployment": "/operator/deployments/oats-pilot",
  "workTarget": "/operator/projects/oats",
  "source": "oats-expert",
  "origin": {
    "kind": "operator",
    "document": {"kind": "operator", "id": "workspace-adoption"},
    "pointer": "/source"
  },
  "workspace": {
    "source": "git:github.com/awebai/oats",
    "origin": {
      "kind": "operator",
      "document": {"kind": "operator", "id": "workspace-adoption"},
      "pointer": "/workspace"
    }
  },
  "member": {
    "source": "git:github.com/awebai/oats",
    "origin": {
      "kind": "operator",
      "document": {"kind": "operator", "id": "workspace-adoption"},
      "pointer": "/member"
    }
  }
}
```

The paths are operator-selected examples, not host defaults or new grants.
Independent adoption uses the full source/soul/revision/alias reference and an
explicit standalone context instead of workspace/member. Do not mix this inspect
mode with current-context flags or captured deployment/resolution selectors.

The result is **non-authorizing metadata**, not provider readiness: even `ok:true`
may carry `needs-configuration` or `separate-deployment-required`. A
`ready-for-preparation` observation still has no approval or enrollment effect.
Provider payloads and opaque adoption values are deliberately omitted. Preserve
the original authored inputs; neither the result nor its inspection request is a
preparation request or an issued mutation witness. In particular, `workTarget`
and inspection catalog wrappers are not accepted preparation fields.

The inspector owns transient repository scratch but writes no deployment state.
Missing paths need explicit operator provisioning and reinspection, not automatic
repair. Observing a project work target does not change the separate captured H/work
placement. Existing retained inspect remains the later exact-record inspection.

## Prepare a fresh local pilot only after the profile is qualified

Use the selected installed compatible CLI. Do not turn this source check into a
global install, a daemon start or a model/GUI test on another operator's machine.
Keep native HOME/profile/auth and explicit permission choices; no credential copy
or empty profile. Knowledge, messaging and tasks have distinct authority contracts.

Before preparing, the integration lead must supply:

- The published workspace/source observations and an explicit fresh physical
  deployment/home placement. Do not copy old locks, retained records or identities.
- An operator-owned nonsecret request with `workspace` (its source and origin),
  `source: "oats-expert"` (or another published expert alias), and `mode: "directory"`.
  Standalone callers instead give the complete `{source,soul,revision,alias}`
  reference and an explicit standalone context; they do not inherit this workspace.
- Explicit provider-specific settings and bindings. OKF preparation needs selected
  absolute `bindings-file` and `state-dir`, `harvest-runtime`, and the `stores.oats`
  binding; an omitted `harvest-model` preserves native-default intent. The parent-owned
  acceptance fixture must supply an accepted node registry supporting the preserved
  owner **and all four read nodes**. This is not accepted production KB publication;
  Git destinations remain PR-only.
- Actual messaging human/context inputs and the pilot's explicit **`delivery: session`**
  setting (aweb's default is channel). Supply it in the complete supported
  `operator.policy.messaging` selection: capability, matching selected source and
  `settings: {delivery: session}`. Retain host requirements, session `ifInstalled`
  minimums and any selected authoring requirements. Selecting session delivery neither
  adds the missing1.10.3 binding adapter nor supplies captured wake/input authority.
- A qualified primary/helper runtime/model/resource profile. Capture the intended
  helper selection in `helperLaunches["oats.okf:memory-harvest"]`, not the legacy
  `souls.memory-harvest` configuration. Do not replace retained intent to fit an easier
  runtime profile. An old default-OKF-only learning gate does not qualify a combined
  aweb profile. If provider or kernel support is missing, stop at that typed result;
  do not bypass it with a legacy route, a dropped capability or a fabricated identity.

The existing public routes are stepwise (D/R/H are returned or explicitly approved
values, not names inferred from cwd):

```sh
oats prepare --request /absolute/operator-preparation.json --json
# Review returned exact artifacts/problems; approve only explicitly authorized code.
oats trust <capability-id> --deployment "$D" --artifact-set "$ARTIFACT_SET" --json
oats prepare --request /absolute/operator-preparation.json --json
oats inspect --deployment "$D" --resolution "$R" --composition --json
oats spawn oats-expert --deployment "$D" --resolution "$R" --home "$H" --no-launch --json
oats session start --deployment "$D" --resolution "$R" --home "$H" \
  --request /absolute/approved-native-request.json --json
```

Do not mix other preparation flags into request-file mode. A needs-configuration or
approval result is not a ready instance. A scaffold materializes resources and may
run approved hooks; it is not a message exchange or model session. Actual dispatch,
continuation, native capture, messaging and learning require the integration owner's
qualified profile and receipts. OATS 0.24.1 adds captured custody checks to the
existing HOME-only session inspect/input route; it does not supply the missing
messaging adapter or qualify every lifecycle route. Verify wake/input/retirement
support for the exact route and runtime. A stopped-home observation is not delivery
or retirement authority, and a messaging profile cannot pass on start-only evidence.
Do not bypass custody with a legacy fallback or remove the messaging requirement.
Consult the current installed public help and the provider's supported commands;
this guide introduces no new CLI grammar. The source inspector above is a separate
implementation dependency, not a change to the existing prepare request contract.

## Local checks and limits

`node --test test/workspace-repository-layout.test.mjs` checks the actual declarations
against the shipped codecs/schemas, required providers and owner/read mapping, and
contained source resources. An isolated native-Git fixture exercises source-before-
import publication, host-default observations, reciprocal/self admission, refusal of
missing/stale backlinks, and independent public source projection. Fixture member
indexes are not evidence that the six real repositories are already published.

Source and metadata checks do not enroll users, initialize the phase-2 store, register
production writers or qualify private messaging. Parent alone coordinates publication,
local operator approval and actual adoption. Full Desktop parity follows usable
infrastructure adoption, not merely source metadata passing validation.

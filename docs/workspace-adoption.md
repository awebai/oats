# Adopt the OATS development workspace

OATS hosts the shared `oats-workspace.yaml`. Its separate `oats.yaml` advertises
source-complete exports and declares its own reciprocal membership. `oats-dev`
remains a development-capability repository, including `oats.review`; membership
neither activates that package nor replaces its existing configuration templates.

This is phase 1: a shared repository graph and a transitional portable edition of
**the existing oats-expert**. It is not the five-role rebuild, the curated knowledge
cutover, a shared live runtime, a private-team enrollment or Desktop feature parity.
The [phase plan](design/2026-09-20-workspace-and-portable-adoption-plan.md) and
[knowledge model](knowledge-theory.md) retain those separate boundaries.

## Shared versus local

| Git-shared declaration | Operator-local input or evidence |
| --- | --- |
| Workspace membership candidates and reviewed source import pins | Local source access and qualified repository observations |
| A repository's backlink and real package/soul export paths | Working checkout mappings and the explicitly chosen work target |
| Intrinsic capability requirements and logical knowledge interests | Provider settings, explicit store binding, private human/team choices |
| Complete immutable instructions and skill resources | Native harness/model/auth, backend endpoint, home and durable state |
| A reviewed source revision | Exact executable approval, current readiness and deployment acceptance |

No machine paths, credentials, private team identifiers, accepted-store locator or
owner registry belongs in the public workspace. The uninitialized phase-2 knowledge
repository is not advertised as a ready knowledge export. Preserve the parked
roster/curation and every old home, lock, source, pending job, history and worktree.

## What this first source commit establishes

- `oats-workspace.yaml` explicitly admits `oats` and the six intended capability
  repositories: `oats-dev`, `oats-okf`, `oats-aweb`, `oats-authoring`, `oats-jira`
  and `oats-linear`. It activates no additional capability; tasks default to none.
- `oats.yaml` advertises `souls/oats-expert` and the actual framework package roots
  `oats-package` and `capabilities/oats-authoring`, not the npm root as a fictitious
  OATS distribution. Its workspace backlink names the same framework repository.
- `souls/oats-expert/` is parallel to, not a replacement for, the live `agents/`
  source. It contains canonical instructions, `CLAUDE.md -> AGENTS.md`, and the
  existing reviewed PR/release procedure closure. No durable KB is copied into it.
- The role preserves its knowledge owner, owned node and four cross-read interests.
  Store `oats` requires the explicit `stores.oats` binding; no publisher writer,
  production store or grants are supplied. An acceptance fixture is parent-owned
  and cannot be counted as production knowledge adoption.
- Knowledge **oats.okf@2.1.0** and messaging **oats.aweb@1.10.3** are explicit hard
  requirements, not optional defaults. They are published starting revisions,
  **not proof that their combined bindings/runtime profile is ready**. The provider
  owner supplies that evidence and any subsequently reviewed compatible revision.
  Do not replace either requirement with none or erase a read edge to launch.

The workspace intentionally starts with **`imports: []`**. A source cannot pin a
future commit containing itself. This first commit is publishable source metadata,
not an already usable/adopted pilot graph or a phase-1 exit verdict.

## Publish in this order

1. Review and publish this source/export commit to the framework repository. Save
   the **actual reviewed immutable source commit** containing the complete soul.
   Do not put an invented SHA, a mutable branch or an unreviewed local candidate
   in the workspace import and describe it as the accepted source.
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
   activate oats.dev, messaging or either optional task integration.
3. In a subsequent reviewed framework commit, replace the empty imports list with
   an import of the source commit from step 1:

   ```yaml
   imports:
     - source: git:github.com/awebai/oats
       soul: souls/oats-expert
       revision: <actual-reviewed-published-source-commit>
       alias: oats-expert
   ```

   The placeholder is explanatory text, never a value to commit. Update the
   staged-import test with that real publication evidence at this step. Do not
   change the stable export path or owner merely because the workspace advances.
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

## Prepare a fresh local pilot only after the profile is qualified

Use the selected installed compatible CLI. Do not turn this source check into a
global install, a daemon start or a model/GUI test on another operator's machine.
Keep native HOME/profile/auth and explicit permission choices; no credential copy
or empty profile. Knowledge, messaging and tasks have distinct authority contracts.

Before preparing, the integration lead must supply:

- The published workspace/source observations and an explicit fresh physical
  deployment/home placement. Do not copy old locks, retained records or identities.
- An operator-owned nonsecret request with `workspace` (its source and origin),
  `source: "oats-expert"` after the real import is published, and `mode: "directory"`.
  Standalone callers instead give the complete `{source,soul,revision,alias}`
  reference and an explicit standalone context; they do not inherit this workspace.
- Explicit provider-specific settings and bindings, including `stores.oats`,
  `state-dir`/`bindings-file` where required, and real messaging human/context inputs.
  The acceptance store must support the preserved owner **and all four read nodes**.
  Its existence/access/registration and messaging readiness are not YAML facts.
- A qualified runtime/model/resource profile and any required helper launch capture.
  An old default-OKF-only learning gate does not qualify a combined aweb profile.
  If provider or kernel support is missing, stop at that typed result; do not bypass
  it with a legacy route, a dropped capability or a fabricated helper identity.

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
qualified profile and receipts. Consult the current installed public help and the
provider's supported commands; this guide introduces no new CLI grammar.

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
infrastructure adoption, not merely seven YAML files passing validation.

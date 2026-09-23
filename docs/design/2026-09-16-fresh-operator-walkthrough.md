# Fresh operator walkthrough: working preparation versus pending launch

> **Superseded (2026-09-23).** The acceptance driver and helper this walkthrough runs (`test/portable-onboarding-public.acceptance.mjs`, `test/helpers/portable-onboarding-consumer.mjs`) were deleted with the workspace model v2; the 0.25 operator path is `oats onboard` → `oats sync` → `oats spawn` (`docs/first-team.md`). Read [2026-09-23-simplified-workspace-model.md](2026-09-23-simplified-workspace-model.md) (worked example) and [2026-09-23-workspace-module-contracts.md](2026-09-23-workspace-module-contracts.md) (normative) instead; kept as history.

## Scope of this evidence

This is a **source-level integration walkthrough**, not a claim about an installed
release. The onboarding builder/acceptance boundary is from `3b8f6532`; the real
preparation consumer remains pinned to
`c5c6a3c9171e424a36a1bdbf3932b9319a3c6c72`. A separate producer/CLI case is pinned
to `257c4b96b67001fa2bcf38436e57106c44aa797b` and exercises actual public
`spawn --no-launch`, including incarnation and intent custody. Neither test implies
compatibility with an untested newer wire. Core owns preparation scratch,
artifact retention, binding execution, approval and incarnation/admission. Onboarding does not replace
those implementations.

The acceptance uses a small manifest-declared **fixture knowledge capability**.
It does not use OKF, access external services, exercise harvesting, or qualify
private messaging. Its provider program interprets only its own collection and
explicit destination data. The source carries an unreachable publisher-workspace
backlink; inspection/preparation never adopts or contacts that workspace.

## Reproduce the pinned public consumer

**No longer runnable.** The acceptance driver and its helper were deleted with
the workspace model v2; the command below fails with `Could not find
'test/portable-onboarding-public.acceptance.mjs'`. The equivalent 0.25 evidence
is the CLI suite over the Northwind fixture (`test/onboard.test.mjs`,
`test/spawn-standalone.test.mjs`, `test/fixtures/northwind/build.mjs`).

```text
# historical (deleted): node --test --test-timeout=60000 test/portable-onboarding-public.acceptance.mjs
```

This explicit acceptance driver was separate from the default `*.test.mjs` suite:
a shallow checkout or source tarball need not contain a historical cross-branch
commit. An explicit run **failed** if the pin or matching dependency lock was absent;
it never silently skipped, fetched a moving branch, substituted current core or
stripped unsupported request fields.

`test/helpers/portable-onboarding-consumer.mjs` (deleted) archived committed core objects
into owned ignored `stage/onboarding-consumer-*` scratch and verified the pin and
held-patch exclusion. It linked only this worktree's dependencies after comparing
the complete npm lock. No working files from another agent were loaded and no Git
worktree/branch was added, reset or merged. Only the fixture's scratch was removed
on completion.

The test runs real native Git observations with isolated host configuration and
explicit local file transport mappings. Other transports are disabled. Public
preparation creates retained software/state **inside temporary fixture
deployments**; after explicit fixture-only artifact approval, its inert provider
normalize/bind/check commands run. The separate 257c4b96 case also executes the
fixture's declared spawn hook through the actual public CLI. It never hand-writes
permissive instance metadata: the producer mints and indexes each incarnation,
admits the hook intent, and settles the receipt. Guarded test executables detect
any attempted backend/model/client/host-timer invocation. No runtime, helper,
schedule, normal capability command or live provider is launched.

## Exact operator sequence at this source checkpoint

### 1. Choose independent inputs

Choose an explicit source export/revision/alias, deployment directory and work
target. Existing project files/Git repositories need not be empty. For organization
setup, choose an explicit workspace; consuming a public source does not make its
repository a member. Supply a member request only when reciprocal admission is
actually intended.

For standalone setup, supply an own `standaloneContextKey` field containing an
explicit opaque key, or explicit `null` for no private context. Never derive it
from a path, username, source alias or agent identity. Do not also supply a
workspace. The fixture prepares both keyed and explicit-null standalone requests,
with messaging disabled; neither case proves messaging enrollment/privacy.

Onboarding and pinned core both accept at most **256 UTF-8 bytes** for the key.
Oversized keys are refused, never truncated, dropped or derived from another input.
The earlier onboarding limit of 1,024 characters has been corrected: local ingress
rejects over-limit ASCII and non-ASCII keys before source access, and the real
pinned consumer retains an exact 256-byte non-ASCII key unchanged.

The key boundary is verified against pinned c5 preparation. Incarnation/admission
behavior is checked separately against exact 257c4b96, not inferred from c5.

### 2. Inspect, without authorizing installation

Use `preflightFreshDeployment({deployment})` and then
`inspectPortableOnboarding(input, {repositories})`, where `repositories` is the
existing `createRepositoryTransaction` owned by the caller. Inspect explicit
workspace imports/exports and optional catalog descriptor witnesses. There is no
automatic topology scan or publisher-workspace adoption.

- `separate-deployment-required`: preserve everything at that deployment and
  select another path. Do not delete its OATS state, knowledge, identity or history.
- `needs-configuration`: resolve the reported explicit input/membership issue.
- `ready-for-preparation`: advisory preflight/discovery passed; it is **not**
  provider readiness, executable approval, installation or launch permission.

Close the inspection repository transaction when inspection ends. The issued
inspection may be used to build a public request without retaining its scratch.
The real consumer proves this by closing inspection scratch before preparation.

A missing deployment path can be inspected, but public preparation requires an
existing directory. Provision that explicit path separately without replacing an
existing entry; onboarding does not create it. **Re-inspect after provisioning**
before the first preparation call. The old absent-path inspection is not permission
to use a directory that appeared later. Replacement of the selected deployment,
its absent-path parent or the work-target directory also requires reinspection;
ordinary project-file edits do not.

### 3. Supply explicit provider bindings and build the public request

```js
const choices = { operator, mode: "directory", allowLocalPaths: false };
const handoff = buildFreshPreparationRequest(inspection, choices);
```

`operator` uses the existing public operator envelope (`policy`, operator
`document`, optional `bindings`). A capability interprets its own binding payload;
there is no universal `writeDestination` schema or default destination in
onboarding. The fixture's `bindings.destination` is **fixture-provider syntax**,
not an OKF or generic kernel field.

Pass **all** of `handoff.preparation` unchanged. It contains deployment/source/
origin, explicit workspace or standalone key, operator/mode/local-input choices,
and an optional member request. It contains no `directory`: public
`prepareCapturedComposition` creates and cleans its own private scratch.
`handoff.workTarget` stays separate; this step does not perform actual work
placement.

### 4. Explicitly perform the first preparation

Given `core` loaded from the intended compatible kernel and explicit native
`repositoryOptions`, the working API handoff is:

```js
const first = prepareFreshOnboarding(inspection, choices, {
  prepareCapturedComposition(request) {
    return core.prepareCapturedComposition(request, { repositoryOptions });
  },
});
```

This is a **mutating command boundary**, unlike inspection/building. The driver
rechecks fresh state and its ephemeral selected directory witnesses immediately
before calling public core. If a legacy lock or other relevant managed state
appeared, it throws `fresh-deployment-required`; if an inspected directory was
replaced or a previously absent deployment was provisioned, it throws
`selection-changed` and requires a fresh inspection. Both refuse before calling
core. No project-content pin or new persistent custody registry is added; this
local recheck does not replace core's own concurrency and lifecycle guards.

An absent deployment returns `pending/fresh-deployment-provisioning-required`;
an absent callable adapter returns `pending/onboarding-integration-required`.
Both have `mutationAttempted:false`. An installed core that rejects a supplied
field remains a typed error, not a reason to strip the field and retry.

### 5. Review an exact approval request, then explicitly continue

An executable binding codec must itself be approved before normalize/bind may
run. In the real fixture, the first result has `resolution:null`, an
`approval-required` problem and an exact `{capability, artifactSet, request}`
approval request. No provider phase ran before that approval.

After the operator has reviewed and chosen **that exact** artifact:

```js
core.approveAvailableCapability(
  handoff.preparation.deployment,
  chosenApproval.artifactSet,
  chosenApproval.capability,
  explicitOperatorApprovalOrigin,
);
const prepared = core.prepareCapturedComposition(
  handoff.preparation,
  { repositoryOptions },
);
```

These are two deliberate mutations, not an automatic approval loop. Never approve
all returned requests merely to obtain a green result. The capability may still
report incomplete/conflicting bindings afterward.

After the first preparation writes managed state, the deployment is **no longer
fresh**. Continue through ordinary explicit public preparation as above; rerunning
the fresh driver correctly refuses. Do not erase the newly retained state to
bypass that guard. The driver is not a full resumable onboarding orchestrator.

### 6. Inspect the captured result, not a launch claim

When public preparation returns a resolution, use the existing public
`core.loadCapturedDispatch({deployment, resolution, action:{kind:"inspect"}})`.
The real test verifies the exact source commit/qualified identity, adopter-local
alias, explicit provider destination, workspace or standalone context, and
messaging-disabled choice from the retained record. Full-subject invocation data
also matches that record through the generic fixture check seam.

It verifies retained inspection again after removing **fixture-owned original
sources**, not after deleting real user repositories. This is preparation and
retention evidence—not actual running instance/job lifecycle acceptance.

### 7. Explicit public spawn without runtime launch (257c4b96 only)

At the separately pinned producer, a reviewed prepared **directory-mode** record
can create a new home and run its approved spawn hooks:

```bash
node "$PINNED_KERNEL/bin/oats.mjs" \
  --deployment "$DEPLOYMENT" --resolution "$RESOLUTION" \
  spawn "$RETAINED_SUBJECT_ALIAS" --home "$NEW_ABSOLUTE_HOME" --no-launch --json
```

These variables must name the explicit pinned kernel, retained resolution and a
new home under a real existing parent; the alias must match the retained subject.
Do not point the command at an occupied home or substitute an old instance's
metadata. No additional work-target flag is supported by this captured spawn
form. Its `home/work` is a newly owned execution directory, not silent adoption
of the separately inspected project checkout.

The real consumer uses this exact CLI after removing its fixture source/workspace
repositories. It asserts producer-created `incarnationId`, exact execution binding,
retained source/context/provider binding, index schemaVersion 2, and the same
completed hook intent in index/metadata/opaque provider receipt. Two homes with the
same resolution receive distinct incarnation and execution IDs. It also proves
private invocation/binding snapshots are cleaned up after hooks.

Successful output is **still pending launch**:

```text
ok:true
result.launched:false
result.launchPending:true
result.hooksPending:false
instance/index lifecycle: spawned-launch-pending
```

`ok:true` confirms this no-launch operation, not that a runtime started or user work
completed. Repeating the call for the same home, or choosing an occupied user-data
directory, returns `E_INSTANCE_EXISTS` without changing existing metadata/index/
work or dispatching another hook. The operator must preserve the occupied path;
there is no force/cleanup shortcut in this flow. Actual runtime start/wake/retire
and production provider qualification remain separate lifecycle/acceptance gates.

### Pending request-file router (lifecycle-owned)

The requested addition is `prepare --request <absolute-regular-json-file> [--json]`;
it is **not implemented in either pinned CLI**. The
[request transport helper](2026-09-17-public-prepare-request.md) is now implemented
as `readPortablePreparationRequest({file,inputFlags,explicitSelector})`; it takes
already-parsed transport forms, reads bounded strict JSON, and returns the whole
input unchanged to public core. The real preparation consumer exercises it.
The file is exactly `handoff.preparation`, never its wrapper or a captured
execution selector. The
lifecycle adapter must retain the existing source/workspace flag forms, make
request mode mutually exclusive with all source/deployment input overrides, and
use the existing bounded reader, strict JSON decoder and public core validator.
Explicit captured selectors must be refused for new preparation, including before
the command; stale inherited resolution/instance environment must not supply
new-work authority. The existing global selector parser owns this routing—there
is no onboarding-owned parallel parser. Until implemented/tested, use the working
public JavaScript handoff above, not invented request flags.

## Working versus pending

| Boundary | Status at the pinned consumer |
|---|---|
| Explicit source/workspace inspection and exact public preparation handoff | Exercised with real native Git and unchanged request objects |
| String/null standalone context in the public JavaScript API | Exercised; core's 256-byte limit applies |
| Exact artifact approval before provider compilation, explicit adopter binding | Exercised with a declared fixture capability only |
| Fresh preflight refuses newly appeared legacy state | Exercised before the real adapter is invoked |
| Private `directory` in public request | Correctly refused before scratch/acquisition writes |
| Request-file helper feeding the existing public preparation API | Implemented and exercised with unchanged inputs; no installer/global parser |
| Onboarding CLI request mode and standalone-key/operator-binding flags | **Not implemented in pinned `prepareCmd`**; lifecycle-owned router still pending |
| Public `oats prepare` source/workspace forms | Present in pinned source, but cannot express this complete fresh-context/binding flow; not a substitute for the tested API request |
| Core-owned inspection of a retained resolution | Exercised without source/workspace availability |
| Actual public `spawn --no-launch` at exact 257c4b96 | Exercised producer-created incarnation/index/intent and fixture hooks; returns pending launch, refuses overwrite |
| Full actual captured launch/start/wake/retire, managed runtimes and non-directory work placement | **Not qualified by these tests**; lifecycle-owned work/gates remain |
| Real knowledge delivery and private messaging grants/reuse | **Not qualified**; provider-owned implementation and bounded live acceptance remain |
| Historical reconstruction/in-place migration | Deferred; not required or silently satisfied by fresh setup |

No migration CLI, alternate installer/config engine, registry, identity database or
provider backend is introduced here. Main integration/release remain coordinator
operations, not consequences of a passing local consumer test.

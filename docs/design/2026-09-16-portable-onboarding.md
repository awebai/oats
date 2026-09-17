# Portable fresh onboarding and source discovery

16 September 2026. This module supports a controlled fresh setup path while
historical in-place migration is deferred. It does not alter the Portable Souls
architecture or weaken the existing partial/unknown evidence safeguards.

## Responsibilities remain separate

A fresh setup request carries four independent facts:

1. **Source location** — an explicit four-field soul reference, or an alias from
   one explicit workspace observation.
2. **Deployment/install location** — an explicit absolute path that passes fresh
   state preflight.
3. **Work target** — an explicit existing directory, independently reported as a
   Git or non-Git target. It never identifies the soul or deployment.
4. **Context/membership** — an explicit workspace plus optional reciprocal member
   request, or an explicit standalone context key. Declared messaging teams are
   reported separately; inspection performs no enrollment and makes no privacy
   claim.

`lib/portable-onboarding.mjs` reuses `createWorkspaceDiscovery`, the repository
transaction issued by the caller, and the existing workspace/member/soul parsers.
It contains no source/config parser, resolver, network adapter, package installer,
provider codec, credential handler or team operation.

## Fresh deployment preflight

`preflightFreshDeployment({deployment,maxEntries?})` is read-only. A missing child
of one real canonical parent is a valid fresh destination. An existing directory
may contain arbitrary project files, a Git repository, authored souls, and authored
capability source. Those do not make it dirty.

The preflight reports `separate-deployment-required` for fixed deployment-owned
state: configuration or selection locks, schedules, portable state, captured
resolutions or migration evidence, retained/installed artifacts, installed package
state, native history, and bounded discovered instance/retirement directories.
The scan is shallow and incrementally bounded. It never recursively inventories
project contents and never deletes, moves, repairs or rewrites a conflict. Advice
is always to preserve the existing path and choose a separate fresh deployment.

Issued inspections also keep ephemeral directory identity witnesses in memory:
the existing deployment, or the parent of an absent deployment, and the work
target. `recheckFreshOnboarding` rechecks those selected roots and managed state
after source inspection and immediately before the fresh mutation adapter. Root
replacement, disappearance or provisioning after an absent-path inspection
requires a new inspection (`selection-changed`); ordinary project-file edits are
allowed. No witness is added to public preparation JSON, written to disk or made
into an identity registry. This is a local point-in-time check, not a lock against
hostile concurrent writers; core retains its own action-boundary custody checks.

## Explicit source/workspace/export/catalog inspection

`inspectPortableOnboarding` requires an explicit deployment, work target, source
and origin. A string source is accepted only as an alias in an explicit workspace;
otherwise the caller supplies the ordinary four-field source reference. Workspace
and `standaloneContextKey` are mutually exclusive. Presence means an own field:
any supplied workspace value must pass the existing workspace discovery/schema
validator; `null`, `false`, `0` and empty text are not omission or a standalone
shortcut. Without a workspace, the key
must be explicitly supplied as opaque text of at most 256 UTF-8 bytes or explicit
`null`; it is never
derived from source/work paths, OS identity or repository metadata. `null` records
an explicit lack of standalone private context and is suitable only when later
preparation resolves messaging disabled. The
existing discovery adapter qualifies source identity, observes exact revisions,
validates the advertised export and parses the exported soul.

An optional explicit member request performs the existing reciprocal membership
check. Without it, repository membership is `not-requested`; import does not follow
the publisher's workspace backlink. Messaging team declarations are data only and
always report `enrollment:"not-performed"` and
`privateTeamQualification:"not-evaluated"`.

Catalog inspection is opt-in by unique declared workspace indexes. It observes the
catalog source/revision and exact explicit descriptor path through the same
repository transaction, returning only the source and document witnesses. There is
no guessed catalog filename and no kernel-owned catalog payload parser.

The result is `ready-for-preparation`, `needs-configuration`, or
`separate-deployment-required`, with all four responsibilities represented in
separate fields. `effects` reports no deployment writes, installs, activation,
credential, team or job operations while honestly recording repository reads and
caller-owned repository-transaction scratch use.

## Preparation handoff

`buildFreshPreparationRequest` accepts only an inspection object issued by this
module and only when its status is `ready-for-preparation`. It accepts public
operator/mode/local-input choices only; the public preparation wrapper owns its
private scratch directory, so `directory` is rejected rather than leaked from the
private `prepareComposition` contract. It returns:

```text
{ schemaVersion: 1, operation: "prepare", persisted: false,
  preparation: <existing prepareCapturedComposition input>,
  workTarget: <the separately inspected target>,
  effects: {writes:false, installs:false, activation:false, enrollment:false} }
```

It does not invoke preparation. A thin core/CLI adapter may pass `preparation`
unchanged to public `prepareCapturedComposition` only at an explicit mutating
boundary. The handoff forwards the exact standalone key for standalone contexts;
core at `c5c6a3c9171e424a36a1bdbf3932b9319a3c6c72` now admits and stores that field.
No adapter may rediscover targets, infer the key, read ambient config to fill
omissions, adopt a publisher workspace, or reinterpret work and team fields.
The public JavaScript bridge is implemented at that source pin; a complete fresh
onboarding CLI is still separate integration work.

## Fresh acceptance driver

`lib/portable-onboarding-acceptance.mjs` keeps acceptance above the same facade:

- `compareFreshSourceAcceptance({organization,standalone})` accepts only issued,
  ready inspections and proves qualified identity, exact commit, export and
  definition equality. The organization side must have workspace context; the
  standalone side must have standalone context and an explicit non-Git work target.
- `prepareFreshOnboarding(inspection, options, adapters)` builds the exact public
  request, rechecks the issued deployment/work-root witnesses and fresh managed
  state immediately before any mutation, and
  calls only an explicitly supplied `prepareCapturedComposition` adapter. An
  absent deployment returns `fresh-deployment-provisioning-required`; a missing
  core bridge returns `onboarding-integration-required`; both are `pending` with
  `mutationAttempted:false`.
- A supplied preparation result exposes explicit requested write bindings and
  exact artifact approval requests. The driver never approves them or converts an
  approval-required result into success.

The deterministic fixture uses one unchanged source in an explicit organization
workspace/member context and a standalone non-Git target. It verifies explicit
bindings and approval requests, publisher-backlink non-follow, and a positive
control where newly appeared managed state refuses before the mutating adapter.
That deterministic fixture uses no production provider, install, team, identity,
timer or job operation.

## Request-file transport

`readPortablePreparationRequest` in `lib/portable-onboarding-request.mjs` is the
thin bounded file reader for the proposed lifecycle-owned `prepare --request`
route. It accepts parsed transport forms, uses shared no-follow/strict JSON
readers and returns the entire public request unchanged. It rejects competing
input flags and explicit captured selectors before file access, does not inherit
old resolution authority, and adds no preparation schema/resolver/defaults.
Unknown fields remain present for public core to reject. See the
[request transport contract](2026-09-17-public-prepare-request.md); implementing
the helper does not claim CLI router availability.

## Pinned real public consumer

`test/portable-onboarding-public.acceptance.mjs` additionally executes the real
public preparation/approval/retained-inspection APIs archived from exact core
`c5c6a3c9171e424a36a1bdbf3932b9319a3c6c72`, without merging its branch. It uses
isolated local Git transport, temporary deployments and a declared inert fixture
knowledge capability—not OKF or a live service. The unchanged builder output
crosses the public boundary with no added private `directory` and no stripped
standalone/operator fields. Source identity, exact revision, explicit destinations,
string/null contexts, approval-before-code and retained full-subject authority are
checked. A newly appeared legacy lock still refuses before preparation.

A separate case in the same explicit driver pins
`257c4b96b67001fa2bcf38436e57106c44aa797b` for the actual public CLI
`spawn --no-launch`. It uses the real producer, not hand-written instance metadata,
to mint distinct incarnations and index admitted/completed fixture spawn-hook
intents. It verifies exact retained subject/context/binding, private snapshot
cleanup, and refusal of both repeated and occupied homes without overwrite.
The result is still `launched:false`, `launchPending:true`; actual runtime launch
and live provider behavior are not qualified.

See the [fresh operator walkthrough](2026-09-16-fresh-operator-walkthrough.md) for
exact reproduction, implemented public no-launch steps and the pending lifecycle-
owned request-file router versus actual launch/provider qualification. The earlier standalone key limit mismatch is corrected: onboarding
uses core's 256 UTF-8-byte bound, with no silent conversion. The pinned public
consumer checks preservation of a non-ASCII key exactly at that boundary.

Fresh setup is not permission to remove existing work, knowledge, native history,
identities or credentials. It is also not release, provider/privacy qualification,
instance launch, team creation or schedule activation.

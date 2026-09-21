# Public source inspection for same-repository workspace onboarding

This increment supplies the missing public adapter around the EXISTING portable
onboarding facade. It does not define another workspace format, parser, resolver,
registry, identity or permission. Source/member declarations remain separately
owned; production capability/profile readiness is not established by the fixture.

## Read-only entry

```sh
oats inspect --request /absolute/inspection.json --json
# Optional explicit request export (new private file; never overwrite):
oats inspect --request /absolute/inspection.json --emit-prepare-request /absolute/preparation.json --json
```

This mode accepts one request file, optional `--emit-prepare-request`, and `--json`.
The 0.24.4 follow-up also accepts the complete preparation request's `operator`,
`launch`, `helperLaunches`, `mode`, and `allowLocalPaths` fields. Inspection ignores
their semantics: it does not validate provider payloads, select a runtime/model,
execute a codec, or authorize local acquisition. `ignored: [...]` lists only the
present field NAMES in a stable order; values stay out of the metadata view and
`omitted.*` remains true. Preparation still validates those fields normally.
Unknown fields remain errors. Explicit captured selectors
or current-context flags conflict before file reads; inherited captured environment
is not new-work input. Other existing inspect modes are unchanged. The shared
bounded strict JSON request reader feeds the existing inspection validator intact:
unknown fields are not dropped, and no missing context comes from current config.

The public core export `inspectPortableOnboarding(input, {repositoryOptions}?)`
owns one transient repository transaction and its guarded cleanup. Its input is
the existing facade contract:

```json
{
  "deployment": "/operator/deployments/example",
  "workTarget": "/operator/projects/example",
  "source": "advertised-alias",
  "origin": {"kind":"operator","document":{"kind":"operator","id":"setup"},"pointer":"/source"},
  "workspace": {
    "source": "git:https://example.org/team/framework.git",
    "origin": {"kind":"operator","document":{"kind":"operator","id":"setup"},"pointer":"/workspace"}
  },
  "member": {
    "source": "git:https://example.org/team/framework.git",
    "origin": {"kind":"operator","document":{"kind":"operator","id":"setup"},"pointer":"/member"}
  }
}
```

These paths/references are placeholders. Workspace and member may identify the
SAME repository. They still require explicit workspace admission, a member
backlink and matching observed commits. Omitted repository revisions observe the
hosting default branch; they do not guess `main` or create circular future pins.

Independent adoption replaces workspace/member with an explicit source reference
`{source, soul, revision, alias}` and explicit `standaloneContextKey` (opaque string
or null). It does not follow the source publisher's workspace backlink or inherit
its development defaults/teams. A member check is optional; without one, import
reports `not-requested` membership, never enrollment.

## Metadata is not authority or provider readiness

Normal JSON envelope `result` retains schemaVersion1 and the existing statuses:
`ready-for-preparation`, `needs-configuration`, `separate-deployment-required`.
`ok:true` means the observation succeeded, including a truthful hold. Separate
fields expose source identity/revision/export metadata, deployment/work paths,
workspace identity/import locators, reciprocal observations, declared teams and
non-effect claims. Inspection executes no provider, hook, approval or native
backend and writes no deployment state; repository scratch is transient.

The public projection deliberately does NOT expose `source.reference` as a
reusable mutation input. Opaque adoption values and provider declaration payloads
have not been classified by their owner and are omitted. Import summaries expose
`adoptionPresent`; knowledge export summaries expose contract/version and
`payloadOmitted`. Top-level `omitted:{providerPayloads:true,adoptionValues:true}`
states that this is a metadata view, not a lossless request or a safe-payload claim.
It is not an issued `buildFreshPreparationRequest` witness, even in the same
process. The opt-in `--emit-prepare-request` route calls that existing builder
on the real in-process inspection before dropping the private witness. It writes
only `.preparation` to a new mode-0600 file at an explicit normalized absolute
path with an existing real parent; existing files/symlinks are refused, never
overwritten. JSON output names `prepareRequestFile` and records the explicit
request-file write in `effects`; it does not echo the request contents. The
export can carry unclassified adoption declarations and must remain private;
requests must contain nonsecret values or credential references, never secrets.
A held inspection cannot emit a fresh preparation request. Core callers can
explicitly request this data via `{includePrepareRequest:true}`; the default
metadata projection and its omissions are unchanged.

The explicit export preserves authored prepare-only fields privately through the
existing builder, without interpreting them; it must not silently drop operator
bindings or launch/helper choices. They remain unvalidated until preparation.
This does not expose their values in normal metadata or turn ignored values into
inspection authority.

The file is reusable new-work input, NOT a stored resolution, approval, admission,
or serialized ready-inspection permission. Preparation performs fresh validation
and observations, including re-resolving any mutable source selectors. Provider
configuration still requires explicit operator choices; conversion invents none.

Existing managed deployment state is preserved and reported, not repaired or
migrated. An absent selected path requires explicit operator provisioning and
reinspection. Prepare refuses it with typed `needs-configuration` and provisioning
guidance before fetching or writing managed state, not a raw ENOENT. Inspection's
`ready` means the path is eligible for fresh setup, not already provisioned.
The serialized inspection does not lock the filesystem or authorize
later mutation; preparation retains its own existing validation/custody rules.
The inspected work target does not become source identity or an implied placement
choice. Supported captured directory scaffolds own their separate H/work.

## Existing preparation and retained execution

`oats prepare --request` accepts deployment/source/origin, optional `workTarget`,
workspace/member OR standalone context, operator policy/bindings,
mode/local-input authorization, launch and helperLaunches. The original minimal
inspection request (without inspection-only `catalogIndexes`) is also accepted;
use the converter rather than stripping fields from a metadata/result wrapper.
Explicit `workTarget` is validated with the same physical existing-directory
validator as inspection and returned as work-context metadata. It takes precedence
over any caller assumption about cwd: no cwd/config fallback selects its value.
Omitting it preserves prior preparation behavior without inventing a placement.
It does not change source identity, `operator.localBase`, work mode, or captured
H/work placement. Do not pass an inspection result/catalog wrapper or private
scratch `directory` to preparation. Exact executable approval is separate. A required provider whose binding
code is unapproved may return `needs-configuration` with an `approval-required`
problem and exact artifact-set/capability requests, before any record exists:

```sh
oats trust <capability> --deployment <D> --artifact-set <returned-id> --json
oats prepare --request /absolute/preparation.json --json
oats inspect --deployment <D> --resolution <R> --composition --json
oats spawn <subject> --deployment <D> --resolution <R> --home <new-H> --no-launch --json
oats session start --deployment <D> --resolution <R> --home <H> --request /absolute/native.json --json
```

Each `selections[]` row carries an `artifactSet` id and an `approvalRequired[]`
array of **capability ids**. Pair them: pass the capability to `trust` and that
row's artifact-set id to `--artifact-set`. These are not interchangeable ids.
`trust <capability> --dir <D>` against a v3 deployment now refuses with typed
`needs-configuration` and exact available-set commands; it never picks or approves
a set automatically. Classic v1/v2 trust remains the classic route.

Provider preparation problems carry `slot` and `capability`, plus original
provenance where available. A no-interface provider is identified with kernel-known
manifest/version facts. Other supported slots still normalize, resolve through
the same choice engine, and bind if their own choices are resolved; any required
slot problem still prevents publication. Provider free text is not passed through.
The 0.24.4 follow-up preserves only exact fixed reasons declared by the selected
manifest (or its reviewed kernel compatibility list when absent); see the
[binding wire](2026-09-16-provider-binding-wire.md). Human CLI output also shows a
problem's existing choice key, without inventing new key/provider semantics.
Different opaque inputs need not produce different public errors if both fail the
same provider prerequisite. In particular, missing OKF host runtime settings can
hold both syntactically valid Git locators; preparation does not test whether a
remote repository exists. Required readiness checks remain later, with the provider.

### Operator input

When present, `operator` requires both `policy` (object; `{}` is valid) and
`document` (`{ "kind": "operator", "id": "setup-attempt" }`). Its ONLY optional
fields are `localBase`, `allowLocalPaths`, `sourceContext`, and `bindings`:

- `policy`: explicit provider/additive selections with their selected sources and
  settings, using the existing policy grammar. It cannot erase soul requirements.
- `localBase`: explicit absolute base for relative local policy sources. Work
  context/cwd is not a substitute.
- `allowLocalPaths`: explicit boolean authorization for those local policy sources.
  Top-level local acquisition authorization remains a separate input.
- `sourceContext`: existing qualified repository anchor for `repo:` policy sources;
  not a new repository inferred from workTarget.
- `bindings`: provider-owned map. Kernel preserves it and its document pointers;
  it does not interpret store names, Git destinations, credentials or private teams.

Selecting an inherited store does not replace required provider runtime settings.
Use the selected provider's instructions for those settings; kernel must not guess
host-owned durable paths or copy native authentication.

Repreparation after explicit approval is ordinary continuation in the selected,
now-managed deployment; do not delete its state to make fresh preflight pass.
Required hooks still run under their admitted custody with `--no-launch`; a parsed
binding or team declaration is not proof of an enrolled/ready native provider.
Native request version1 supplies backend/task/optional stopGraceMs, not a new
model or current launch selection. Complete OATS home resources remain composed.
Native auth stays native and permission bypass requires explicit user opt-in.

## Limits and focused evidence

`test/workspace-onboarding-public.test.mjs` uses current public CLI/core, actual
Git and a bounded local SSH upload-pack fixture, contract-shaped inert provider
codecs/hooks, and inert native/backend executables. It covers self-membership,
reciprocal stale observations, independent adoption, non-effect/opaque-output
boundaries, exact approval, full retained resources, source deletion/current
config poison, required-provider failure BEFORE native admission/backend effects,
and original-incarnation native dispatch plus receipt-based stopped observation.
No production provider/SDK/model/server or host installation is exercised.

Captured input/wake and public captured retirement remain explicit unsupported
boundaries; a stopped terminal observation is not permission to deliver a captured
message or retire through legacy fallback. Session-delivered messaging must retain
its required wake contract; a start-only fixture does not qualify that profile.
Non-directory placement is not supplied by inspecting a Git work target. These
limits go to their owners as precise seams, not silent requirement removal.

The user requested removal of `oats-portable-setup` and no new skills in this
increment. Fresh kernel composition no longer selects that skill; existing
retained snapshots are unchanged. This document and CLI help describe the public
adapter, not a replacement skill or a claim of completed workspace deployment.

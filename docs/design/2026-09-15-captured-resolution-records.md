# Captured resolution records — implementation boundary

This checkpoint implements versioned record-shape validation, immutable publication
and exact retained-input verification. It does **not** yet wire public preparation,
lock v3, executable approval, provider readiness, lifecycle dispatch or schedules.
The [binding retention contract](2026-09-14-artifact-retention-contract.md) remains
the authority for that subsequent consumer migration.

## Record and address

`lib/resolution-shape.mjs` is the executable wire validator. The structural schema
is `docs/captured-resolution.schema.json`, using `docs/portable.schema.json` shared
definitions; semantic and filesystem checks remain mandatory. A reference is
`{ schemaVersion: 1, id: "sha256-<64 lowercase hex>" }`. The ID hashes the complete
canonical JSON record including its final LF, with no self-ID field. Records live at:

```text
<explicit-deployment>/.agents/resolutions/<id>.json
```

They are outside instance homes and independent of today's selection lock. Each
record has these closed top-level fields:

```text
schemaVersion, capture, subject, context, artifacts, choices, bindings,
messagingChoice, resources, resourceBundles, dispatch, helpers, evidence
```

`capture` is prepared or reconstructed; partial/unknown evidence is not a complete
record. Reconstructed wire data requires evidence. The current publication API
accepts only newly prepared records: historical publication remains explicitly
migration-required until the evidence/migration verifier is implemented. This is
not a claim that old instances were reconstructed.

## Source and artifact structure

A persistent subject has a soul selection containing identity, revision, alias,
sourceArtifact, definition and projection.roots. Qualified identity and artifact
identity must agree. The definition lies inside its exported path and retained
projection. Roots are a canonically ordered set.

A Git observation carries its matching repository identity, canonical remote,
selector, exact commit and provenance. A local observation names an explicit local
source and the witnessed projection integrity. For a local working snapshot of a
Git soul it also carries the matching repository identity; it does not pretend the
local bytes are a clean Git commit. The same identity/digest can be retained while
different records preserve different observations.

A helper subject contains provider, definition and name. Its provider must be a
selected capability, and its definition belongs to that provider. Verification
requires the helper to be exported by the retained manifest and checks the retained
name and canonical AGENTS.md/CLAUDE.md alias. It is not a persistent-import shortcut.

The embedded artifact set has schemaVersion, package rows and capability rows.
Package rows carry normalized source/path, exact commit or local witness, version,
versioned payload integrity and dependencies. Dependency edges are own-key checked,
unique/canonically ordered, and traversed with a bounded iterative cycle check.
Capability rows carry their exact artifact reference and package/projection or
honest local-capability provenance. Verification checks installation-provenance
fields against these captured rows, never today's lock.

## Choices, bindings and managed resources

Choices retain value, selectedBy, constraints and considered candidates. Candidates
also retain their authority kind so replay does not guess precedence from a display
origin. The record validator replays them through the SAME pure choice resolver and
requires an identical satisfied result. It does not add a second policy algorithm.
Origins identify source/deployment/operator/record documents and JSON pointers;
source witnesses include exact revision and raw-byte document integrity.

Bindings identify a selected fundamental provider, payload contract/version,
provider-owned payload, credential references and provenance. The kernel imposes no
OKF payload model. Credential entries name environment/provider lookups, never
literal credential values. Payload classification and provider readiness remain the
provider/preparation boundary; arbitrary JSON passing this shape is not proof of
correct or non-secret service configuration.

Resources refer to a selected capability, source or explicitly selected resource
bundle and a contained path/kind. Dispatch holds exact manifest references,
per-capability/per-setting choice-key maps, a launch recipe, managed runtime-package
references, host requirements and work-target inputs. Manifests correspond exactly
to selected capability IDs; runtime/work-target references must be in the inventory.

The input verifier checks source hard capability/provider/settings requirements
against captured selections and provenance. `soul-constraints.mjs` derives these
hard facts for both preparation and verification; their equality/presence constraint
and retained-definition document/pointer must remain in the captured choices.
An equal effective value with an operator-only origin is not a substitute.

Explicit extra source resources and repo-relative package roots must be present in
the projection. A repo: package's versioned payload integrity must match that root
inside the retained source snapshot, not merely the original local pathname or a
claimed commit. Missing required source or helper inputs refuse before publication.

Launch/host structures retain their existing codec boundary. Full manifest and
launch-contract compilation belongs to the sole preparation/dispatch adapter; this
storage checkpoint is not permission to execute a merely shape-valid recipe.

## Private messaging choices are not membership

Disabled messaging has no private/wider tuple. Enabled messaging records the
selected provider, provider-resolvable human reference, matching workspace or
explicit standalone context, canonically ordered chosen wider teams and provenance.
The tuple is an intent, not a certificate or a privacy assertion. Mutable credentials,
live membership and conversation-history authorization remain outside the software
pin and require the named provider owner's qualification.

## Publication and verification

`commitCapturedResolution` validates the shape and verifies retained managed inputs,
then writes a private candidate and atomically hard-links it into the addressed
namespace without replacing an existing entry. The managed ignore is published
before payloads. Matching existing bytes are reused; damaged entries refuse without
repair. Cleanup is confined to owned staging and preserves primary failures.

`readCapturedResolution` uses a bounded, descriptor-backed read, requires canonical
bytes and the matching address, then validates shape. It checks the hash before
following references. `verifyResolutionInputs` verifies the selected trees, source
projection/canonical aliases, hard software requirements, resource kinds/containment,
manifest identity/layer/provenance and helper definitions. A helper graph has explicit
active/visited state and record/depth/edge/aggregate-byte budgets. Shared nodes and
trees are cached only within that verification operation.

No read falls back to current config, current lock, source checkout, catalog or
network. Exact-input verification does not grant executable trust, prove enrollment,
freeze external state or establish host readiness. The eventual action loader must
perform those current action-specific checks through the supported contracts.

## Evidence and following work

Focused tests cover canonical source/revision/alias structure; constraint replay;
embedded graph/ownership errors; provider opacity/credential references; immutable
A/B record resources after original-source removal and poisoned ambient config/lock;
corrupt-record refusal; and missing requirements/helpers before publication.

These are record/input tests, NOT the end-to-end old-instance/queued-job lifecycle
acceptance. The shared structural schemas and private lock/approval primitives are
implemented, but public selection-lock integration, complete source-aware preparation,
exact action dispatch, managed-runtime authorization,
provider payload qualification and explicit historical migration remain separate gates.

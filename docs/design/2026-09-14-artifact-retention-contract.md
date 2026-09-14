# Retained capability artifacts and captured resolutions

14 September 2026. Portable Souls implementation foundation, task `aweb-abiu`.

Package updates currently replace `.agents/capabilities/installed/<id>`.
Instance metadata records commands and resource paths into that mutable store.
Keeping a command string does not keep the implementation that string invokes.

This first patch adds **retention primitives only**, in
`lib/capability-artifacts.mjs`. It does not change the installer, lock schema,
instance launch, scheduler or lifecycle dispatch. Existing instances are not
protected from package updates by this patch. The following integration contract
must be reviewed before those consumers change.

## Responsibilities

- Acquisition resolves sources and materializes a package's declared resources.
- Retention publishes a verified capability tree under its exact integrity.
- Resolution selects one artifact per capability ID and records effective inputs.
- Approval authorizes the selected executable revision, independently of retention.
- Dispatch uses the captured resolution, including for retirement and queued work.

No soul, workspace, team or knowledge schema belongs in the storage primitive.
There is no new resolver or background service. The artifact includes materialized
runtime dependencies and its existing `.oats-installation.json` provenance.

## Storage API implemented in this patch

```text
<deployment>/.agents/capabilities/artifacts/
  .gitignore                         # managed file containing *
  <capability-id>/
    sha256-<full digest>/             # one retained capability tree
```

`retainCapabilityArtifact(scope, sourceDir, capabilityId, lock)` accepts a
materialized capability and its captured package/capability lock maps. It checks
the locked integrity and generated provenance before publication and verifies
the copied tree again before renaming it into place. It returns the capability
ID, integrity, canonical local directory and `retained` or `kept` status.

`verifyRetainedCapability(scope, capabilityId, lock)` verifies the exact stored
revision against the captured provenance. It does not consult the scope's current
lock, source checkout, catalog, network or approval state.

An absent scope, store or revision reports `artifact-not-found`. A present but
invalid tree/store or a digest/provenance mismatch is a different refusal. Callers
can therefore distinguish missing inputs from damaged retained state without
parsing filesystem error messages. A damaged entry is never silently repaired.

`retainedCapabilityDir(scope, capabilityId, integrity)` computes the lexical path
after checking the ID and full digest. Computing a path is not verification.

Both publication and verification reject broken or escaping symlinks. Absolute
symlinks back into the original source are rejected too: that source may later
disappear. Internal relative symlinks retain their spelling. The source directory
is copied with the package engine's catchable copy routine, not linked or moved.
File permissions are preserved; this uses the existing artifact digest format,
which hashes file bytes and symlink targets, not Unix mode bits.
At the consumer-migration boundary, introduce a versioned digest covering file
bytes, symlink targets and the three executable permission bits (`mode & 0o111`).
Keep the old format explicitly verifiable for pre-migration evidence; never
reinterpret an old digest as covering modes. Other mode bits remain outside
identity. Do not rewrite modes during retention or infer executable entrypoints
by parsing free-form command/hook strings. This format change is not implemented
by the current primitive.

An existing revision is verified and reused. A damaged existing tree is an error,
never an invitation to overwrite it. Publishing another revision leaves the first
alone. Same-filesystem staging and rename avoid partially published trees; normal
errors remove staging. Concurrent publication of an already present valid revision
may reuse it after verification. A process crash can leave dot-prefixed staging
for later explicit cleanup; it is never a selectable artifact. This is not a
power-loss durability or hostile-host isolation guarantee.

Retention creates its managed ignore before any payload. It does not change the
scope's config, current lock, approval flags or authored capability directories.
Empty store directories/ignore metadata may remain after failure. No artifact
garbage collection is implemented: conservative retention is intentional.

## Resolution and lock integration proposed next

Use a versioned per-instance resolution record, with a separate identifier from
runtime/session identity. It needs:

- Exact source soul reference and retained source revision.
- One selected artifact reference per capability ID, plus package provenance
  sufficient to verify and, where possible, restore that artifact.
- Effective non-secret configuration, default/override provenance and binding
  references, not secrets or a promise to freeze membership and credentials.
- Every managed helper, command/hook and runtime resource required for later
  dispatch. Resource references resolve against retained artifact roots.

The following contract decisions incorporate the external expert's review:

- Imported and member-repository souls produce the same record shape: upstream
  soul identity, exact retained source revision and adopter-local alias. Keep the
  canonical repository and exported path in the source reference; the local alias
  is not a global identity.
- Retain soul source artifacts separately from capability artifacts, under the
  deployment, keyed by qualified source identity and content digest. Do not encode
  a soul as a capability helper. A shared leaf module may implement the tree-copy,
  digest and publication mechanics, with different provenance validation for each
  kind. Retain all declared source resources needed after preparation, not just
  `soul.yaml` or a symlink into the author's checkout.
- Store captured resolutions independently of instance homes so queued work can
  retain a reference after its originating home is removed. Each instance and
  independent execution references its exact resolution; conservative retention
  applies to both source trees and resolution records.
- Record provenance per effective choice: a soul requirement/default, workspace
  default, import-entry adoption default or explicit operator choice. Preserve the
  hard constraints as well as the selected values.
- Record resolved non-secret provider bindings with separate credential references.
  The default knowledge provider's payload includes store-qualified read nodes and
  owned-node destinations. The kernel envelope does not require other knowledge
  providers to implement OKF's owns/reads model.
- Record the responsible human/private-team key and chosen wider-team references
  for messaging-enabled instances. These capture the choice, not immutable live
  membership or permission to read earlier conversations.
- Existing-instance migration records `reconstructed`, `partial` or `unknown`
  status with evidence and unresolved inputs. A partial or unknown record cannot
  pass for a complete captured resolution in CLI or Desktop readiness.

The scope is an explicit deployment directory. A standalone repository or an
isolated user-data deployment uses the same store and APIs; no workspace Git
repository or parent-directory discovery is required by retention.

The deployment lock records current choices for new preparation. A captured
resolution is the authority for its instance or queued work; it must not look up
an older package row by ID in today's lock and accidentally acquire a new one.
The wire schema/version is not chosen by this retention patch. Current lock
objects are inputs for verification, not an implicit new persistent lock format.

Preparation publishes all needed artifacts, then commits the complete resolution
before launching anything. A failed preparation may leave unreferenced valid
artifacts; it must not leave a selectable partial resolution. Choosing or approving
a newer artifact is a separate operation. No artifact's presence grants approval.

Independent queued work retains the resolution it will execute, even after the
originating instance or source soul has been removed. Recurring schedules must
state whether they capture a composition or explicitly prepare a new one on a
future tick; an already queued execution cannot silently advance either way.
The proposed default is to capture the composition; re-preparation on later ticks
is an explicit policy. Messaging-disabled jobs do not acquire a private team.

## Consumer migration

This is one coordinated change, not a permanent pair of resolution engines:

1. Add the explicit lock/resolution schema and store migration. Verify the current
   flat artifacts before retaining them. Do not re-fetch a moving source and
   claim those bytes reconstruct an overwritten historical revision.
2. Wire acquisition/preparation to retained artifacts. Ensure selected source
   revisions are consistent across the transaction; preserve normal trust gates.
3. Capture references for new instances and independent work. Route generated
   commands, runtime packages, capability helpers, launch/retire hooks and recovery
   through the captured resolution, including after source deletion.
4. Migrate existing instance/queued-work records only where their exact managed
   inputs can be established. Report unresolved historical inputs explicitly;
   preserve running sessions and let their owners choose the restart boundary.
5. Remove mutable-store lookups from captured consumers. Update diagnostics and
   removal behavior to retain referenced revisions. Add collection only later if
   actual storage use justifies it.

The compatibility boundary includes `core.mjs` acquisition, restoration, trust,
discovery, spawn, launch and retirement; package diagnostics and CLI paths; and
the scheduler/operation callers. Each is a consumer to check, not a reason to
create another config parser. Before integration, decide whether a small extraction
of shared artifact helpers can be kept narrow, then perform it before wiring core
consumers: `core.mjs` must not acquire a circular dependency on the retention module
that currently consumes its helpers. Keep policy and lifecycle logic out of the
shared leaf module.

## Evidence and limits

The focused tests use the real package engine to install A, retain it, update to
B and retain B. Both execute their own test payload after removing the original
source, flat install and current lock. Further tests cover idempotent retention,
digest/provenance rejection, no silent repair, contained symlinks, and Git ignores.
No model harnesses or GUI processes are started.

This proves the storage prerequisite. It does **not** yet prove a running instance
or queued job dispatches A while new work uses B. That acceptance test belongs to
the consumer migration, with executable trust and recovery exercised end to end.

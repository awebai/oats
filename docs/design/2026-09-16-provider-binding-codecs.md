# Provider-owned binding codecs — implementation boundary

This implements the accepted provider-neutral binding direction, not a new policy
engine or an OKF data model in the kernel. Current preparation deliberately returns
`provider-not-qualified`; the following handshake is the next integration step.

## One provider, three bounded commands

A fundamental capability may declare an optional versioned `binding` interface:

```json
{
  "binding": {
    "version": 1,
    "normalize": "binding-normalize",
    "bind": "binding-bind",
    "check": "binding-check"
  }
}
```

Each value names an EXISTING command in that same capability manifest. It is not a
second script/operation table. Those commands therefore already participate in
self-containment, exact executable approval and retained resource inventory.
Missing/unknown versions or references refuse. The interface belongs only to the
manifest's fundamental slot.

1. **normalize** receives already parsed source/workspace/operator inputs with their
   origins and captured effective capability settings. It emits equality/presence
   requirements and bounded candidates for its own `/bindings/<slot>/…` fields.
   It must not select capability sources or rewrite another provider's fields.
2. The kernel combines these with existing requirements/candidates through the SAME
   `resolveChoices` engine. A conflict/incomplete result is not a usable binding.
3. **bind** receives the selected field values and emits the effective, NONSECRET
   ProviderBinding envelope plus credential references. Messaging additionally emits
   the responsible-human/private/wider choice envelope. Output does not certify
   membership, authorization or privacy. It cannot change the selected software.
4. **check** receives a captured binding at the requested action boundary and checks
   mutable credentials/host/provider readiness using native facilities. It does not
   rewrite the immutable binding or silently enroll/create a replacement team.

Separating normalization from binding avoids constructing a payload before operator
choices have passed the common resolver, or letting a provider carry its own hidden
precedence implementation. The default OKF provider owns its node/store/schema rules;
an alternate provider need not contain OKF reads/owns/stateDir fields.

## Execution and custody

No codec executes merely because it was downloaded. Preparation reads current exact
artifact approval first; missing approval exposes the prospective artifact set for
explicit `oats trust --artifact-set`, not a fabricated partial resolution. Commands
run from their verified retained root with bounded JSON stdin/stdout and duration,
not imports from a current source directory. Errors handling malformed provider
output must not quote possibly sensitive raw stdout/stderr.

Preparation commands are normalization/rendering, not enrollment or lifecycle hooks.
Approved provider implementations must keep those phases free of external mutations.
Actual setup/identity/team lifecycle occurs only at its explicit later action boundary.
This is a provider contract, not a claimed filesystem/network sandbox.

Provider output is structurally validated, field ownership checked, and no complete
record is published until binding/resource/helper preparation succeeds. Credential
values are never copied into a record or notes; only supported lookup references are
retained. A check's current result is not cached as permanent authority in the record.

## Delivery status

The optional manifest field has a shared validator wired into the complete kernel
manifest loader and its public structural schema. The [wire v1](2026-09-16-provider-binding-wire.md)
now has a bounded codec and native invocation broker, exposed through core
`runCapturedProviderBinding({deployment,artifacts,capability,phase,settings,input})`.
It loads the complete retained manifest, verifies artifact/provenance, checks current
exact approval before execution, and validates/sanitizes provider output. Shared
ProviderBinding, MessagingChoice and captured-choice codecs are reused, not copied.
A native fixture proves no unapproved child runs and all phases work after source
deletion/current-config poison; that is transport evidence, not provider qualification.

Preparation now supplies frozen decoded declarations/origins to the broker, merges
provider-owned fields through the same resolver, and captures complete nonsecret
bindings only after conflicts and provenance checks pass. Missing approval/interface
or unresolved fields still expose prospective software without a fabricated record.
Operator preparation input may include a provider-owned `bindings` map alongside its
existing software `policy`; it does not introduce another precedence engine. Adoption
origin-map keys are made subtree-relative while original document pointers/spans stay
intact. A real standalone-OKF consumer probe at a pinned source commit verifies the
cross-repository payload and source-deleted, non-ready check (an absent base is not ready).

Captured action loading now runs read-only provider readiness against its exact
binding; non-ready refuses before execution and is not cached in the immutable record.
Synchronous captured CLI commands receive a private `OATS_BINDING_FILE` snapshot,
not live configuration, with owned cleanup after success/failure. A real pinned OKF
consumer fixture verifies its native snapshot loader against an initialized temporary
base after source/config deletion. That is integration evidence, not production
provider or privacy qualification.

Captured lifecycle/registration consumers and full helper policy remain unfinished.
Default-provider work remains in its own source repository. No live provider,
private-team behavior, new release or deployment was qualified here.

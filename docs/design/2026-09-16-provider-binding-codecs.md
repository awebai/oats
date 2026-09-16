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

This document fixes the concrete handshake for the next implementation increment.
The optional manifest field now has a shared validator wired into the complete
kernel manifest loader and its public structural schema. Two focused tests cover
owned command references, slot ownership and version/field refusal. The invocation
broker, default-provider adapter and real provider qualification are NOT implemented
yet. Keep the existing explicit refusal until those pieces are connected and verified.

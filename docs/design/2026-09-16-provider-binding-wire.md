# Provider binding wire v1

Concrete child/parent integration contract for [provider-owned codecs](2026-09-16-provider-binding-codecs.md).
This is a bounded JSON protocol, not a second resolver or sandbox. Source commands
must already have exact artifact approval before any phase runs.

## Transport

Invoke the manifest-owned phase command with its declared arguments, no shell and
no extra implicit flags. Write ONE UTF-8 JSON request to stdin and close stdin.
Stdout is ONE JSON response; logs belong on stderr. Maximum request/response size
is 1 MiB, depth 32, 16384 entries; execution timeout is at most 30 seconds. The
native broker may accept a shorter explicit `timeoutMs` (1–30000). Timeout terminates
only the spawned codec process with SIGKILL, not an ignorable SIGTERM; no existing
session or unrelated process is targeted. Duplicate keys,
trailing output, malformed UTF-8 and unknown envelope fields/versions refuse.
Kernel diagnostics never echo provider stdout/stderr or free-form error messages.
The command runs from its verified retained capability root. Ambient OATS/PI
instance identity is scrubbed; kernel supplies only this capability's identity,
root and effective settings. Native host facilities remain host-owned. This is
not filesystem/network isolation, and normalization/binding must not enroll,
write stores, publish knowledge or start workers.

Every request has exactly:

```json
{"schemaVersion":1,"phase":"normalize","slot":"knowledge","capability":"oats.okf","settings":{},"input":{}}
```

`phase` is normalize/bind/check; slot is knowledge/messaging/tasks. Both must match
the retained manifest. Settings are already selected and schema-validated.

Success echoes the identity fields and contains `ok:true,result:{...}`. Failure
echoes them and contains `ok:false,error:{code:"needs-configuration"}`. It has no
result. All structured responses exit 0: transport completed, while `ok` is the
semantic outcome. Nonzero exit/signal/timeout is transport failure. Allowed error/problem codes are needs-configuration, requirement-conflict,
invalid-binding, authorization-required, host-requirement-missing,
provider-unavailable and provider-not-qualified. Optional provider error/problem
`message` is permitted but never forwarded by the kernel.

Knowledge providers and harvesters follow the same separation: the
[knowledge capability boundary](2026-09-16-knowledge-capability-contract.md) keeps
models, retrieval, evidence selection, judgment and delivery in the capability.
Shared invocation/evidence/helper execution is infrastructure, not a kernel harvester.

## Normalize

`input` is `{declarations,context}`. Context is the captured workspace/standalone
context, not a cwd to inspect. Each declaration has exactly
`{kind,value,origin,origins}`:

- kind: soul/workspace/adoption/operator;
- value: the already-decoded soul declaration, workspace declaration, adoption
  object, or operator input respectively (not YAML bytes or a filename);
- origin: its root Origin1; origins: JSON-pointer map of supplied Origin1 locators.

The provider interprets only its domain. It must not reread live source/config.
Returned origins must refer to supplied document/pointer witnesses. Soul hard
constraints use soul-requirement, soul defaults use soul-default; candidates from
other inputs use workspace-default/import-adoption/operator respectively. The
kernel checks origin authority as well as its structure; a source cannot mint an
operator candidate.

Result is exactly `{requirements,candidates,model}`. Requirements/candidates use
the existing resolveChoices wire entries. Every key must be a canonical JSON
pointer strictly below `/bindings/<slot>/`. Only the kernel selects winners by
combining these with the existing plan in the SAME resolver. Model is bounded
opaque nonsecret provider data, passed unchanged into bind in this transaction.

For default OKF, source `value.knowledge` is oats.okf.locations@1 with its existing
owner/stores/reads/owns payload. A workspace `knowledge.stores[]` entry for that
contract has `payload:{bindings:{"write.default":<portable locator>,...}}`.
Adoption/operator `value.bindings` is the already-authored provider binding map.
Several workspace envelopes remain separate same-authority inputs, not a merge
that silently chooses a winner. Explicit selected settings may supply host-owned
state placement; no stateDir or publication destination is inferred from a home.
Other providers own their payload contracts; the kernel does not parse these OKF
fields. Unknown/incompatible payload contracts must be reported, not reinterpreted.

## Bind

`input` is exactly `{model,choices,context}`. Choices contains ONLY this provider's
resolved `/bindings/<slot>/...` choices, including selectedBy/constraints/considered.
Result is `{payloadContract,payloadVersion,payload,credentialRefs,provenance}` plus
`messagingChoice` ONLY for messaging. Kernel adds schemaVersion/capability to form
ProviderBinding1. Credential references use the EXISTING env or provider-reference
shapes; values, keys and tokens are never copied. Payload is opaque NONSECRET data;
providers are responsible for their domain's nonsecret validation.

Messaging must return the existing enabled MessagingChoice1 with provider-resolvable
responsible human and exact context, plus explicit wider-team consent. A populated
binding is not evidence of enrollment/privacy/readiness. Non-messaging providers
cannot set messagingChoice. Disabled messaging is represented by no messaging
provider and `{schemaVersion:1,enabled:false}`, not an invented private team.

For messaging lifecycle integration, the [capability contract boundary](2026-09-16-messaging-capability-contract.md)
assigns generic intent/invocation to the kernel and native identity/team/transport
behavior to the capability. Missing additional invocation fields need one reviewed
versioned projection, not aweb-specific kernel behavior.

## Check

`input` is `{binding,context,action,invocation?}` with no other fields. Binding is
the complete immutable ProviderBinding1. Action is the requested captured action,
not a new launch recipe. Optional `invocation` is the same bounded
CapturedInvocationContext1 projected for execution below; if present, its capability,
context and action must match this request. It is not nullable: omit it for an explicit
scope check without invocation data. Identity-dependent provider actions must refuse
missing instance context. Normalize/bind do not accept this field.
Result is exactly `{status,problems}`; status is ready/needs-configuration/
authorization-required/unavailable. Problems is an array of code + optional message
objects using the error-code set above. Ready requires an empty problems array.

Check performs provider-owned READ-ONLY mutable readiness/credential/store/member
checks through existing native/provider mechanisms. Bounded private temporary Git
staging for fetch/checkout/read is allowed with owned cleanup; accepted stores,
operator checkouts and remotes must not be mutated. It does not change binding,
initialize a base, enroll an identity, create a team, or schedule/publish work.
Unsupported/unqualified checks return non-ready. Results are evaluated at each
action boundary and never persisted as permanent authority in the resolution.
A real provider acceptance is still required; fixture success is not certification.

## Captured command invocation

The captured action loader runs the provider's check against the verified record at
each command/operation/hook load; non-ready blocks before the action. Inspection and
instruction composition do not enroll or claim readiness. Full lifecycle consumers
remain a separate integration step.

For synchronous captured CLI commands, core writes the exact ProviderBinding1 to a
fresh private invocation directory outside the home and retained artifacts. It
passes only its absolute path in `OATS_BINDING_FILE`; the selected capability's
retained root and effective settings are supplied separately. The file is owner-only
mode `0600` and removed with its owned directory after success or failure. A pre-existing
ambient snapshot variable is scrubbed. The caller must not exit before cleanup.

This is an ephemeral invocation input, never the operator's live `bindings-file`
or a durable worker pointer. A provider must distinguish absent (legacy) from
present-but-invalid (refuse, no fallback). Independent work must freeze its needed
binding/runtime data under existing durable source/attempt custody before returning;
no async worker may rely on the invocation file remaining. No credential value is
part of the ProviderBinding contract. Abrupt process death can leave private scratch;
it does not make that scratch selectable authority or justify unsafe cleanup.

### Current paired execution transport versus explicit old ingress

Current captured commands, operations and hooks with an actual selected provider binding receive BOTH `OATS_INVOCATION_CONTEXT_FILE` and `OATS_BINDING_FILE`. Generic invocation is universal; an additive/unbound capability legitimately has no binding snapshot. The supplemental source receipt is not a substitute for either input. Checks still use the existing stdin contract and optional inline invocation, not an additional file channel.

The raw namespace-command route does not nominate an instance or admit an action. Source-independent existing-run completion therefore receives `instance:null`, `intent:null` and no instance-derived prior receipt, even after source-home deletion. The [existing-run completion boundary](2026-09-16-captured-admission.md#existing-provider-run-completion-after-source-home-deletion) keeps qualified retained provider-run custody separate from a new kernel mutation grant. No helper binding or invented live source identity substitutes for that authority.

Binding/source-receipt-only fixtures represent explicitly OLD transport, not positives for the current paired reader. Missing, malformed or invalid-present current snapshots must not cause synthesized projections or silent fallback. Any deliberate old-ingress compatibility path is separately explicit and qualified against exact producer/provider pins; it does not silently upgrade old fixtures or alter the selected supplemental-input/registered-replay policy.

## Captured lifecycle registration input

The kernel also has a bounded private `OATS_SOURCE_RECEIPT_FILE` projection for a
synchronous captured lifecycle hook that explicitly selects
`inputs.sourceReceipt:{version:1}` in its retained object-form declaration. No
opt-in means no source snapshot, regardless of layer; generic invocation remains
universal. See the [selected input contract](2026-09-17-capability-helper-input-contract.md). Its exact v1 payload is the agreed
`{schemaVersion,kind,home,work,context,agent,instance,sourceIdentity,role,executionBinding,responsibleHuman,binding}`
receipt. Persistent sources require their qualified captured soul identity; helper
receipts require `sourceIdentity:null`. The context equals the durable execution
deployment, the role is the retained canonical source instructions (bounded to
128 KiB), and the provider binding contains no credential values.

The file uses the same owner-only mode `0600`, outside-home/retained-artifact custody
and normal success/failure cleanup posture as `OATS_BINDING_FILE`. The home argument
must match the receipt. Captured lifecycle hook loading preflights every applicable
retained hook, exact approval, host requirement and provider readiness before the
first lifecycle side effect, then preserves the existing hook metadata, warning,
environment and required-hook result contract. Each selected receipt is derived only for its actual binding owner, from the
verified canonical body and owned generic instance/action facts, before provider
readiness/effects. Multiple opting providers get separate same-owner snapshots;
unsolicited/contradictory explicit receipts refuse and caller extraEnv cannot
nominate snapshot paths. No knowledge-slot dependency or automatic receipt is
inferred. This supplemental input is not a generic messaging identity contract
or permission for new registration through an absent-input fallback.

## Provider-neutral captured invocation context

Captured commands, hooks and operations receive one private mode-`0600`
`OATS_INVOCATION_CONTEXT_FILE`. Read-only checks receive that same validated data in
`input.invocation` instead, NOT via a second file/environment source of authority.
This enables setup-specific admission without requiring already-completed enrollment.
The unreleased v1 payload is:

```text
{schemaVersion:1, executionBinding,
 subject: <exact captured record subject>,
 instance:null|{home,work,name,agent,incarnationId},
 intent:null|{schemaVersion:1,executionId,incarnationId,attempt},
 context, responsibleHuman, messagingChoice,
 capability, action, priorReceipt}
```

The subject is the existing closed union: `{kind:'persistent',soul: SoulSelection}`
or `{kind:'helper',provider: CapabilityArtifactRef,definition: ResourceRef,name}`.
Helpers retain their exact provider artifact and definition, not an alias-derived
identity. The shared subject/context codecs and structural schemas are reused.
Overall limits are 512 KiB, depth 32 and 16384 entries; `priorReceipt` separately has
128 KiB, depth 24 and 8192 entries. Its JSON is opaque and nullable, never credentials.

The kernel derives it from the verified record, explicit target and that capability's
current stored metadata/index before provider readiness or execution. Non-null instance
facts and any supplied prior receipt must match the captured home's owned incarnation,
record and indexed receipts; a scope action has instance:null and no invented home. A public broker check
with invocation re-verifies the referenced record and matches the entire binding,
artifact set and effective settings, not merely the request's syntactic shape.
`action` is the
existing exact loader action (`command` with capability/namespace and name, `hook`
with capability/name, or `operation` with slot/name), not a new action table.
`messagingChoice`
carries the requested private floor and explicit wider set; it is intent, never proof
of privacy/enrollment. `priorReceipt` is bounded opaque JSON owned by the selected
capability. Credential values remain outside all three snapshots. Providers must use
the exact execution/source/instance/context/human/action facts and reconcile retries
against their prior receipt; they must not infer replacements from cwd, OS user,
display name, source alias or ambient configuration.

The file uses the same owned scratch, success/failure cleanup and observed-result
preservation boundary as the binding/source snapshots. Captured hook dispatch recovers
an observed opaque provider receipt even if several nested snapshot cleanups fail,
including after a nonzero child exit. It records a required, unconfirmed cleanup
failure rather than treating the hook as clean or discarding receipt-owned effects.
This accounting is provider-neutral and does not interpret knowledge or messaging data.
Existing
`OATS_SOURCE_RECEIPT_FILE` remains a selected supplemental source-context input,
not a messaging-specific or general identity mechanism. Provider registration,
helper skipping/recursion policy and qualified existing-descriptor replay stay
provider-owned; absence alone does not identify a dependent/non-ready provider. Captured start/restart/retire and
managed launch adoption remain unfinished and cannot fall back to current source or
configuration.

This addition is an unreleased coordinated wire change: both provider validators
must accept optional `check.input.invocation` and the exact subject union before a
new compatible provider pin is used. The new incarnation/intent fields also need
coordinated successor consumers; earlier pins are not silently patched or claimed
compatible. [Captured admission](2026-09-16-captured-admission.md) records opaque fresh
incarnations and logical request IDs before effects using the existing home index.
An explicit retry reuses its ID/receipt; identical distinct requests get distinct IDs.
Composition/home/alias values are never replacement identities. Stable scheduler
execution-ID propagation and actual captured launch remain unfinished. Admission
authorizes an attempt/reconciliation, not duplicate native effects, enrollment or privacy.

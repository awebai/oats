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

## Check

`input` is exactly `{binding,context,action}`. Binding is the complete immutable
ProviderBinding1. Action is the requested captured action, not a new launch recipe.
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

## Captured lifecycle registration input

The kernel also has a bounded private `OATS_SOURCE_RECEIPT_FILE` projection for a
synchronous captured lifecycle hook. Its exact v1 payload is the agreed
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
environment and required-hook result contract. The source receipt is exposed only
to its binding owner. This establishes the hook/registration ABI; public captured
spawn/start/restart/retire adoption is still unfinished and cannot fall back to
current source or configuration.

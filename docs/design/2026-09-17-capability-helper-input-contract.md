# Capability-owned helper injection and lifecycle input contract

**Decision status: proposed exact syntax under the coordinator-approved bounded direction.** This document precedes implementation and a separately paired provider candidate. It does not change current behavior, approve these new fields for production, waive custody/launch gates, or authorize changes to a stable provider review pin. Native launch/custody work remains the priority.

Context: current captured preparation omits helper knowledge injections by slot and activation automatically supplies a source receipt to a knowledge spawn hook. These are capability policies in kernel clothing. Replace only those assumptions with explicit retained declarations, reusing [captured invocation](2026-09-16-provider-binding-wire.md), existing choices/resources/composition and the existing hook table. No knowledge store, harvester, new resolver or action registry belongs in this change.

## 1. Exact `helperInjection` syntax

One optional capability-manifest field; when present it is exactly one of:

```json
{"helperInjection":{"version":1,"mode":"inherit"}}
```

```json
{"helperInjection":{"version":1,"mode":"omit"}}
```

```json
{"helperInjection":{"version":1,"mode":"file","path":"injects/helper.md"}}
```

`version` is the integer 1. The declaration is closed: `version`/`mode` are required; only `file` requires/allows `path`. Unknown fields, versions, modes and null/false alternatives refuse. There are no helper-name patterns, conditions, settings overrides or software/provider/team selections in this declaration.

| Mode | Contribution to a helper composition selecting this capability |
| --- | --- |
| `inherit` | Its own retained `inject` contribution, under existing composition choices. Missing own injection refuses rather than inventing one. |
| `omit` | No injection from this capability; record the explicit declaration-backed omission. |
| `file` | Its own contained, normalized capability-relative regular file. It may be helper-only even if the capability has no primary `inject`. |

The field controls only `capability:<its-id>`, never kernel/work-mode/another capability's block. It is not permission to register a source, own a store, harvest, publish, delete state or edit retained resources. Existing separately authorized instruction disable/override choices cannot be silently displaced; an unsupported combination refuses instead of introducing another precedence algorithm.

For **new helper preparation**, a selected capability with an injection contribution but missing policy is unresolved (`needs-configuration`), regardless of its layer. A capability with neither a primary injection nor a helper declaration contributes nothing and needs no invented policy. Primary compositions are unchanged. Preflight all advertised helpers before publishing any helper or parent record; keep the current helper-authored software/provider-policy refusal.

### Captured witness proposal

Use the existing choice resolver with a capability-local hard equality fact:

- Choice key: `/helpers/injections/<JSON-pointer-escaped-capability-id>`.
- Value: the existing `instruction:capability:<id>` resource key, or null for omission.
- Origin: existing `kind:"source-export"`, witnessing this capability's exported instruction contribution; artifact document `{kind:"artifact",owner:<exact capability artifact>,path:"oats.json",integrity:<raw manifest bytes integrity>}`, pointer `/helperInjection`.
- Inclusion: existing block `{source:"capability:<id>",resource:<key>,choice:<choice-key>}`. The resource remains owned by the same exact capability artifact and must match its retained declared file.
- Omission: `{source:"capability:<id>",reason:"helper-policy",choice:<choice-key>}` with null value and the exact retained `omit` witness.

No new authority kind or resolver is needed. The verifier must check both directions: every new helper-policy choice/block/omission agrees with its selected manifest, and every applicable retained declaration is represented. A same-valued fabricated origin is not sufficient. Such witnesses cannot justify choices for software or other capabilities.

### Old evidence versus new publication

`helper-knowledge` remains readable/verifiable as literal old captured evidence; never rewrite its record or infer a new policy from it. The new compiler never emits it. New publication must not mint a legacy slot-derived omission to evade declaration checks; reuse of an already-present identical old record remains distinct from creating one. The precise read/verification versus new-publication guard belongs in the later codec commit and needs explicit old-record/no-new-mint counterexamples. No historical reconstruction or general migration is added.

## 2. Exact per-hook source-receipt opt-in

Extend the existing **object form of a hook**, not a parallel hook/action table:

```json
{
  "hooks": {
    "spawn": {
      "command": "<unchanged existing spawn command>",
      "required": true,
      "inputs": {
        "sourceReceipt": {"version": 1}
      }
    }
  }
}
```

The command is a placeholder for the capability's unchanged actual declaration. Existing command-string hooks still work and request no source receipt. `inputs` is an optional closed object, presently allowing only `sourceReceipt`; that value is exactly `{version:1}`. Absence/empty `inputs` means no opt-in; null/false/unsupported versions and arbitrary contract names refuse. Existing approved hook names and `required` restrictions are unchanged. An opt-in does not implement an otherwise unsupported lifecycle path.

The emitted payload is the existing **SourceReceipt1**, unchanged: schemaVersion/kind/home/work/context/agent/instance/sourceIdentity/role/executionBinding/responsibleHuman/binding. Its legacy `context` field remains the normalized execution deployment; the generic invocation separately carries the full captured workspace/standalone context. Do not silently redefine either field.

Before readiness or hook effects, an opted-in input requires:

1. An exact verified selected manifest/hook and approved executable, with version-1 opt-in read from retained bytes.
2. The current owned instance/incarnation/work custody and matching admitted action; source/subject/instance/human/context/execution-binding equality remains mandatory.
3. The opting capability's **actual selected ProviderBinding1** in its declared layer, with matching owner and versioned payload. An additive capability with no such binding cannot request this input; never borrow another provider's binding or infer one from a slot name alone.
4. The retained canonical role resource for that subject in the verified composition, including source/definition ownership and canonical alias checks. Helpers retain their helper identity semantics, not an invented persistent identity.

Derive separately for each opted-in hook owner, using the existing source-receipt validator/private snapshot wrapper beside its generic invocation and binding snapshots. Do not derive one knowledge receipt and distribute it to other providers. Generic invocation remains available without source-receipt opt-in.

If a core caller supplies an explicit receipt, require exact equality with the derived input and a matching opted-in owner; reject unsolicited or contradictory receipts before provider code. Ambient/caller-nominated snapshot files are not authority. Unselected inputs must not leak through `extraEnv`, and selected snapshots must retain same-owner/no-fallback handling. Uncertainty, cleanup failures and observed receipts continue through the existing independent custody/reporting path.

No opt-in means **no automatic SourceReceipt1**, including for a knowledge provider. This does not reinterpret old declarations as consent. Old captures remain immutable; a source-receipt-dependent provider without the new compatible declaration cannot be declared ready by fallback. This is why producer and provider changes must be coordinated rather than blanket-enabled.

## 3. Default OKF and qualification sequence

The compatible candidates must declare the actual OATS compatibility floor containing these codecs, coordinated at release; an older kernel silently ignoring new fields is not compatible. Default OKF's separate compatible candidate must explicitly declare `helperInjection:{version:1,mode:"omit"}` and add `inputs.sourceReceipt:{version:1}` only to its existing hooks that actually consume SourceReceipt1. Keep actual commands and required-hook semantics intact. Registration/helper skip/recursive-harvest prevention remain provider-owned and must still pass; omitted instruction text is not recursion prevention. Runtime Git knowledge delivery remains PR-only.

Sequence after priority custody/native-launch work:

1. Review this exact syntax/witness plan with the provider owner and coordinator; do not change the stable source-main review pin.
2. Implement shared manifest codec/schema and retained declaration verification, helper choices/composer and per-hook input opt-in together in a separate commit. Preserve legacy evidence without new slot-based omissions.
3. Pair a separately committed default OKF consumer with the exact producer. Test own-only inherit/omit/file, missing policy, cross-owner/path escape, forged/absent declaration witnesses, missing input prerequisites, multi-provider same-owner delivery and snapshot fallback attempts.
4. Re-run provider registration/helper-skip/recursion and PR-delivery safeguards on the paired pins. Fixture compatibility is not native enrollment/privacy or real helper launch. Coordinator owns final acceptance/main/production under standing when-ready authorization.

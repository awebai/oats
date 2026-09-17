# Capability-owned helper injection and lifecycle input contract

**Decision status: exact syntax/witness plan approved; shared producer implementation candidate, paired provider qualification pending.** Shared codecs, retained composition/publication checks and selected hook input delivery are implemented together and require independent review and exact provider pairing before runtime qualification. This is not production acceptance, does not waive custody/launch gates, and does not authorize changes to a stable provider/index review pin. Native launch/custody work remains the priority.

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

### Captured witness

Use the existing choice resolver with a capability-local hard equality fact:

- Choice key: `/helpers/injections/<JSON-pointer-escaped-capability-id>`.
- Value: the existing `instruction:capability:<id>` resource key, or null for omission.
- Origin: existing `kind:"source-export"`, witnessing this capability's exported instruction contribution; artifact document `{kind:"artifact",owner:<exact capability artifact>,path:"oats.json",integrity:<raw manifest bytes integrity>}`, pointer `/helperInjection`.
- Inclusion: existing block `{source:"capability:<id>",resource:<key>,choice:<choice-key>}`. The resource remains owned by the same exact capability artifact and must match its retained declared file.
- Omission: `{source:"capability:<id>",reason:"helper-policy",choice:<choice-key>}` with null value and the exact retained `omit` witness.

No new authority kind or resolver is needed. The verifier must check both directions: every new helper-policy choice/block/omission agrees with its selected manifest, and every applicable retained declaration is represented. A same-valued fabricated origin is not sufficient. Such witnesses cannot justify choices for software or other capabilities.

### Old evidence versus new publication

`helper-knowledge` remains readable/verifiable as literal old captured evidence; never rewrite its record or infer a new policy from it. The new compiler never emits it. New publication must not mint a legacy slot-derived omission to evade declaration checks; reuse of an already-present identical old record remains distinct from creating one. `verifyResolutionInputs` checks declared policy witnesses on retained inputs. `commitCapturedResolution` first permits verified identical already-present evidence reuse, then enforces the new-publication policy BEFORE creating a store/staging file for a new record. Direct callers bypassing the compiler cannot mint a legacy omission or missing-policy helper. Literal historical read/reuse and distinct new-mint refusals have explicit storage-level counterexamples. No historical reconstruction or general migration is added.

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

The captured hook runner derives separately for each opted-in hook owner, using the existing source-receipt validator/private snapshot wrapper beside its generic invocation and binding snapshots. All selected-input prerequisites are checked during static all-hook preflight, then the owned instance facts and selected receipt are compared again under the admitted projection before provider readiness/execution. Activation no longer supplies an automatic knowledge-slot receipt. Do not derive one knowledge receipt and distribute it to other providers. Generic invocation remains available without source-receipt opt-in.

If a core caller supplies an explicit receipt, require exact equality with the derived input and a matching opted-in owner; reject unsolicited or contradictory receipts before provider code. Ambient/caller-nominated snapshot files are not authority. Unselected inputs must not leak through `extraEnv`, and selected snapshots must retain same-owner/no-fallback handling. Uncertainty, cleanup failures and observed receipts continue through the existing independent custody/reporting path.

No opt-in means **no automatic SourceReceipt1**, including for a knowledge provider. Absence is not consent, but absence alone is also not generic proof of provider dependency or non-readiness. Do not infer that dependency from a capability name or layer. A deliberately registered old source may replay from its retained descriptor plus binding when its existing qualified contract allows it; NEW source registration must not acquire authority through that fallback. Old captures remain immutable. Producer/provider candidates must identify and test this compatibility/readiness distinction against exact qualified artifact/version pins, rather than claiming a universal automatic non-ready diagnosis.

## 3. Default OKF and qualification sequence

This producer candidate changes the captured preparation/dispatch paths; it does not qualify legacy config-chain lifecycle execution for these selected inputs. The compatible candidates must declare the actual OATS compatibility floor containing these codecs, coordinated at release; an older kernel or legacy route silently ignoring new fields is not compatible. Default OKF's separate compatible candidate must explicitly declare `helperInjection:{version:1,mode:"omit"}` and add `inputs.sourceReceipt:{version:1}` only to spawn/retire hooks that actually consume SourceReceipt1: preserve spawn command/required:true, retain the retire command/required semantics when converting it to an object, and do NOT opt in soul-scaffold. Keep actual commands and required-hook semantics intact. Registration/helper skip/recursive-harvest prevention remain provider-owned and must still pass; omitted instruction text is not recursion prevention. Runtime Git knowledge delivery remains PR-only.

Sequence after priority custody/native-launch work:

1. Exact syntax/witness review is complete and implementation is authorized, including the provider's binding edges; do not change the stable source-main/index review pin or wait for another milestone permission.
2. Shared producer implementation now includes manifest codec/schema, retained declaration verification, helper choices/composer, storage publication guard and per-hook input opt-in together. Preserve legacy evidence without new slot-based omissions; independent source review is still required.
3. Pair a separately committed default OKF consumer with the exact producer. Test own-only inherit/omit/file, missing policy, cross-owner/path escape, forged/absent declaration witnesses, missing input prerequisites, multi-provider same-owner delivery and snapshot fallback attempts.
4. Re-run provider registration/helper-skip/recursion and PR-delivery safeguards on the paired pins. Fixture compatibility is not native enrollment/privacy or real helper launch. Coordinator owns final acceptance/main/production under standing when-ready authorization.

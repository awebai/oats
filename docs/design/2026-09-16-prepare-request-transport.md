# Public preparation request-file transport

```
oats prepare --request <absolute-regular-json-file> [--json]
```

The JSON file is the **whole public `prepareCapturedComposition` input**—for fresh onboarding, only `buildFreshPreparationRequest(...).preparation`. It is not the onboarding result/ready-inspection wrapper, captured resolution/execution binding, private preparation scratch `directory`, or instance/work placement. No fields are filtered or inferred: the existing closed public validator rejects unknown fields.

The CLI uses `readPortableBytes` and `parseStrictJson` once, with their existing bounds: regular/no-follow descriptor read, at most 8 MiB, strict UTF-8/JSON, duplicate-key rejection, depth 64 and 100000 entries. There is no new request parser, resolver, recursive include syntax, stdin/eval mode or private scratch API. Diagnostic decoding errors identify the condition/position, not raw provider values. Requests must contain nonsecret declarations and credential references, never credential values.

`--request` is mutually exclusive with all other preparation input flags. Exclusivity and absolute-path checks precede opening the file. Explicit captured `--deployment`, `--resolution`, or `--artifact-set` selectors—including equals spelling and selectors before the command—are rejected before reading/preparing a request. Partial/malformed selectors retain the existing typed refusal.

The shared routing boundary first uses `capturedSelector(args,{})` to inspect explicit selectors without inherited authority. Prepare then handles explicit new work; even malformed inherited OATS deployment/resolution/instance variables cannot select its source or context. Other commands retain their existing explicit/inherited capture rules. No global environment reset is performed.

Existing forms remain supported:

```
oats prepare --dir ABS --source GIT --revision REF --export PATH --alias NAME [--work MODE] [--json]
oats prepare --dir ABS --workspace GIT [--workspace-revision REF] --alias NAME [--work MODE] [--json]
```

All forms share the existing result renderer. Incomplete preparation preserves problems and exact approval requests in error details. A returned resolution is not enrollment, privacy, executable approval or actual launch success.

This transport represents explicit **new-work input**, not a reusable ready-inspection permission. Fresh onboarding must still enforce its own preflight at the mutation boundary. After a first prepare writes managed state, explicit approved continuation uses ordinary public preparation; the CLI neither deletes that state nor imposes fresh-only restrictions on legitimate continuation.

Focused tests cover complete native-transport requests with provider-owned operator bindings and explicit standalone string/null contexts; exact 256-byte Unicode key preservation; poisoned inherited selectors; source/workspace flag compatibility; mixed/duplicate/relative/malformed/symlink/oversized/unknown-field refusals; and before/after-command explicit selector refusal. These are isolated fixture preparation tests, not real provider privacy or managed-runtime launch qualification.

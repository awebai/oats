# Public preparation request-file transport

## Implemented helper; CLI routing remains lifecycle-owned

`lib/portable-onboarding-request.mjs` implements:

```js
readPortablePreparationRequest({ file, inputFlags = {}, explicitSelector = null })
```

It returns the **request object itself**, decoded through existing bounded strict
JSON and frozen without adding defaults or filtering fields. The public
`prepareCapturedComposition` remains the only preparation schema validator and
resolver. The helper does not call it and performs no installation, approval,
activation, command dispatch or provider operation.

- `file` is an explicit normalized absolute path. The shared descriptor reader
  requires a regular file, uses no-follow opening and checks byte/identity changes;
  its existing 8 MiB limit applies before content allocation.
- `inputFlags` is the map of **other** prepare value flags already parsed by the
  CLI's existing per-command parser. Any own key is a conflict, even when its
  value is empty, false or null. Request/json controls do not belong in this map.
- `explicitSelector` is the existing `capturedSelector(argv, {})` result or null.
  Any non-null selector refuses. The helper neither parses global argv nor reads
  inherited resolution/instance environment as preparation authority.

Transport conflicts are rejected before opening the file. Invalid UTF-8,
duplicate decoded JSON keys, oversized/deep data and non-object roots refuse.
Read/decode diagnostics do not echo request payloads. Unknown preparation fields
survive transport so the existing closed public validator can reject them. A
private `directory` field must never be stripped to force acceptance.

Requests must contain only nonsecret declarations/settings and the selected
capability's supported credential references, never credential values. JSON shape
validation alone cannot classify arbitrary provider payloads as nonsecret; that
classification remains capability-owned. This helper adds no credential keyword
filter, provider schema or destination default.

## Minimal shared-entrypoint integration request

Proposed command (not available in pinned c5/257 CLIs):

```text
oats prepare --request <absolute-regular-json-file> [--json]
```

The file contains exactly `buildFreshPreparationRequest(...).preparation`, **not**
the outer onboarding result, private scratch, work-target wrapper or old execution
binding. Lifecycle owner should:

1. Keep existing explicit `--source` and `--workspace` forms unchanged. Add
   `request` to the existing prepare value-flag parser; retain duplicate/missing/
   unknown flag handling. Make request mode exclusive with every other source,
   deployment and override flag before file reads. Do not merge CLI values into
   request content.
2. Pass that parser's other-value map and the shared explicit-only selector result
   into the helper, then pass the full returned object to existing public prepare
   and its existing result/error renderer. No copied preparation validator or
   second config schema.
3. At the existing global routing boundary, refuse explicit captured selectors
   with prepare, before/after the command and in equals spelling. Use the shared
   selector parser, not a new onboarding argv scanner. Preserve typed refusal of
   partial/malformed selectors.
4. Ignore inherited `OATS_DEPLOYMENT`, `OATS_RESOLUTION` and old instance context
   for this explicit new-work request. Missing request values are not filled from
   them. Other captured commands retain their normal inheritance semantics.

The transport is not an installation permit or a serialized ready-inspection
token. Fresh setup must recheck managed-state boundaries before its first mutating
prepare. An explicit approval/reprepare continuation is ordinary preparation of a
now-existing deployment, not a fresh preflight bypass or permission to delete it.

## Evidence and remaining gates

Parser tests perform no installation or activation. They verify literal
string/null/boolean/list preservation, unknown-field forwarding, conflicting
transport/selector refusal before reads, inherited-authority isolation, and
bounded malformed/symlink/oversize refusals.

The pinned real public preparation consumer now reads its entire request through
this helper in workspace, keyed standalone and explicit-null contexts, then passes
it unchanged to core at `c5c6a3c9171e424a36a1bdbf3932b9319a3c6c72`. It also proves
that a private field survives transport and is rejected by real core before
acquisition. The separate actual public no-launch producer case remains pinned to
`257c4b96b67001fa2bcf38436e57106c44aa797b`.

This is helper/public-API and no-launch evidence, **not** a claim that the proposed
CLI router is installed, runtime launch is qualified, or private providers are
certified. See the [operator walkthrough](2026-09-16-fresh-operator-walkthrough.md).
No migration CLI, new installer engine, provider backend or global parser is added.

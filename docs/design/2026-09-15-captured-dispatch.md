# Captured dispatch integration

This connects the record/package/source primitives to the exact action loader.
Core exposes `loadCapturedDispatch`, and the CLI supports exact captured inspect,
approval and command invocation. Lifecycle/provider adoption and complete
preparation/migration are still in progress.

## Capture effective setting defaults, do not invent them on load

`manifest-settings.mjs` derives setting defaults from the exact selected capability
manifest bytes. Their provenance names an artifact-owned document: exact artifact
reference, manifest path, raw-byte integrity and JSON pointer to the default.
This also works for catalog/local sources without fabricating an upstream Git URL
or a self-referential resolution ID.

`manifest-default` is the intrinsic field-default candidate, below workspace, soul,
adoption and operator choices in the SAME resolver. It is not a third policy authority.
Hard requirements still constrain it. Explicit null, false and empty values survive;
overridden defaults remain considered inputs with their exact witness. The shared
schema consumes the runtime candidate/Origin enums.

Preparation must call `captureManifestSettings` with every selected manifest before
publishing the record. Every effective setting uses its canonical per-capability
choice key. Loaded records verify the retained default value and artifact/file/pointer
witness, even when overridden. Verification also checks every recorded intrinsic
candidate against those exact selected manifests, including choices absent from the
dispatch settings map; fabricated defaults are not valid considered inputs. Missing
or misdirected settings are incomplete captures, not an invitation to consult the
current manifest/configuration and fill them later.

Two focused default tests and a real retained-record regression cover priority,
nullable/false/empty/prototype-named data, complete definition coverage, original
manifest ownership and refusal of omitted witnesses/noncanonical references.

## Public captured command ABI

Builds advertise `capturedDispatchApi: 1` and their supported actions in
`oats version --json`. Both selectors are required, with an absolute deployment
and the complete `sha256-…` resolution ID; they can precede or follow the command.

```text
oats inspect --deployment /deployment --resolution sha256-… --json
oats inspect --deployment /deployment --resolution sha256-… --composition --json
oats trust example.action --deployment /deployment --resolution sha256-… --json
oats trust example.action --deployment /deployment --artifact-set sha256-… --json
oats example-action show --deployment /deployment --resolution sha256-… -- --detail
oats operation run knowledge:view --deployment /deployment --resolution sha256-… --home /instance --arg mode=full --json
```

The operation form loads the selected provider and operation declaration from the
exact record. Home-context operations additionally require the target home's stored
`executionBinding` to match the deployment/resolution pair; scope operations run in
the explicit deployment and reject a home. Both routes use current exact approval,
provider readiness, retained settings/resources and the private invocation binding
snapshot. They preserve the existing strict JSON-v1 operation receipt and unconfirmed-
effects semantics without consulting a current soul, config, lock or manifest.

The artifact-set variant approves exact prospective software BEFORE a provider codec
can complete a resolution. It requires a verified v3 artifact set, never a fabricated
partial resolution or current selected-ID lookup, and supports trust only.

The last command passes `--detail` to the capability. Tokens after `--` are never
interpreted as OATS selectors. Duplicate/partial pairs and mixed legacy context
selectors refuse. Explicit pairs replace inherited captured selectors as a whole.
Child commands receive `OATS_DEPLOYMENT`/`OATS_RESOLUTION` plus their captured settings;
invoking-agent OATS/PI identity variables are removed. Host credentials/configuration
outside those identity namespaces are not copied or reconfigured. Dispatch uses the
current absolute Node executable and the exact retained, inventoried script.

An inherited pair propagates to subsequent CLI invocations. Unsupported captured
kernel commands refuse rather than use current configuration; host `version` probing
remains available under inherited context. Existing uncaptured invocations are unchanged
pending explicit lifecycle/migration cutover. Trust is an explicit operator action;
inspect/help never execute capability code. Provider binding qualification and captured
operation CLI support are implemented; captured spawn/lifecycle CLI support is not
implied by the advertised actions.

## Implemented action-loading boundary

`loadCapturedDispatch({deployment, resolution, action})` verifies exact retained
inputs, applies core's strict full manifest loader/self-containment/compatibility
checks, and reconstructs captured settings without consulting current config.
It reads current exact-artifact approvals separately, sharing evaluation with
approval diagnostics. No provider payload code runs before approval.

Actions are inspect, compose, command (capability or namespace), operation (slot
and name), and hook (capability and event). Command/operation/hook loading requires
the exact action declaration, approved target artifact, host requirements, and an
inventoried retained executable file. Fundamental provider bindings remain blocked
until their qualification adapter is integrated; choices are not enrollment.
Unsupported actions and unverified historical reconstruction refuse, never fall back.

`dispatch.composition` records canonical soul body, ordered instruction references,
work mode, named skills, and explicit injection omission/override choices. Launch
recipes require this projection. Non-launch command records may omit it; compose
then refuses. The common formatter is shared with existing preparation, while the
captured path reads only verified retained resources. Body ownership, duplicate
sources/skill names, override references and disabled choices are checked. Complete
manifest-to-curriculum coverage and lifecycle materialization remain integration work.

The actual complete manifest codec and both applicable launch checks (recipe plus
configuration, including reserved environment/NUL rules) are supplied by core.
This static validation does not qualify launch: launch action adoption and mutable
host/provider gates are still separate work. No current lock/config/marketplace
fallback and no inferred executable permission from diagnostic booleans.

# Captured dispatch integration

This connects the record/package/source primitives to the exact action loader.
Core now exposes `loadCapturedDispatch`; public CLI/lifecycle adoption and complete
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

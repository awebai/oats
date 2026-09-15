# Captured dispatch integration

This continues the implemented record/package/source primitives toward one exact
action loader. Public dispatch and full composition/migration are not complete yet.

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
witness, even when overridden. Missing or misdirected settings are incomplete captures,
not an invitation to consult the current manifest/configuration and fill them later.

Two focused default tests and a real retained-record regression cover priority,
nullable/false/empty/prototype-named data, complete definition coverage, original
manifest ownership and refusal of omitted witnesses/noncanonical references.

## Remaining loader boundary

- Explicit captured projection must carry retained soul/kernel/resource paths,
  instruction ordering and injection-disable intent. Existing ambient composition
  and resource-discovery calls cannot run on the captured path.
- Core supplies its COMPLETE strict manifest and applicable launch validators;
  partial version/runtime checks do not replace reserved environment/NUL validation.
- The exact action/event/target determines approval, host and provider gates. Current
  approval is read separately; diagnostic booleans are not executable permission.
- Helpers use their dedicated records. Unsupported actions and unverified historical
  reconstruction refuse. No current lock, configuration or marketplace fallback.

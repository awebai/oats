## Fixed

- **Repository diagnostics no longer copy user information from selected
  references ([#1077](https://github.com/awebai/oats/issues/1077)).** Messages,
  reference-bearing details and provenance, schema problems and workspace
  `cannot-read` fields use a display constructed from recognised host and path
  components. Malformed or mixed values are withheld whole, including harmless
  text, while known declaration files and key locations remain available.
  See the [diagnostic display contract](../workspaces.md#repository-references-in-diagnostics).
  Standalone file/path meanings, command-consumed values and Git's original
  transport reference are unchanged.

- **Repository and package refusals explain an omitted reference without
  exposing it ([#1077](https://github.com/awebai/oats/issues/1077)).** The
  originating refusal explains withholding or user-information omission once;
  existing message slots keep the explanation when forwarding it. HTTP(S)
  userinfo refusals keep their specific cause and credential-helper advice,
  and package refusals keep their own reason. Admission, codes and field shapes
  are unchanged.

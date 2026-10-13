## Changed

- **Diagnostic messages, details, provenance and workspace `cannot-read` values
  now omit user information (including SSH users) or withhold the reference,
  while Git lines are shown only for unchanged original operation references
  and no literal `@` in the original line, replacing
  [#1075](https://github.com/awebai/oats/issues/1075)'s scrubbed-line behavior
  ([#1077](https://github.com/awebai/oats/issues/1077)).**

## Fixed

- **Repository diagnostics no longer copy user information from selected
  references ([#1077](https://github.com/awebai/oats/issues/1077)).** Messages,
  reference-bearing details and provenance, schema problems and workspace
  `cannot-read` fields use a display constructed from recognised host and path
  components. Malformed or mixed values are withheld whole, including harmless
  text, while known declaration files and key locations remain available.
  Git's own line is shown only when all original operation references are
  proved unchanged by display construction and the original line contains no
  `@`; otherwise the whole line becomes a fixed notice directing the operator
  to run the operation by hand. No substring is recovered. This replaces the
  quoted-line disclosure behavior shipped for unknown Git failures.
  See the [diagnostic display contract](../workspaces.md#repository-references-in-diagnostics).
  Standalone file/path meanings, command-consumed values and Git's original
  transport reference are unchanged.
  Explicit pinned-source diagnostics keep a constructed reference and its
  validated commit, or withhold the whole source. Rejected argument values use
  the contract's bounded ASCII display rule and neutral withholding notice;
  valid operational arguments are unchanged. Unknown Git failures quote only
  stderr: empty stderr adds no line unless output overflow needs a kernel budget notice.

- **Repository and package refusals explain an omitted reference without
  exposing it ([#1077](https://github.com/awebai/oats/issues/1077)).** The
  originating refusal explains withholding or user-information omission once;
  existing message slots keep the explanation when forwarding it. HTTP(S)
  userinfo refusals keep their specific cause and credential-helper advice,
  and package refusals keep their own reason. Admission, codes and field shapes
  are unchanged.

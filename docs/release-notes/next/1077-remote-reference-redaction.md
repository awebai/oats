## Changed

- **Diagnostic messages, details, provenance and workspace `cannot-read` values
  now preserve bounded plain refused values, construct displays that omit user
  information (including SSH users), or withhold the reference, while the seven
  rejected argument fields share the bounded plain rule and Git lines are shown
  only for unchanged original operation references
  and no literal `@` in the original line, replacing
  [#1075](https://github.com/awebai/oats/issues/1075)'s scrubbed-line behavior
  ([#1077](https://github.com/awebai/oats/issues/1077)).**

## Fixed

- **Repository diagnostics no longer copy user information from selected
  references ([#1077](https://github.com/awebai/oats/issues/1077)).** Messages,
  reference-bearing details and provenance, schema problems and workspace
  `cannot-read` fields use a display constructed from recognised host and path
  components, with a verbatim exception for original refused values of 1–256
  ASCII letters, digits, spaces or `._/+-:` characters. The same predicate
  serves the seven selected rejected arguments; it never trims or decodes an
  input. Malformed or mixed values outside that rule are withheld whole,
  including harmless text, while known declaration files and key locations
  remain available. Raw derived fragments qualify for the plain exception only
  through their original selected source, never from a credential-bearing source.
  Git's own line is shown only when all original operation references are
  proved unchanged by display construction and the original line contains no
  `@`; otherwise the whole line becomes a fixed notice directing the operator
  to run the operation by hand. No substring is recovered. This replaces the
  quoted-line disclosure behavior shipped for unknown Git failures.
  See the [diagnostic display contract](../workspaces.md#repository-references-in-diagnostics).
  Standalone file/path meanings, command-consumed values and Git's original
  transport reference are unchanged.
  Explicit pinned-source diagnostics keep a constructed reference and its
  validated commit, or withhold the whole source without a plain fallback.
  Rejected argument values use the contract's bounded plain-value rule and
  neutral withholding notice; valid operational arguments are unchanged. Unknown Git failures quote only
  stderr: empty stderr adds no line unless output overflow needs a kernel budget notice.

- **Repository and package refusals explain an omitted reference without
  exposing it ([#1077](https://github.com/awebai/oats/issues/1077)).** The
  originating refusal explains withholding or user-information omission once;
  existing message slots keep the explanation when forwarding it. HTTP(S)
  userinfo refusals keep their specific cause and credential-helper advice,
  and package refusals keep their own reason. Admission, codes and field shapes
  are unchanged.

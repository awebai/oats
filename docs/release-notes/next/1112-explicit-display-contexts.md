## Changed

- Direct callers of `lib/remote.mjs` must select `displayRepoRef` for
  repository-reference display or `displayDiagnosticText` for kernel-authored
  diagnostic prose; Git lines continue to use `scrubGitLine`. The implicit
  `redactUrl` export is removed without a compatibility shim. These entries
  share the existing private renderer and preserve diagnostic output and
  disclosure rules. `lib/remote.mjs` is not in the package export map; this
  migration affects internal and direct-module callers. See the
  [entry-point signatures](../implementation.md#remote-diagnostic-display).

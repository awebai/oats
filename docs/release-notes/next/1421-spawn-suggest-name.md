## Added

- **`oats spawn <soul> --preview --suggest-name` names the instance from its
  task** (feature `spawn-suggest-name`, awebai/oats#1421). The soul's own
  harness gives a few descriptive words in one call, and the preview answers
  for `--name <descriptive>-<role>`, with the same decision an apply with
  `--expect-decision` matches. The call starts no MCP server, hook, plugin or
  extension: the prompt goes on stdin, from an empty temporary directory, in
  its own process group, for at most 20 s.
  - **Supported harnesses: claude (model `haiku`) and pi (the instance's
    model)**, proven on Linux with claude 2.1.288 and pi 1.3.0
    (`scripts/naming-isolation-proof.mjs`). Claude Code's own built-in
    plugins (`cc-plugin-*@builtin`) load as they always do, `--bare`
    included; none of the user's plugins, hooks or MCP servers do.
    pi runs its own credential commands (`!command` keys and headers in
    models.json), as every pi launch does: they are its login. A claude login
    through `apiKeyHelper` is not read, so such a user gets `harness-failed`
    and a numbered name.
  - **codex is not supported yet:** a codex soul's preview is numbered, with
    `naming.reason: "unsupported-harness"`.
  - **A failure is never an error.** The preview numbers the instance as
    before and says why in `naming.reason`: `no-task`, `unsupported-harness`,
    `timeout`, `harness-failed` or `invalid-reply`.
  - Routed with `--server`, the host must advertise the feature
    ([The suggested name](../desktop-cli-api.md#the-suggested-name-feature-spawn-suggest-name)).

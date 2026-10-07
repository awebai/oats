# Unreleased: exact-home aweb development-channel confirmation

- Adds the host-only strict boolean
  `launchPromptAnswers.homes.<canonical-home>.awebDevelopmentChannel`, default
  false. No existing home is opted in automatically. Provider development mode
  is not consent. Preview reports effective policy and provenance without input.
  `workspaceTrust` is unsupported and rejected with instructions to remove it;
  folder-trust automation is separate work in [oats#712](https://github.com/awebai/oats/issues/712).
- Adds a bounded launch-only controller, checked prompt-event receipts and
  retained `E_SPAWN_INCOMPLETE` outcomes. Only this invocation's new process
  can qualify, including a reused pane after changed-PID and fresh-screen
  checks. Session input and wake delivery gain no prompt-answer authority.
  The sole accepted confirmation is the exact aweb development-channel frame
  for Claude 2.1.289 on `darwin-arm64` at 110x35, bound to the executable SHA-256
  recorded in configuration documentation. It permits one Enter. Folder-trust,
  API-key and all other prompts remain unexpected and blocked. No live rollout
  accompanies this change.
- Harness updates that change the version-bound prompt frame cause opted-in
  homes to block again with `blocked: unexpected prompt` until fixtures are
  refreshed. This fail-closed behavior is intentional: fallback keystrokes or
  broader matchers are not a remedy. `launchPrompts.receipt` identifies the
  launch-prompt event receipt; the home and pane remain available for
  inspection. A retained `launched:false` is not evidence that the process
  is absent. No prompt receipt asserts messaging receive readiness.

See [configuration](../configuration.md#exact-home-launch-prompt-consent) and
[recovery](../execution-targets.md#launch-prompt-outcomes).

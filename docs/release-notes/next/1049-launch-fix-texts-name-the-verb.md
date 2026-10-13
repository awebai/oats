## Changed

- **The `fix` of a launch refusal names `oats soul launch`, not the file**
  ([#1049](https://github.com/awebai/oats/issues/1049)). Three answers still
  told the operator to change `souls.launch` in `oats-local.yaml`, the hand
  edit that `oats soul launch set|remove` replaced: `E_HARNESS_UNAVAILABLE`
  (a harness that is not installed), `E_LAUNCH_CONFIG_UNKNOWN` as a soul's
  `launch.problem`, and `E_LAUNCH_CONFIG_AMBIGUOUS`. Their `fix` now gives the
  command, for example "install codex, or pin this soul to another launch
  (oats soul launch set <soul> --launch-config <name> | --harness <h>)", and
  where `souls.launch."*"` decided the launch it gives the command for `'*'`
  first. The message of `E_HARNESS_UNAVAILABLE` and of
  `E_LAUNCH_CONFIG_AMBIGUOUS` ends with its `fix`, so it changed with it. No
  code, no `details` field and no API version changed. A `fix` is a sentence
  for a person: its wording may change between releases, so a client shows it
  and never parses it
  ([Launch preferences](../desktop-cli-api.md#launch-preferences)). The
  function that renders the command also holds one rule for every text of a
  launch answer: none carries a character the kernel never prints, whatever
  key it is handed
  ([#1064](https://github.com/awebai/oats/issues/1064)). The schema of
  `oats-local.yaml` already admits no such key, so nothing an operator could
  reach changes.
- **A listing says that a launch would be refused, not that one was**
  ([#1049](https://github.com/awebai/oats/issues/1049)). On `oats souls` and
  `oats inspect --soul`, the `launch.problem` of a soul that
  `E_LAUNCH_PREFERENCE_UNMATCHED` reaches carried the refusal's own sentence
  ("it is refused, and nothing was created or started", then the remedy),
  about a launch nobody had asked for. Its `message` now states the
  condition and ends "it would be refused."; the remedy is its `fix`, as
  before. The refusal a spawn gets is unchanged, and so is the shape of
  `problem`.

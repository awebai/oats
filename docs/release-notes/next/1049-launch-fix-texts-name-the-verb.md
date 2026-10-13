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
  ([Launch preferences](../desktop-cli-api.md#launch-preferences)).

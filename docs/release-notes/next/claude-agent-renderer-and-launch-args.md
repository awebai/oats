## Fixed

- **Claude agent panes skip the fullscreen-renderer offer.** At spawn and
  every launch, oats.core 2.12.0 adds `"tui": "default"` to a Claude home's
  `.claude/settings.json` if no `tui` key is present. Any existing value is
  kept. Agent panes use Claude's classic renderer even where Claude now
  defaults to fullscreen, and even over a user-level `"tui": "fullscreen"`;
  this keeps tmux scrollback and the renderer used by the launch-prompt
  captures. An existing project `tui` still wins. If oats.core stops adding
  the key, existing homes keep it until respawn. See
  [oats.core](../capabilities.md#oatscore-needs-input).

## Documentation

- **Launch args guidance matches the package-probe refusal.** Any non-empty
  launch-configuration `args` is refused at spawn with
  `E_LAUNCH_PROBE_UNSUPPORTED` while an active capability requires a package
  for that harness; with oats.aweb, every Claude launch has such a requirement.
  `claude plugin list --json` cannot carry those args, and `--settings` can
  change which plugins load. The supported routes are user `settings.json`
  in the Claude config selected by `CLAUDE_CONFIG_DIR` through `env`, which
  the probe carries, or a wrapper executable. `/oats-agent-permissions` now
  teaches `permissions.defaultMode: "auto"` in that user file, replacing its
  launch-args advice. See [launch configurations](../configuration.md#launch-configurations).

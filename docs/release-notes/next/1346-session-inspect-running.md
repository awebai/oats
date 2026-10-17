## Added

- `oats session inspect --json` reports `running` on every successful result,
  advertised as `session-inspect-running`. It is the same liveness
  `oats status --json` reports for the row, read from the same observation:
  `true` for a live harness, behind a wrapper shell included, and `false` for
  a fallback shell, an absent or dead pane, a missing home or a home that never
  launched. `state` and its enum are unchanged, and a failed observation is
  still an error, never `false`. `running` is activity at the session
  endpoint, not health, readiness, busy or idle, or proof of which executable
  runs. `--server` relays the execution host's answer; an older host's answer
  has no `running`. See
  [inspect, input and attach](../execution-targets.md#inspect-input-and-attach) (#1346).
- `E_RUNTIME_AUTHORITY_MISMATCH` (instance metadata that disagrees with the
  independent session receipt, from a session command or retire) carries
  `details.fields`: which of `launched`, `tmux.session`, `tmux.window` and
  `tmux.socket` differ, never their values. A missing or invalid receipt is
  still `E_RUNTIME_ENDPOINT_UNKNOWN`, without fields, and every refusal still
  happens before any pane or process is read (#1346).

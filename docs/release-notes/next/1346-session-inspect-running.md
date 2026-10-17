## Added

- `oats session inspect --json` reports `running` on every successful result,
  advertised as `session-inspect-running`. Wherever inspect answers, it is the
  liveness `oats status --json` reports for the row, by the same rule over the
  same pane observation: `true` for a live harness, behind a wrapper shell included, and `false` for
  a fallback shell, an absent or dead pane, a missing home or a home that never
  launched. `state` and its enum are unchanged, and a failed observation is
  still an error, never `false`; that includes a tmux server that is gone,
  which status reads as `running: false` and inspect answers with
  `E_SESSION_UNAVAILABLE`. `running` is activity at the session
  endpoint, not health, readiness, busy or idle, or proof of which executable
  runs. `--server` relays the execution host's answer; an older host's answer
  has no `running`. See
  [inspect, input and attach](../execution-targets.md#inspect-input-and-attach) (#1346).
- `E_RUNTIME_AUTHORITY_MISMATCH` (instance metadata that disagrees with the
  independent session receipt, from a session command or `oats retire`) carries
  `details.fields`: which of `launched`, `tmux.session`, `tmux.window` and
  `tmux.socket` differ, never their values. A missing or invalid receipt is
  still `E_RUNTIME_ENDPOINT_UNKNOWN`, without fields, and every refusal still
  happens before any pane or process is read (#1346).

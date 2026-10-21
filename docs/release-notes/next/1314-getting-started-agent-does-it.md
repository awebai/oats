## Changed

- **The `oats-getting-started` agent does the last steps itself instead of
  handing them to the person.** A clean-machine trial of the skill showed it
  handing back work at the end. Now it adds `~/.local/bin` to the shell's
  startup file when it set a per-user npm folder. On Linux it starts OATS
  Desktop on the new deployment and opens the TUI in a terminal window,
  both when its shell reaches the desktop session. Without FUSE it uses
  `--appimage-extract-and-run`, which needs no `sudo`. On macOS it quits a
  running Desktop before installing over it. The person types only
  passwords, logins and tokens
  ([#1314](https://github.com/awebai/oats/issues/1314)).

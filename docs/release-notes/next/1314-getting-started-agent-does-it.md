## Changed

- **The `oats-getting-started` agent does more of the setup itself,
  instead of handing it to the person**
  ([#1314](https://github.com/awebai/oats/issues/1314)). A clean-machine trial of the skill
  showed it handing back work at the end. Now:
  - It adds `~/.local/bin` to the shell's startup file when it set a
    per-user npm folder.
  - It opens the GitHub device page in the browser.
  - It opens the person's terminal with the exact command in it, for each
    step that needs a password or token typed there (a `sudo` or Homebrew
    password, an aweb invite token) and for the TUI. The person types only
    the secret.
  - On Linux it starts OATS Desktop on the new deployment through the
    session manager (`systemd-run --user`), so it gets the desktop session's
    environment rather than the agent's. It checks that it is running.
  - It quits a running Desktop before installing over it.
  - Without FUSE it uses `--appimage-extract-and-run`, which needs no
    `sudo`.

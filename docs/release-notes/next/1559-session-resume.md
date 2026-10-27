## Added

- Sessions come back after a shutdown, a reboot or a crash (feature
  `session-resume`, #1559). `oats session resume` starts every instance whose
  session OATS saw alive and then lost, on every deployment in this
  computer's list, each in its
  own harness conversation (Claude `--resume`, pi `--session`) with the launch
  it recorded and a one-line resume notice as its prompt. Running instances
  are left alone; instances stopped with OATS, or whose harness ended by
  itself, stay stopped: stopping with OATS is the only way to keep an instance
  down. One sweep runs per machine (`E_RESUME_BUSY`); each loss is answered
  once, so a refused resume is not tried again, after a reboot either; and a
  home is started by sweeps at most 3 times in a boot (on Linux and macOS,
  which have a boot to count in), then reported `keeps-getting-lost` and left
  down, after a reboot too, until someone starts it.
  **An agent killed outside OATS (closed from tmux, or killed by a signal)
  comes back within 24 hours: only `oats instance stop` keeps it down.** The
  clients run it when they open, in a later change. See
  [Resume after a shutdown](../execution-targets.md#resume-after-a-shutdown).
- `oats session start --resume --home <abs>`: one home's resume. It refuses a
  launch choice (`E_BAD_ARGS`) and a home that did not lose its session
  (`E_RESUME_NOT_LOST`); with no conversation to continue it starts fresh on
  `TASK.md` and says why (`resumed: false`). Its answer and the sweep's are in
  the [Desktop CLI API](../desktop-cli-api.md#resume-a-lost-session---resume).
  A warning the sweep's starts say of the computer rather than of their
  instance (today only that harnesses get no scope of their own) is said once,
  in the sweep's own `warnings`, not in each row.
- `sessionEnd` (`lost`, `stopped`, `exited`) on `oats status --json` rows of
  launched instances that do not run.
- Only a loss OATS saw is resumed. The sweep brings back a lost instance when
  OATS saw it running (in `oats status`, OATS Desktop or `oats tui`), no
  earlier sweep has answered that loss, OATS first saw it stopped less than a
  day ago, and, if the computer did not restart in between, it stopped less
  than a day after OATS last saw it run. Any other lost instance is reported
  `not-seen-recently` and left as it is; start it by hand to bring it back.
  So an agent killed in the night comes back in the morning, and a laptop
  closed for two weeks brings back what ran when it was closed.
- A local `oats status` now records what it saw of each instance, for the
  sweep: in a private file under `~/.oats/session-resume/`, one per
  deployment. It never changes what status prints or exits with. A status
  run on another machine with `--server` records nothing on this one.

## Changed

- A start opens a fresh conversation on `TASK.md`, **except a resume**, which
  continues the instance's own last conversation. This replaces the rule that
  every start opened a new one.
- The window a spawn makes now records how its harness ended, as a start's
  window does, and a spawn records its launch's `startId`; `oats instance
  stop` records the start it ended, and records a stop of an instance that
  already reads `lost` too, signalling nothing. These files are
  kernel-private: read `sessionEnd`. Stop an instance with OATS to keep it stopped: a tmux window
  killed by hand reads as lost and comes back.

## Upgrade

- **Run `oats status` once before you restart.** After upgrading, open OATS
  Desktop or `oats tui`, or run `oats status`, once before you restart this
  computer, or nothing from before the upgrade comes back: the sweep only
  resumes what OATS saw running.
- **A boot nobody looked at.** A whole boot with no OATS read leaves that boot
  unknown: what ran in it and was lost there is not resumed.
- **One legacy gap.** An instance spawned before this release, never
  restarted since, whose harness ends by itself after the upgrade, reads
  `lost` and comes back once. Its next start records what is needed; stop it
  with OATS to keep it stopped.
- **Claude's resume-cost dialog.** On some plans Claude asks, at the first
  message of a resumed long conversation, whether to resume from a summary or
  in full. OATS sends no key: the person chooses. The resume is reported
  waiting (`resume-confirmation`), open the instance's terminal to answer.
  The dialog is recognised from Claude Code's strings and documentation, not
  from a captured screen.
- **Codex starts fresh.** A Codex instance is not resumed until a Codex resume
  is proven end to end on a signed-in host: it starts fresh on `TASK.md`
  (`resume-unproven`).
- **No recovery copy for an exited harness.** The exit marker no longer counts
  as changed home bytes at retire, so an instance whose harness ended needs no
  recovery copy because of it. Retirement baselines keep their digest version.

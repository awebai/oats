## Added

- Sessions come back after a shutdown, a reboot or a crash (feature
  `session-resume`, #1559). `oats session resume` starts every instance whose
  session was lost, on every deployment in this computer's list, each in its
  own harness conversation (Claude `--resume`, pi `--session`) with the launch
  it recorded and a one-line resume notice as its prompt. Running instances
  are left alone; instances stopped with OATS, or whose harness ended by
  itself, stay stopped. One sweep runs per machine (`E_RESUME_BUSY`); a
  refused resume is reported again, not retried, in the same boot. The
  clients run it when they open, in a later change. See
  [Resume after a shutdown](../execution-targets.md#resume-after-a-shutdown).
- `oats session start --resume --home <abs>`: one home's resume. It refuses a
  launch choice (`E_BAD_ARGS`) and a home that did not lose its session
  (`E_RESUME_NOT_LOST`); with no conversation to continue it starts fresh on
  `TASK.md` and says why (`resumed: false`). Its answer and the sweep's are in
  the [Desktop CLI API](../desktop-cli-api.md#resume-a-lost-session---resume).
- `sessionEnd` (`lost`, `stopped`, `exited`) on `oats status --json` rows of
  launched instances that do not run.
- `session.resume: auto | off` in `oats-local.yaml` opts a deployment out of
  the sweep ([configuration](../configuration.md#the-file)). OATS 0.68 and
  older refuse the key.

## Changed

- A start opens a fresh conversation on `TASK.md`, **except a resume**, which
  continues the instance's own last conversation. This replaces the rule that
  every start opened a new one.
- The window a spawn makes now records how its harness ended, as a start's
  window does, and a spawn records its launch's `startId`; `oats instance
  stop` records the start it ended. These files are kernel-private: read
  `sessionEnd`. Stop an instance with OATS to keep it stopped: a tmux window
  killed by hand reads as lost and comes back.

## Upgrade

- **One legacy gap.** An instance spawned before this release, whose harness
  ended by itself and that was never restarted since its spawn, reads `lost`
  and comes back once at the first sweep. Its next start records what is
  needed; stop it with OATS first to keep it stopped.
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

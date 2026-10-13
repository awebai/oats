## Changed

- **A launch whose harness package cannot be checked in its pane's account
  is refused, where it passed before
  ([#993](https://github.com/awebai/oats/issues/993)).** The check of a
  required harness package now runs with the `PATH`, `HOME` and harness
  folder the launch's tmux pane will have. When a server runs and one of
  those cannot be read from it, a spawn or a start whose capabilities require
  a package is refused before anything is probed or created. The case that
  passed until now: a launch configuration that declares an absolute
  `executable`, in a session whose `PATH` is cleared or cannot be read as
  data. A launch with no package requirement is not affected.
  - **What you do:** the message names the name, where it was read and what
    makes it readable. Either set that name in the launch configuration's
    `env`, or give the session or the server a value OATS can read (`tmux -L
    oats set-environment -g PATH <value>`), or start the OATS tmux server
    from your own shell.
  - **The code** is `E_RUNTIME_ENDPOINT_UNKNOWN` at `oats session start` and
    `restart`, and in a preview's `harness-packages` item. `oats spawn`
    answers it as `E_SPAWN_FAILED` with the same message, as it answers a
    missing package today
    ([#1047](https://github.com/awebai/oats/issues/1047)).
- **`oats harness trust` writes for the file launches read, and refuses when
  it cannot tell which.** Its ambient file is the one a launch with no launch
  configuration reads: the server's or the session's `CLAUDE_CONFIG_DIR` or
  `CODEX_HOME`, else the default file under their `HOME`, where it was the
  operator's own shell's before. `--plan` shows the file and what selects
  it. With no server running it is the operator's own, as before, and
  `warnings` says so. When a server runs and its environment cannot be read,
  nothing is written and the answer is `E_RUNTIME_ENDPOINT_UNKNOWN`
  (`E_CONFIG_BROKEN` when a launch configuration's target is refused as
  well).
- **The `harness-trust` item of `oats readiness` is `unknown` when no OATS
  tmux server runs** and the launch configuration does not set the harness
  folder: the file it can read is the calling process's, not known to be the
  one a launch will read, and `reason` says so. The item is optional, as
  before, and `ready` does not change with it. It is also `unknown`, with
  `file` null, when a server runs and its environment cannot be read.

## Fixed

- **The checks of a launch read the environment its pane will have, not the
  one of the process that spawns
  ([#993](https://github.com/awebai/oats/issues/993)).** A harness runs in a
  tmux pane, with the session's and the server's `HOME` and harness folder
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`). The folder-trust
  check and the harness package check read those names from the process that
  ran the spawn instead, so the two disagreed whenever that process had
  another account than the server: a spawn was refused for a package that
  the pane's account has, or passed and then launched without it; folder
  trust was reported for a file the launch never reads, and a codex launch
  trusted its home by that file. Now the lookup of the harness, the
  folder-trust check, the package check and the command its refusal names,
  the `harness-trust` item of `oats readiness`, a preview and `oats harness
  trust` read one answer: the launch configuration's `env`, else the
  session's entry, else the server's, else what the server is created with.
  - **Who sees a different answer after upgrading:** a host whose OATS tmux
    server or session holds `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or
    `PI_CODING_AGENT_DIR` (the checks now read that account, and no longer
    the shell's), and agents that spawn from a session with a folder of their
    own (their own folder is no longer the one checked: the launch's is). A
    host where the spawning process and the server have the same account sees
    the same answers.
  - **No selector is an answer.** A session or a server that sets none, or a
    session that clears it, launches with the default folder under the
    pane's `HOME`: the checks read that file, and the package check's command
    starts with no selector.
  - **Folder trust never guesses.** When the pane's environment cannot be
    read, the warning is `<harness> folder trust: the configuration file this
    launch will read could not be established (…); nothing is said about its
    trust`. Otherwise the warning names where the launch gets the file from:
    `… is not established in <file> (the CLAUDE_CONFIG_DIR of tmux session
    <name>): oats harness trust --dir <deployment>`.
  - **A preview says what it could not know.** With no server running, a
    preview, `oats readiness` and `oats harness trust` do not start one, and
    do not start your login shell. They read the launch configuration's
    value, else the calling process's, and say so, for `PATH` as well: `the
    pane's environment is not established until a spawn starts the OATS tmux
    server (none runs); read instead: this process's PATH`. A preview carries
    it in the `executable` item's `detail`, a spawn preview in `warnings`.
    The package check does not refuse on that alone.
  - **A spawn with `--no-launch`** checks against the calling process, as
    before, and the start that follows checks again on its own session. It
    now says whose values it read where it already says something: in the
    folder-trust warning and in a refusal for a missing package.
  - **A spawn judges again on the session it gets**, as the lookup already
    did: when another creator won the race to start the server, the package
    check and the folder-trust check are made on that server's account.

  [Every check of a launch reads the environment its pane will have](../execution-targets.md#the-checks-read-the-pane).

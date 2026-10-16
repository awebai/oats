## Provider updates

- **oats.framework 1.13.0, oats.setup 2.8.0: the setup expert runs the
  setup, and the person types only secrets**
  ([#1314](https://github.com/awebai/oats/issues/1314)).
  - **The setup briefing has one rule for what the person types:**
    passwords, tokens, API keys and interactive logins. It also keeps the two
    installs that capture their own shell, the host wake broker and the host
    timer (#922). Everything else the agent runs and reads back.
  - **A secret reaches its command by a route the agent never sees,** in
    this order:
    - a browser device flow the agent starts (`gh auth login --web` without
      a terminal);
    - a no-echo prompt in a split of the agent's own tmux pane, which closes
      when its command ends (while it is open, wakes and `oats session input`
      can't reach that instance);
    - the person's own terminal.

    Each route is checked with a read-only command.
  - **`/oats-git-setup` is run by the agent.** The person approves each gh
    login in the browser and chooses their name, email and passphrase
    option. The SSH key is made with no passphrase, because the kernel's ssh
    runs in batch mode; a passphrase key held in an ssh-agent is the
    alternative. The GitHub host key that was checked against its published
    fingerprint is the one recorded. Step 0 reads the global Git
    configuration's names only, and step 7's check runs as one block.
  - **`/oats-setup-expert` (new):** a workspace setup expert's first session.
    It starts from the intake that the `oats-getting-started` skill hands it,
    covers a new or an existing workspace, and ends at a first working soul.
    `/oats-onboarding` points to it.
  - **`/oats-agent-permissions` (new): Claude Code's permissions for OATS
    instances.** The setup expert writes the user settings of the Claude
    config the launches use, never the home's `.claude/settings.json`:
    - auto mode, by `permissions.defaultMode` or `--permission-mode auto` in
      a launch configuration's `args`;
    - an `autoMode` block naming what the workspace trusts;
    - narrow allow rules for the `oats` reads, `oats spawn` (with an `ask`
      rule on `--yolo`, `--server` and `--wake-*`), reading `aw` mail and
      chat, and `gh` reads.

    Retire and stop (except `--plan`), `aw` sends, `git` beyond Claude's
    built-in read-only forms, pushes, merges and the operator acts stay
    with the classifier, or an `ask` rule. The person approves the
    change. The check: no `waitingOnYou` with reason `permission` during the
    first working soul's task. Claude only; Codex and pi are named.
  - **`/oats-setup-model` explains the per-workspace setup expert,** and how
    `oats onboard` finds it from OATS 0.61.0.
  - Instruction text only; the floors are unchanged. A deployment gets it by
    pinning `oats.framework: v1.13.0` and running `oats sync`.

## Changed

- **One way in: the README's "Start here" points to the
  `oats-getting-started` skill**, which a person's own coding agent
  downloads verbatim and follows ([#1314](https://github.com/awebai/oats/issues/1314)).
  - **The skill is rewritten.** It asks one round of questions: the use case,
    the existing repositories, the knowledge tools, new or existing
    workspace, messaging, harness and deployment directory.
  - **It installs what is missing,** then OATS Desktop and the CLI at the
    same version (with the pi bridge, `@awebai/oats-pi`, when the harness is
    pi). The Desktop comes from the release asset, downloaded with
    `gh` and checked against `SHA256SUMS.txt` and its attestation; on Linux it
    installs per user and shows in the app launcher.
  - **The GitHub login** is gh's device flow, which the agent starts and the
    person approves in their browser.
  - **A new workspace** becomes a private repository holding the workspace
    file, its membership and one thin soul,
    `<workspace>-oats-setup-expert`, which holds `oats.setup` and has no
    knowledge or messaging of its own, so it spawns on any machine before
    those are set up. **An existing
    workspace** is onboarded as it is.
  - **Then** the skill spawns the setup expert with the person's answers as
    its task, and the expert does the rest (`/oats-setup-expert`,
    oats.framework 1.13.0). An existing workspace without a setup soul gets
    one first, from its owner, by pull request.
  - The Desktop is started on the new deployment, and the TUI is offered.
  - The person types only passwords and logins, and no secret passes through
    the agent.

## Documentation

- `docs/first-team.md` opens with the getting-started skill as the quick
  way; the page remains the manual path.

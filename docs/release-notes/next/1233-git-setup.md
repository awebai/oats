## Provider updates

- **oats.framework 1.12.0: oats.setup 2.7.0. A guided Git and GitHub setup
  for a person who isn't a developer**
  ([#1233](https://github.com/awebai/oats/issues/1233)).
  - **Why.** OATS reads its workspace with Git, and agents commit as the
    person who runs them, but nothing taught that person to set Git up. The
    kernel never prompts: it reads `git:` references over `https://` with
    the credential helper and runs ssh in batch mode. A host could reach
    onboarding with no GitHub credentials for Git, no known `github.com`
    host key, or commits that GitHub shows as Unverified.
  - **A new skill, `/oats-git-setup`,** walks through it on macOS and
    Linux. Each step says what to run, what you should see, and what to do
    when you see something else:
    - installing `git` and `gh`, and checking that `gh` has the flags the
      steps use;
    - one SSH key, registered on GitHub both as an authentication key and as
      a signing key, with the admin scopes removed from gh's token again
      afterwards;
    - `gh auth setup-git` for `https://` remotes, and the first `ssh -T
      git@github.com` checked against GitHub's published fingerprint;
    - the identity, with an email verified on GitHub, and SSH commit signing;
    - a DCO sign-off on every commit through a global `core.hooksPath` hook
      that still runs each repository's own hooks;
    - a check: SSH auth, a signed and signed-off commit that GitHub's API
      reports as `verified: true`, and `gh auth status`.
  - **The macOS credential helper.** On macOS, a Git process run without
    `HOME` skips `~/.gitconfig` and uses the system file, where Homebrew's
    Git sets `credential.helper osxkeychain`. That raised repeated keychain
    popups on one host. The skill leaves credentials to gh and SSH, checks
    which helper a Git without `HOME` would use, and says why it matters.
  - **`/oats-onboarding`:** card 2, which makes the first Git reads, starts
    with `/oats-git-setup` when the person's Git and GitHub setup is missing
    or unchecked. `/oats-setup-model` and
    `/oats-workspace-config` name where these facts live.
  - Instruction text and one new skill: there is no hook, command, schema or
    provider contract change, and the capability floors are unchanged
    (oats.setup `>=0.30.0`).
  - A deployment gets it by pinning `oats.framework: v1.12.0` and running
    `oats sync`. Instances already running keep the skills they were spawned
    with.

## Documentation

- [Servers](../servers.md), “Git on a macOS host”, points to `/oats-git-setup`
  for the person's whole Git and GitHub setup
  ([#1233](https://github.com/awebai/oats/issues/1233)).

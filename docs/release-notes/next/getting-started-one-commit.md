## Changed

- **A new workspace gets messaging, a team and a first developer in its first
  commit, with no pull requests and no API key.** The `oats-getting-started`
  skill asks for an aweb username in its one round of questions, writes the
  workspace with `oats.aweb`, a team `default:<username>.aweb.ai`,
  `defaultTeam` and a developer soul beside the setup expert, then signs up
  the account with `oats aweb setup --username` before the spawn. The setup
  expert commits straight to the default branch while the person is the
  workspace's only member. The skill also runs `gh auth setup-git` when gh is
  already logged in, so the first push and `oats onboard` no longer fail with
  "could not read Username". The README's Start here tells a coding agent
  exactly what to download and follow.

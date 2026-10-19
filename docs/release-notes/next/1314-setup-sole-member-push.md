## Changed

- **oats.setup: a new workspace's host takes straight pushes while the person
  is the only one with access to it.** The briefing's rule for shared files
  was "only by pull request". `/oats-workspace-config`'s "Change a shared
  file" now has two routes. A commit goes straight to the default branch only
  for the host repository of a workspace the person created, after checks
  right before the push: it belongs to their own account, not an
  organization; they are its only collaborator; and no protection or ruleset
  guards the branch. The setup expert then tells them what changed. Every
  other repository, member repositories included, takes a pull request, and a
  refused push never takes another route. The briefing, `/oats-setup-expert`,
  `/oats-package-pins`, `/oats-teams`, `/oats-automations` and
  `/oats-setup-model` follow it. It matches the setup soul that the
  `oats-getting-started` skill writes for a new workspace
  ([#1314](https://github.com/awebai/oats/issues/1314)).

## Changed

- **oats.setup: straight pushes to a repository only the person can push
  to.** The briefing's rule for shared files was "only by pull request".
  `/oats-workspace-config`'s "Change a shared file" now has two routes. A
  commit goes straight to a repository's default branch, the workspace's
  host or a member repository alike, only when checks right before the push
  show that the person alone can push to it and nothing guards the branch:
  they are its admin and its only collaborator with push access; for an
  organization's repository, an active member and its only owner; no deploy
  key can write; and no branch protection or ruleset guards the default
  branch (a plan without rulesets counts as unguarded). The setup expert then tells them what changed. Otherwise
  the change is a pull request, and a refused push never takes another
  route. The briefing, `/oats-setup-expert`, `/oats-package-pins`,
  `/oats-teams`, `/oats-automations` and `/oats-setup-model` follow it. It
  matches the setup soul that the `oats-getting-started` skill writes for a
  new workspace ([#1314](https://github.com/awebai/oats/issues/1314)).

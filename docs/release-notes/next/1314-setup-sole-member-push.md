## Changed

- **oats.setup: the setup expert pushes straight to a workspace only the
  person uses.** Its briefing's rule for shared files was "only by pull
  request". Now, in a repository only the person works in (a workspace they
  created, while they are its only member), the setup expert commits and
  pushes straight to the default branch and tells them what changed; in a
  repository others share, or where a direct push is refused, it opens a
  pull request. `/oats-setup-expert`, `/oats-package-pins` and
  `/oats-setup-model` follow the same rule. It matches the setup soul that
  the `oats-getting-started` skill writes for a new workspace
  ([#1314](https://github.com/awebai/oats/issues/1314)).

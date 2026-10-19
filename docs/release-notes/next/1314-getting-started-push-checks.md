## Changed

- **The setup soul that the `oats-getting-started` skill writes leaves when
  to push to `oats.setup`.** Its `AGENTS.md` states no push rule of its own.
  From `oats.setup` 2.8.3 (oats.framework 1.13.4), the setup expert checks
  before each push (`/oats-workspace-config`, "Change a shared file"): it
  pushes straight to the default branch only where nobody else can push and
  nothing guards that branch, and to a member repository only on the
  person's yes; otherwise it opens a pull request. An older `oats.setup`
  always opens one ([#1314](https://github.com/awebai/oats/issues/1314)).

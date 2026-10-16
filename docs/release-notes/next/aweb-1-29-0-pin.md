## Provider updates

- **oats.aweb 1.29.0: the agent status publisher.** The catalog and this
  workspace pin `oats.aweb: v1.29.0`.
  - `oats aweb health enable | status | disable | publish` publishes, once a
    minute, a signed status for every agent of the deployment to aweb:
    whether it can be reached (`yes`, `degraded`, `no` or `unknown`), why
    not, and who fixes it. It is opt-in and host-only
    (`settings.oats.aweb.health` in `oats-local.yaml`), runs in the
    deployment directory, never inside an instance, and needs aw 1.36.38 to
    publish (checked before anything is sent). `disable` clears every
    designation it made.
  - `/oats-aweb`: on macOS, `oats aweb wake install` runs from the desktop
    login, not over ssh.
  - The floors are unchanged (OATS >=0.52.0, aw >=1.36.33). A deployment
    gets it by pinning `oats.aweb: v1.29.0` and running `oats sync`; only
    new spawns use it. The provider's reference is its
    `docs/health-publisher.md`.

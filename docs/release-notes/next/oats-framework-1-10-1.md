## Provider updates

- **oats.framework 1.10.1: oats.setup 2.5.3.** Instruction text in two
  oats.setup skills; no hook, command, schema or provider contract changes,
  and the capability floors are unchanged (oats.setup `>=0.30.0`).
  - `oats-onboarding` and `oats-workspace-config` say that from OATS 0.56.0 a
    failed or unparseable Git version probe keeps the remote cache and its
    pins, as the entry under Fixed says
    ([#1074](https://github.com/awebai/oats/issues/1074)): fix the local Git
    failure and retry, without deleting the cache. A `cannot-read` is now
    fixed in the operator's Git environment, not only its Git access.
  - `oats-onboarding`'s knowledge section names oats.okf 5.1.0 and the kernel
    it needs, OATS 0.49.0 or later (the instance-event lookup after a source
    retires), as the oats.okf entry says.
  - A deployment gets it by pinning `oats.framework: v1.10.1` and running
    `oats sync`. Instances already running keep the skills they were spawned
    with; new spawns get the new ones.

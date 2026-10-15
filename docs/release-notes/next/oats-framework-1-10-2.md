## Provider updates

- **oats.framework 1.10.2: oats.core 2.6.1 and oats.setup 2.5.4.**
  Instruction text in two skills; no hook, command, schema or provider
  contract changes, and the capability floors are unchanged (oats.core
  `>=0.40.0`, oats.setup `>=0.30.0`).
  - `oats-operate` (oats.core) says that from OATS 0.57.0 `oats worktree
    remove` refuses a tree that is the work of an attached instance whose
    session is running or cannot be read (`E_CHILDREN_RUNNING`): stop that
    instance or retire it, then remove again, as the entry under Changed
    says ([#964](https://github.com/awebai/oats/issues/964)).
  - `oats-onboarding` (oats.setup) pins `oats.okf: v5.2.0` in its knowledge
    section and describes the harvest duty that oats.okf 5.2.0 gives every
    working soul: the compulsory `okf-propose` skill, `oats okf status`, and
    the soul's own opt-out, as the oats.okf entry says.
  - A deployment gets it by pinning `oats.framework: v1.10.2` and running
    `oats sync`. Instances already running keep the skills they were spawned
    with; new spawns get the new ones.

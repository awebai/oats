## Provider updates

- **oats.framework 1.10.0: oats.core 2.6.0.** One new skill and three lines
  of instruction text in oats.core; no hook, command, schema or provider
  contract changes, and the capability floors are unchanged (oats.core
  `>=0.40.0`).
  - oats.core gains the skill `/oats-token-saving` and names it in its
    briefing, as the entry under Added says
    ([#1103](https://github.com/awebai/oats/issues/1103)). The two commands
    the skill tells an instance to read before asking, `oats status` and
    `oats instance events <instance>`, exist in every kernel oats.core
    admits.
  - A deployment gets it by pinning `oats.framework: v1.10.0` and running
    `oats sync`. Instances already running keep the briefing and the skills
    they were spawned with; new spawns get the new ones.

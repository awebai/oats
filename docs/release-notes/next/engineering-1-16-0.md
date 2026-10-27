## Provider updates

- **oats.engineering 1.16.0: who sets the "same work" flag.** The catalog and
  this workspace pin `oats.engineering: v1.16.0`; the floor is unchanged.
  - An expert spawns its developers with `--same-work`
    (`/coordinate-developers`), a developer its reviewer
    (`/run-the-review-loop`), and a lead expert the domain experts it spawns
    as its children for its effort (`/coordinate-experts`).
  - A maintainer launches its leads without it (`/launch-work`): each effort
    is the lead's own. An expert spawned `--relation unrelated` gets no flag.
  - The skills use the flag, and `oats instance same-work`, only on a kernel
    whose `oats version --json` lists `instance-same-work` (OATS 0.69.2 and
    later); on an older one the spawn leaves it out.
- **Upgrade:** `oats sync` locks it. New spawns get it, and a stopped home
  moves to it with `oats instance upgrade`. On OATS 0.69.2 or later, an expert
  marks a developer it started before with
  `oats instance same-work <developer> on`.

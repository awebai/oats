## Provider updates

- **oats.framework 1.16.1: oats.core 2.9.0 and oats.setup 2.9.3.** oats.core
  carries three changes:
  - its shorter "You run on OATS" inject (#1580);
  - the needs-input rule for a child whose human talks to its parent: the
    child asks its parent, which sets its own claim naming the child and
    relays the answer (#1580);
  - the skill lines for background instances (#1579). `oats-operate` shows
    `oats spawn … --background`, and `oats-souls` shows a soul's
    `background: true`. Both name OATS 0.69.2, the release that adds them,
    and say an earlier kernel refuses the key and the flags.

  oats.setup's `/oats-onboarding` pins `oats.okf: v5.5.0` in its knowledge
  section (text only). 1.16.0 carried the oats.core changes alone; 1.16.1
  adds the onboarding pin. The floors are unchanged, and the other
  capabilities are unchanged.
- **Upgrade:** `oats sync` locks it once the workspace or the catalog pins
  `oats.framework: v1.16.1`. New spawns get it, and a stopped home moves with
  `oats instance upgrade`, from OATS 0.68.0.

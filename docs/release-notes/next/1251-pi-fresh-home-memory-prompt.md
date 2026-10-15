## Fixed

- **pi: a freshly spawned home no longer starts by "continuing" from an empty
  `STATE.md`**
  ([#1251](https://github.com/awebai/oats/issues/1251)). At session start the
  `@awebai/oats-pi` bridge sends the nudge "Read ./STATE.md … then continue
  from STATE.md's Next section". It held the nudge back only when `STATE.md`
  still held template text that no package writes any more, so every fresh
  home got it, ahead of its opening task. The bridge now records a home's
  first pi session in `<home>/.oats-pi-started`: the first startup gets no
  nudge, and every later startup does when `STATE.md` exists, whatever a
  knowledge capability seeded into it. A home that worked before this release
  has no record yet, so its first restart after you update the bridge gets no
  nudge; its opening task still arrives. Update the bridge to get the fix
  (`pi install npm:@awebai/oats-pi`); the kernel alone doesn't change it.

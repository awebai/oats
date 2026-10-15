## Fixed

- **pi: a freshly spawned home no longer starts by "continuing" from an empty
  `STATE.md`**
  ([#1251](https://github.com/awebai/oats/issues/1251)). At session start the
  `@awebai/oats-pi` bridge sends the nudge "Read ./STATE.md … then continue
  from STATE.md's Next section". It held the nudge back only while `STATE.md`
  still held template text that no package writes any more, so every fresh
  home got it, ahead of its opening task. A startup now gets the nudge only
  when pi kept an earlier session of the home (pi keeps one once it holds a
  message) and
  `STATE.md` exists, whatever a knowledge capability seeded into it. Sessions
  of an earlier instance with the same name, at the same path, don't count.
  The bridge writes nothing in the home to tell. Run `oats update` to move
  the bridge in your pi folders to this release (by hand: see
  [Upgrading](../upgrading.md)); the kernel alone doesn't change it.

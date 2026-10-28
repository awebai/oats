## Provider updates

- **oats.engineering 1.17.0: finished instances retire automatically, and an
  overrun maintainer gets an overflow seat.** The catalog and this workspace
  pin `oats.engineering: v1.17.0`. The floor is unchanged.
  - **Automatic retirement** (oats-engineering#28). An instance is finished
    when three things hold:
    - its PRs are merged and green, or closed (handed back is not landed);
    - nothing waits on it;
    - its final harvest is launched.

    It then sends its parent a done line, and its parent retires it after
    checking that the work tree is clean and pushed and that nothing is
    attached, without asking or telling a human. A developer retires its
    reviewer, an expert its developers, a maintainer the leads it spawned. An
    instance with no OATS parent retires itself. Maintainers are standing
    seats and are never retired this way.
  - **Overflow seat** (oats-engineering#29). A maintainer with more than 5
    efforts of its own in flight spawns one overflow seat as its child. The
    seat drives the new intake up to hand-back. It holds no entry on the lane
    map, and merges, second reads and sign-offs stay with its parent.
- **Upgrade:** `oats sync` locks it. New spawns get it, and a stopped home
  moves to it with `oats instance upgrade`.

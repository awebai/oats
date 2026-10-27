## Provider updates

- **oats.framework 1.15.1: oats.setup 2.9.2.** oats.setup's inject follows
  the split-window fix (#1569). While an instance's no-echo prompt pane is
  open, OATS 0.69.0 and later keep reaching the instance's own pane, so wakes
  and `oats session input` still arrive, and status reads it as before. The
  inject names that version and says what an earlier OATS does instead. The
  floors are unchanged, and the other three capabilities are unchanged.
- **Upgrade:** `oats sync` locks it once the workspace or the catalog pins
  `oats.framework: v1.15.1`. New spawns get it, and a stopped home moves with
  `oats instance upgrade`, from OATS 0.68.0.

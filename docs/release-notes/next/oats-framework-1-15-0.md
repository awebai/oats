## Provider updates

- **oats.framework 1.15.0: oats.core 2.8.0.** oats.core's floor
  (`compatibility.oats`) rises from 0.40.0 to 0.49.0. The other three
  capabilities are unchanged.
  - **`oats instance upgrade` moves a home's oats.framework.** oats.core
    declares a non-required `upgrade` hook
    ([#1549](https://github.com/awebai/oats/issues/1549)), so a
    stopped home is upgraded in place instead of refused with "respawn". A
    kernel before 0.49.0 would drop a capability that declares a hook event it
    does not know, so oats.core now refuses such a kernel with the kernel's own
    compatibility message. Only OATS 0.68.0 and later run the hook.
  - **A waiting question carries its text**
    ([#1502](https://github.com/awebai/oats/issues/1502)). oats.core's Claude Code
    emitter puts the prompt's own words on its needs-input claim: the
    question, or Claude's "needs your permission to use <tool>". A claim with
    text is shown over one without. `/oats-operate` says so, from oats.core
    2.8.0.
- **Upgrade:** `oats sync` locks it once the workspace or the catalog pins
  `oats.framework: v1.15.0`. New spawns get it; a stopped home moves with
  `oats instance upgrade`, from OATS 0.68.0. Every host that shares the
  workspace runs OATS 0.49.0 or later first.

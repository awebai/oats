## Fixed

- **A question to the person is no longer hidden by a later claim with no
  text** ([#1502](https://github.com/awebai/oats/issues/1502)). On merak the
  steward's yes/no question sat unseen for 2.5 days: a later `oats.core`
  permission claim with `message: null` replaced it in `waitingOnYou`.
  - `waitingOnYou` in `oats status`, `oats session inspect` and
    `oats instance events` now shows the newest claim that has a message. A
    text-less claim only fills in the reason when the shown claim has none.
    With no message anywhere, the newest claim is shown, as before.
  - **oats.core 2.8.0: Claude Code's waiting claims carry the prompt's
    text.** An `AskUserQuestion` gives the question's own words. A permission
    prompt gives Claude's "Claude needs your permission to use <tool>". See
    [the Claude Code emitter](../capabilities.md). It reaches deployments
    with the next oats.framework release.

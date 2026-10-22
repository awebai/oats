## Provider updates

- **oats.framework 1.14.0: oats.core 2.7.0, oats.setup 2.9.0.** Text only:
  neither floor (`compatibility.oats`) changes.
  - **`/oats-upgrade` reaches deployments.** oats.setup carries the skill
    for "upgrade OATS" and "update to the latest": it reads the upgrade page
    and release notes at the latest release's tag, not the installed copy,
    and the setup inject lists it. `/oats-setup-model` points at it for an
    upgrade ([#1440](https://github.com/awebai/oats/issues/1440)).
  - **`/oats-operate` teaches moving a stopped home's package modules.** A
    new section covers `oats instance upgrade`: stop, plan, apply with the
    plan's revision and an idempotency key, then start; a partial move that
    must finish forward; and `--undo` for the latest move. Its lines name
    their version, "from OATS 0.68.0"
    ([#1450](https://github.com/awebai/oats/issues/1450)).
  - **`/oats-operate` on a half-done `oats worktree remove`.** From OATS
    0.68.0, `remove` finishes a deletion Git left half done on read-only
    ignored output, and checks an unregistered residue against its branch
    before removing it ([#1451](https://github.com/awebai/oats/issues/1451)).

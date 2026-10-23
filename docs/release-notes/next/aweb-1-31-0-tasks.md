## Provider updates

- **oats.aweb 1.31.0: an official aweb provider for the tasks slot.** The
  catalog and this workspace pin `oats.aweb: v1.31.0`. The package now ships
  `oats.aweb-tasks` (`layer: tasks`) beside `oats.aweb` (messaging), and the
  catalog aliases `oats.aweb-tasks` to it.
  - A workspace selects it with
    `defaults.tasks: { oats.aweb-tasks: { from: package } }` (or a soul's
    `capabilities:`). Tasks use the instance's own oats.aweb identity in its
    default team: the `/aweb-tasks` skill covers finding work, claims,
    assignment, status, dependencies as blockers, handoff and epics through
    `aw task` and `aw work`, with every prose field read from a file.
  - The oats.aweb messaging instructions now point task state at the
    selected tasks layer; `aw lock` and `aw roles` stay outside OATS.
  - Readiness has no tasks-slot item for this provider. Its spawn hook adds a
    fixed brief line and makes no aw calls.
  - The floors are unchanged (OATS >=0.52.0, aw >=1.36.33). A pinned
    `oats.aweb: v1.31.0` selects `oats.aweb-tasks` on older CLIs too, without
    this alias (verified on 0.67.1). A deployment gets it by pinning the
    version and running `oats sync`; only new spawns use it.

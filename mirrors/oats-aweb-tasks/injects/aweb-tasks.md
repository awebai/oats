## Tasks: aweb

This workspace tracks work in aweb tasks, and its agents use them.

Your tasks layer is `oats.aweb-tasks`. Load `/aweb-tasks` before finding,
claiming, updating or handing off work. Run its commands from your instance home,
using your own oats.aweb identity in the tasks team: the default team, or the
team your TASK.md names (Tasks team, below); joined teams use their explicit
identity home. If you have no oats.aweb identity, ask your human rather
than creating one. The human is an assignee like any other team member: resolve
their alias from the roster, never guess it. Tasks are not messages: task
state belongs here, not in mail, and conversation belongs to the deployment's
messaging layer. `aw lock` and `aw roles` stay outside OATS.

**Tasks team.** If your TASK.md's Tasks line names a team, your tasks live in
that team, never in your default team. From your instance home, run
`oats aweb teams --json`. If its `defaultTeam.label` is that label, plain
`aw task` is right. Otherwise run every task and work command as
`aw --identity-home <identityHome> task|work …`, where `<identityHome>` is
`joined[].identityHome` for that label. If it is not joined, report it to your
human and stop: never fall back to the default team.

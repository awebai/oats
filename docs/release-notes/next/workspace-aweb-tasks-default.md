## Upgrade

- **The OATS development workspace's existing homes keep no tasks layer until they are respawned.** `oats instance upgrade` moves only the package modules a home already recorded, so it never adds `oats.aweb-tasks` to a home spawned without it. A home gets aweb tasks when it is respawned. The `oats.aweb` pin does not change and the lock already lists `oats.aweb-tasks`, so `oats sync` is not needed for this. Adopters' workspaces are not affected.

## Changed

- **The OATS development workspace gives its souls aweb tasks.** `oats-workspace.yaml` sets `defaults.tasks: { oats.aweb-tasks: { from: package } }` in place of `tasks: none`, from the pinned `oats.aweb: v1.33.1`. Agents spawned in it get the `oats.aweb-tasks` inject and the `/aweb-tasks` skill. They find, claim, assign and hand off work as aweb tasks, as their oats.aweb identity in its default team. GitHub issues and pull requests stay the record. A soul opts out with `tasks: none` in its `soul.yaml` ([Official providers](../integrations.md#official-providers)).
  - `oats-public-expert` opts out with `tasks: none`. Its session grant carries no `coord.*` scopes, so aweb refuses every task read and write it would make.

## Documentation

- **A seat that cannot join teams has only its default team.** [A soul's default team and its teams](../workspaces.md#a-souls-default-team-and-its-teams) now says so. An example is oats.aweb's GLOBAL mode, which acts through one session grant. For such a seat, a `souls:` default in the workspace file decides its one team, ahead of a deployment's local `defaultTeam`, and a deployment-local team is out of its reach. Providers receive the live default at every start, so a provider that picks its team again at start moves such a seat when the default changes.

## Changed

- **Desktop: an instance's card on the Deployments page has two buttons.**
  Clicking an instance shows what it reports, as before, and two buttons:
  - **Go to instance** opens the instance's terminal tab. For a stopped
    instance, which has no terminal, it reads **Start…** and opens the Start
    dialog. Double-click, Enter and `T` do the same.
  - **Go to soul** opens the soul the instance was spawned from on the
    Workspace page: that exact soul, never another of the same name. When it
    can't be told exactly, the button is disabled and says why, for example
    when the soul is no longer among the deployment's souls, or the instance
    is on a deployment other than the one the Workspace page shows.

  The card's Git, Restart with…, Brain and Workspace buttons are gone, and so
  is the `B` key there, which only said Brain was unavailable. Restart with…
  is in the instance's menu and its panel, Git on the panel's Developer page,
  and Workspace in the rail and on `S`
  ([desktop.md](../desktop.md),
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md)).

## Changed

- **Desktop: Deployments is now Machines, a tab of the Workspace page.**
  The sidebar's views are **Workspace overview** and **Automations**. The
  Workspace page's tabs are Souls, Capabilities, Teams, **Machines** and
  Setup. Machines says once what a machine is: each machine runs the
  workspace in a folder of its own, and the instances under a machine run on
  it. Each machine's tree has "Instances on this
  machine" (or on the named machine) under its name. ⌘1 / Ctrl+1, the
  palette's **View: Workspace › Machines** and every link that opened
  Deployments open it there. A window opens on the Workspace page at launch
  and after you choose a workspace. The Setup tab's machines box is now called
  **Registered machines**.
- **Desktop: the instance rows show the soul and the repository.** The line
  under an instance's name is its soul at the left and its repository at the
  right. The branch and the pull request are in the row's hover card.
- **Desktop: the sidebar's foot.** One bar: the OATS mark at its left with the
  sidebar toggle after it, and **Spawn instance** (its words alone, a ground
  only on hover) and a
  settings cog at its right. Spawn instance opens Quick Open (⌘P on macOS,
  Alt+P on Linux and Windows), where you pick the soul. The cog's menu holds **Theme…** and **Keyboard
  shortcuts…**. The logo in the heading, and the Settings, theme, shortcuts
  and command-palette buttons, are gone. Connections is in the palette
  (**Settings: Connections…**), and the palette is on ⌘K on macOS, Alt+K on
  Linux and Windows, and Ctrl+X then `k`.
- **Desktop: the sidebar's lines.** A line sets the list of workspaces apart
  from the views, and another the views from the instances. There is no line
  under the Workspace heading, and the list of workspaces sits closer under
  it, its rows a little closer together.
- **Desktop: the instances have no filter field.** To find an instance by
  name, type it in the command palette. ⌘F / Alt+F, renamed **Focus the
  instance roster** and still rebindable under its old id, goes to the
  roster's current row. On an empty roster it goes to **Spawn instance**, as
  F6 does. The TUI keeps its filter.
- **Desktop: Workspace › Capabilities in two parts.** **Workspace defaults**
  comes first, then **All capabilities**, each with its title. The segments
  that jump to Workspace owned, Repo owned and Packages sit under the All
  capabilities title, and there is no Defaults segment.
- **Desktop: the Workspace pages name no deployment.** The "On This Mac ·
  ~/…" line is gone from every Workspace tab, from Automations, and from a
  capability's, a team's and a soul's page. They read the same deployment as
  before; the side panel and the Machines tab still say which.
- **The list of workspaces, polished.**
  - Desktop: its heading reads **Workspace**. Every row has the circle an
    instance row has; the current workspace's is filled and its name bold,
    so it no longer looks like the current view.
  - Desktop: a workspace whose instance needs input shows an exclamation mark
    at the row's right end. "N more below" shows it too when a workspace cut
    off below waits. An instance's **Needs input** pill leads with the same
    mark.
  - Desktop: the Add local workspace dialog is named as its button and counts
    only what can be added. It lists the folders that can't be opened under
    their own heading.
  - TUI: at either end of the list, Ctrl+X ↑ / ↓ keep the focus in the list,
    and the "No workspace above / below" line moves nothing.
  - TUI: `+N` carries the dot when a workspace it hides needs input.

  ([desktop.md](../desktop.md), [TUI](../tui.md))

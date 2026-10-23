## Changed

- **Desktop: a simpler sidebar.** Top to bottom:
  - **Workspaces**, a plain heading with **+** and the list right under it;
  - a thin line, then **Instances**;
  - at the foot, **Deployments** and **Workspace** side by side, then the
    sidebar, theme and shortcuts buttons and a small **Spawn instance**.

  The logo, the Settings button and the palette button are gone: Settings is
  in the palette ("Settings: Connections…"), and the palette is on ⌘K / its
  chord and Ctrl+X then `k`. The two headings are the sidebar's top level,
  larger and heavier than the machine labels ("THIS MAC") under Instances.
  Instance clusters no longer have a gap after them: a cluster's last
  instance and the next one are as close as any two instances.
- **Desktop: the instances have no filter field.** To find an instance by
  name, type it in the command palette. ⌘F / Alt+F, renamed **Focus the
  instance roster** and still rebindable under its old id, goes to the
  roster's current row. The TUI keeps its filter.
- **Desktop: Automations is a tab of the Workspace page**, after Souls and
  Capabilities. ⌘3 / Ctrl+3, the palette and every link to Automations open
  it there.
- **The list of workspaces, polished.**
  - Desktop: every row has the circle an instance row has; the current
    workspace's is filled and its name bold, so it no longer looks like the
    current view. The needs-input dot sits at the row's right end, and on
    "N more below" when a workspace cut off below waits.
  - Desktop: the Add local workspace dialog is named as its button, counts
    only what can be added, and lists the folders that can't be opened under
    their own heading.
  - TUI: at either end of the list, Ctrl+X ↑ / ↓ keep the focus in the list,
    and the "No workspace above / below" line moves nothing.
  - TUI: `+N` carries the dot when a workspace it hides needs input.

  ([desktop.md](../desktop.md), [TUI](../tui.md))

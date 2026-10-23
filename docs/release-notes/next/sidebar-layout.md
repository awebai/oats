## Changed

- **Desktop: a simpler sidebar.** Top to bottom:
  - **Workspaces**, a plain heading with **+** and the list right under it,
    the names a little larger;
  - a thin line, then the current workspace: **Workspace** and
    **Deployments** side by side, then **Instances**, with **Spawn
    instance** as the **+** at the end of its heading;
  - a bottom bar: the OATS mark at its left, the sidebar toggle and a
    settings cog at its right; the cog's menu holds **Theme…** and
    **Keyboard shortcuts…**.

  The headings' **+** buttons, the workspaces' needs-input marks and the
  instances' harness marks line up in one column on the right. The logo in
  the heading, the palette button and the row of buttons at the foot are
  gone: Connections is in the palette ("Settings: Connections…"), and the
  palette is on ⌘K / its chord and Ctrl+X then `k`. The two headings are the sidebar's top level,
  larger and heavier than the machine labels ("THIS MAC") under Instances.
  The gap after an instance cluster is smaller, and a parent is as close
  to its first child as any two instances.
  A workspace whose instance needs input shows an exclamation mark at the
  end of its row, and the instance's own **Needs input** pill leads with
  the same mark.
- **Desktop: a window opens on the Workspace page**, at launch and after you
  choose a workspace, rather than on Deployments.
- **Desktop: what a deployment is.** The Deployments page has a round **i**
  after its tabs, **What is a deployment?**, that explains it in plain words.
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

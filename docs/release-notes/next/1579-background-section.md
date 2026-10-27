## Added

- **Desktop and TUI: background instances are listed apart, under one
  closed Background heading** ([#1579](https://github.com/awebai/oats/issues/1579)).
  - An instance whose `background` is on (`oats instance background`, or
    a soul's `background: true` at spawn) leaves the main tree, and so do
    the instances below it. They are listed under a **Background** heading
    at the end of the sidebar's list, with how many there are. The heading
    starts closed in every new Desktop window and TUI session.
  - Inside, the rows form their own tree, with the machine headings of a
    workspace of two or more machines. No line joins the section to the main
    tree.
  - While a background instance waits on you, the heading says **Needs
    input**, open or closed, and the workspace's mark counts it.
  - The command palette still lists every instance. The previous and next
    instance keys pass over a closed section, and opening an instance's tab
    leaves the section as it was.
  - Desktop: the **Spawn** dialog's **Run in background** switch starts
    from the soul's default, and a row's context menu offers **Move to
    background** and **Move out of background**.
  - It needs OATS with the `instance-background` feature, on the server too
    for a server's instance. With an older OATS nothing changes. See
    [Background instances](../desktop.md#background-instances) and
    [the TUI's list](../tui.md#what-it-shows).

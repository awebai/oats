## Added

- **`oats tui` lists the open workspace's capabilities**
  ([#855](https://github.com/awebai/oats/issues/855)). `3`, or the leader
  then `3`, shows the Capabilities view, which until now was a placeholder:
  the capabilities in the OATS Desktop's sections (Workspace owned, Repo
  owned, Packages), grouped by repository or package, each with its layer.
  The detail beside it says what the capability is, where it comes from,
  the skills, commands and hooks it provides, and the souls that use it,
  each with how many of its instances here carry it and how many of those
  are on an older version. In the detail, `Up`/`Down` mark a soul and
  `Enter` shows it in the Souls view. The list is the Desktop's, read with
  `oats capabilities` only once the view is first shown, and again only
  when the workspace changes, or with `r`. The palette lists the
  capabilities once they are read. See
  [the TUI page](../tui.md#the-capabilities-view).

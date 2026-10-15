## Added

- **`oats tui` lists the open workspace's souls**
  ([#855](https://github.com/awebai/oats/issues/855)). `2`, or the leader
  then `2`, shows the Souls view: one row per soul with its colour, a count
  of its instances on this machine, and `!` for a soul a spawn here would
  refuse. The detail beside it says where the soul comes from and where it
  works, which harness a spawn would use, its teams, its capabilities and
  its instances here. `i` (or `Enter` in the detail) shows those instances
  in the Instances view, filtered by that soul; `Esc` clears the filter.
  The list is the OATS Desktop's, read with `oats souls` only once the view
  is first shown, and again only when the workspace changes, or with `r`.
  The palette lists the souls once they are read. `tui.json` has a new
  action, `soul-instances` (default `i`). See
  [the TUI page](../tui.md#the-souls-view).

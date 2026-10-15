## Added

- **`oats tui` splits its panel in two groups**
  ([#855](https://github.com/awebai/oats/issues/855)). The leader then `|`
  splits it side by side, and the leader then `-` one above the other (`|`
  and `-` alone in the Instances view). The open tabs stay in the first
  group; the second starts empty, says `Enter on an agent opens it here`,
  and an agent opened then opens in it. Each group has its own strip and
  shown tab, both shown tabs are drawn, and a rule separates them. The
  leader then `Tab` goes to the other group, the leader then `m` moves the
  shown tab there, and the leader then `x` closes an empty group; closing a
  group's last tab gives the other the whole panel. Each group needs 40
  columns side by side or 8 rows one above the other, and the four tabs
  are counted across both. `tui.json` has five new actions: `split-right`
  (default `|`), `split-down` (`-`), and `group-next`, `tab-move` and
  `group-close`, which have no key of their own by default. See
  [the TUI page](../tui.md#splits).

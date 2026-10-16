## Fixed

- **`oats tui`: a package soul's instances are its own in the Souls view**
  ([#855](https://github.com/awebai/oats/issues/855)). In 0.59.0 the Souls
  view counted no instances for a soul that comes from a package, and `i`
  on it listed none: the view did not match the name its instances carry,
  `<package>--<soul>`. Its row now counts its instances on this machine,
  `i` lists them in the Instances view, and its detail names them. See
  [the TUI page](../tui.md#the-souls-view).

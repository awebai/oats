## Fixed

- **`oats tui` names a sibling at both ends of the link, and its palette
  names siblings** ([#1315](https://github.com/awebai/oats/issues/1315)).
  The detail's parent line named a sibling only on the instance that
  declared the link, and named it as written, even when no instance had
  that name or two had it. Now both ends say `sibling of <names>`, as the
  Desktop does, and a name that resolves to no instance, or to more than
  one, is not shown. The palette shows the same words, dim, after an
  instance's name; a query never matches them. See
  [the TUI page](../tui.md#the-palette).

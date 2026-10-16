## Fixed

- **`r` in the `oats tui` Souls view keeps the souls when the read fails**
  ([#1301](https://github.com/awebai/oats/issues/1301)). In 0.59.0, `r`
  forgot the souls before reading them again, so a read that failed left
  only the failure. Now the souls stay listed while `r` reads, and a read
  that fails keeps them under a heading that says it failed, as the
  Capabilities view does. See [the TUI page](../tui.md#the-souls-view).

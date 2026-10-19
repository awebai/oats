## Changed

- **The `oats-getting-started` skill suggests no deployment directory.** It
  asks for `D` and no longer suggests `~/Agents/<workspace>`: from this
  release `oats onboard` lists `D` in this computer's list of deployments, so
  the Desktop and the TUI find it wherever it is
  ([#1390](https://github.com/awebai/oats/issues/1390)). On Linux, the person
  picks `D` in the Desktop's switcher, where it is listed; with an older
  release, they add it with **Add local workspace… → Browse**.

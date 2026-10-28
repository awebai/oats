## Changed

- **`oats` commands start faster: the CLI keeps Node's compile cache.** Node
  no longer recompiles the kernel on every command, which takes roughly a
  third off a cheap read such as `oats version` or `oats session inspect`,
  and off every status poll the Desktop and the TUI make. The cache is a new
  directory, `~/.oats/compile-cache` (`$OATS_HOME_DIR/compile-cache`),
  created mode 0700. It is safe to delete at any time. `NODE_COMPILE_CACHE`
  moves it, and `NODE_DISABLE_COMPILE_CACHE=1` turns it off
  ([configuration](../configuration.md#the-compile-cache)). Nothing a command
  prints changes.

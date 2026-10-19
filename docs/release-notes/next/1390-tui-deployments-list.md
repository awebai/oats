## Changed

- **`oats tui`'s switcher lists this computer's deployments from the
  kernel's list,** `oats deployments`
  ([#1390](https://github.com/awebai/oats/issues/1390)), and no longer looks
  inside `~/Agents`.
  - **Started outside every deployment** with no `--dir`, it reads the list
    and starts with the switcher when the list holds a row. With none, it
    exits with `E_NO_DEPLOYMENT`, and the line says how to open one
    (`oats tui --dir <path>`) or create one (`oats onboard`). A list that
    can't be read exits with the kernel's own code and message.
  - **Opening a deployment lists it:** the deployment a run starts in, from
    where you are or with `--dir`, is added to the list once. A failure is
    said once, under the sidebar's title, and opens nothing less.
  - **Under "On this machine, not opened"** stand the list's deployments the
    run hasn't opened. A row that can't be opened says why: `Not found.`,
    `Not an OATS deployment any more.` or `Can't be read.`
  - **`Delete` on such a row asks, then removes it from the list,** with
    `Enter`; nothing on disk changes. `tui.json` can give `remove` another
    key. `r` reads the list again.
  - The `More folders than are listed here.` row is gone. See
    [OATS TUI](../tui.md#the-switcher).

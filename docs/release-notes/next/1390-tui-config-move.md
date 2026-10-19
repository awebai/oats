## Changed

- **`oats tui` reads its key file from `~/.oats/config/tui.json`**
  ([#1390](https://github.com/awebai/oats/issues/1390)), beside the kernel's
  own files: `$OATS_HOME_DIR/config/tui.json` when `OATS_HOME_DIR` is set.
  `XDG_CONFIG_HOME` is no longer read for it.
  - **An existing file is moved for you** the first time the TUI starts: it
    copies `~/.config/oats/tui.json` (or `$XDG_CONFIG_HOME/oats/tui.json`)
    to the new path and renames the old file `tui.json.migrated`, beside
    it. Nothing else changes.
  - **If both files are there, the TUI refuses to start** with
    `E_TUI_CONFIG`, naming both: copy what you need into
    `~/.oats/config/tui.json`, then remove the old file.
  - **If you keep `tui.json` in a dotfiles manager,** point it at
    `~/.oats/config/tui.json`. A manager that puts the old file back makes
    both files present, and the TUI refuses until you remove it.
  - When the move can't be made (the old file is a link to nothing,
    `tui.json.migrated` is already there, the file system has no hard links,
    or a step fails), the TUI says why and stops: move the file yourself.
    See [OATS TUI](../tui.md#the-move-from-configoats).

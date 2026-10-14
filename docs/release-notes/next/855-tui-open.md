## Added

- **`oats tui` opens an agent's terminal**
  ([#855](https://github.com/awebai/oats/issues/855)). `Enter` on an
  instance that runs, on this machine or on a registered one, gives your
  terminal to the agent through `oats session attach`; `Ctrl+\` brings
  `oats tui` back and the agent keeps running. `tui.json`'s
  `open.detachKey` changes the key. After the return one line says what
  happened, and `Enter` on an instance that cannot be opened says why. An
  agent on a machine whose OATS is older than 0.51.0 is not opened: it has
  no key to leave a viewer. The action `open-workspace` is now `open`, and a
  `tui.json` that names `open-workspace` is refused with
  `open-workspace is called open now; rename it`.

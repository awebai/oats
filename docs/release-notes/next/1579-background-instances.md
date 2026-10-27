## Added

- **Background instances** ([#1579](https://github.com/awebai/oats/issues/1579),
  feature `instance-background`). An instance can be recorded as background,
  so that clients list it under a Background section of its own. Like the
  colour, it is presentation only: a background instance spawns, starts,
  takes input, messages and retires like any other.
  - A soul gives the default with `background: true` in `soul.yaml`. Add it to
    a committed soul only once every deployment that reads it runs this
    release, because earlier kernels refuse the key.
  - `oats spawn … --background` or `--no-background` wins over the soul. The
    preview and the result carry `background` and `backgroundFrom` (`flag` or
    `soul`). A routed spawn sends either flag only to a host that has the
    feature.
  - `oats instance background <instance> on|off` changes it later, locally or
    with `--server`, under the same rules as `oats instance color`.
  - The home keeps it in `.oats-background.json` through restart, stop, resume
    and `oats instance upgrade`. A later edit of the soul moves no existing
    instance, and retire never counts the file as work.
  - `background: true` appears on `oats status --json` rows, remote roster
    rows, `oats inspect --home` and the soul rows of `oats souls --json`. The
    `oats status` text marks a row `[background]`.

  See
  [Background instances](../desktop-cli-api.md#background-instances-oats-instance-background).

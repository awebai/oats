## Changed

- **`oats retire --server` prints the receipt's warnings
  ([#1006](https://github.com/awebai/oats/issues/1006)).** The routed
  retire's text (without `--json`) printed the recovery and extra-tree lines
  of the host's receipt and none of its `warnings`. It now prints them as a
  local retire does, one `WARNING:` line each, after the extra-tree lines:
  what a retire left an attached child with, which repository it read from
  Git, where a link at `work/` led. The JSON is relayed as it was.
- **More text lines spell what a terminal would act on
  ([#1006](https://github.com/awebai/oats/issues/1006)).** The `note:`
  lines of `oats retire --plan`, `oats instance stop --plan`,
  `oats instance git` and `oats readiness`; the `WARNING:` lines of
  `oats spawn` (local and with `--server`), of the `oats session` commands
  and of `oats doctor`; and the retire's recovery and extra-tree lines, local
  and with `--server`, spell a control character (an escape, a newline), a
  line separator or a bidi override as `\u{<hex>}`, as the local retire's
  warnings have since 0.53.0. A line that holds no such character is printed
  as it was. No JSON answer changes. See
  [Text output](../desktop-cli-api.md#text-output).

## Fixed

- **A path, a branch name or a hook's words could rewrite the terminal
  through these lines
  ([#1006](https://github.com/awebai/oats/issues/1006)).** A hook's warning,
  a pi folder's path, an extra tree's path or a branch name printed as it is
  could clear the screen, add a line of its own or reverse what followed it.
  It is now spelled (see Changed).

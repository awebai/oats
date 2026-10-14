## Added

- **Forget… on an instance its server no longer lists.** In the Desktop, a
  remote instance that is gone from its server now offers **Forget…** in its
  roster row's actions menu and in the context panel. After a confirmation,
  the Desktop runs `oats server forget <server> --instance <instance>` for
  that row, which removes only this computer's saved route and nothing on the
  server, then reads the roster again. Before, the only remedy was to type
  that command
  ([`oats server forget --json`](../desktop-cli-api.md#forget-a-saved-route-oats-server-forget---json),
  [#1131](https://github.com/awebai/oats/issues/1131)).

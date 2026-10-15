## Added

- **`retire` on status rows: whether a retire of the home is running,
  cannot be told, failed or was interrupted** (feature `status-retire-state`,
  [#1247](https://github.com/awebai/oats/issues/1247)). `oats status --json`
  instance rows carry `retire: {state, since, self, code?, message?}` while a
  retire of the home is running, scheduled or owed, and no such key
  otherwise. It is read only from the files beside the home: the self-retire
  marker (`self: true`) with its completion process and its result file, or,
  without a marker, the home's claim held by an `oats retire` (`self:
  false`). `state` is `running`, `unknown` (liveness cannot be read),
  `failed` (with the result's kernel `code` and its one-line `message`) or
  `interrupted` (the completion process is gone). `since` is always an
  instant (the recorded time, else the file's modification time), and
  `code` and `message` are strings or absent, never `null`. Status still takes no
  claim, removes no file and signals no process. `retirePending` keeps its
  meaning. Remote roster rows relay `retire` only when the host's row has
  it, checked by the same rule, and drop a value that fails it. A client
  reads the field only when `oats version --json` lists
  `status-retire-state`: an older kernel never carries it
  ([`retire`](../desktop-cli-api.md#row-retire)).

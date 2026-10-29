## Changed

- **OATS Desktop: the poll's reads go through the warm reader** (#1630).
  Where the installed CLI lists `warm-reader` (`readerApi: 1`), the Desktop's
  bundled server starts one `oats reader --stdio` from that CLI. It answers
  the background `oats status` and `oats workspace status` reads of every
  refresh cycle (`--max-age` above 0) with the kernel's read code kept
  loaded, instead of a Node start per read. The answers are the CLI's own and
  are checked the same way. A live read (the first cycle, a refresh after a
  change, Refresh) still runs the CLI. Whenever the reader is absent, refuses,
  times out, stops answering or exits, that read runs the CLI as before.
  After repeated failures the Desktop uses the CLI until the CLI changes. A
  reader whose install was upgraded under it makes the Desktop probe the CLI
  again. The reader dies with the server that started it, also when the app
  or the server is killed. Nothing about it is shown. `/api/cli` reports its
  state as a diagnostic.
- **OATS Desktop: no liveness child under `status-liveness`.** With a CLI
  that lists `status-liveness`, the refresh cycle no longer starts its
  terminal-liveness child. A local row's running state, reason and tmux
  record are the ones `oats status` reports, and a reason on a local row is
  always the kernel's. As a result, an instance home with no tmux record
  (every spawn records one) has no terminal for the Desktop to open, where
  the child used to fill in the default session. With an older CLI the child
  runs as before.

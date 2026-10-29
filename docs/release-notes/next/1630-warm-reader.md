## Added

- The warm reader, `oats reader --stdio` (feature `warm-reader`,
  `readerApi: 1`, #1630). A client starts it as its own child, from the same
  install it runs its CLI reads with, and sends it `oats status --json` and
  `oats workspace status --json` reads over its stdin and stdout, one JSON
  line each way, many times. It answers with the kernel's own read code, kept
  loaded: warm code, not warm data. Every request reads the deployment
  afresh, and each answer's `exit` and `answer` are what the same CLI read
  prints and exits with, with cwd = `--dir`. What it cannot answer that way it
  refuses (`E_READER_BAD_REQUEST`, `E_READER_UNSUPPORTED`), and the client
  runs the CLI. A reader whose install changed under it (an upgrade, a Node
  upgrade) answers nothing more from the old code: it refuses with
  `E_READER_STALE` and exits. It ends when its client closes its stdin or
  dies. Bare `oats reader` is `E_USAGE`. The protocol and the client rules
  are in [The warm reader](../desktop-cli-api.md#the-warm-reader); the
  decisions in [the design record](../design/2026-10-29-warm-reader.md).
- Feature `status-liveness`: `oats status --json` instance rows' `running`
  and `runtimeState` are the complete local liveness reading, read live at
  every call under the kernel's pane rule, so a client that sees the feature
  in the probe needs no liveness probe of its own beside the roster
  ([The roster](../desktop-cli-api.md#the-roster-oats-status---json)).

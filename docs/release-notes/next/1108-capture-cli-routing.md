## Changed

- Ordinary/source-selected capture and explicit retry now use the fixed private
  supervisor and worker, including append-only `--no-index`. Foreground watch
  serializes passes and coalesces notifications. Existing reset-only and
  exact-home/file paths, ordinary JSON rejection and retry JSON shape remain;
  missing worker receipts never become fabricated zero-count success. This is
  forthcoming service-A command integration, not installed periodic-service or
  detached-hook migration; full hosted qualification remains outstanding.

## Changed

- **The reads OATS makes most often load only what they use.** `oats version`,
  `session inspect`, `status`, `workspace status`, `instance events` and
  `instance waiting clear` no longer load the whole kernel. `oats version` takes
  less than half its time and `session inspect` about half; `status` takes about
  an eighth less and `workspace status` about a fifth less; `instance events` and
  the waiting hook a Claude instance runs every turn take about a quarter less.
  Nothing a command prints changes.

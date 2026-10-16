## Changed

- Add a private append-only capture worker mode that leaves the search index,
  index inventory and deferred reset/index evidence untouched while supervised
  source discovery, capture and retained cleanup continue. Source-only retirement
  allows later growth to be revisited without claiming all-stage success;
  receipts remain pending/partial or current-pass failed. This prepares ordinary
  `--no-index` routing without changing public commands or synchronous APIs.
  Audit/storage costs and full command/service qualification remain outstanding.

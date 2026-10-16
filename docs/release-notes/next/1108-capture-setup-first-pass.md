## Changed

- Forthcoming service-A setup runs its first capture through the fixed supervised
  caller with explicit `setup` attribution, all sources and indexing enabled.
  It uses the running Node executable; the stable Node recorded for future hooks
  and services remains separate. `--no-service` still runs the first pass and
  `--dry-run` starts none. Matching worker receipts supply counts; partial and
  overlap retain exit zero without claiming completion, while operational or
  missing-receipt failures remain nonzero with recovery guidance. Ordinary,
  retry and protected synchronous contracts are unchanged. Installed periodic
  service conversion/attribution, health/doctor and hosted qualification remain
  separate unfinished gates; this does not describe shipped 0.56–0.58 behavior.

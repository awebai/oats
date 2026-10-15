### Changed

- Extended the private capture-service foundations with bounded index-work
  admission and confirmed run accounting. Interrupted index groups retain
  retry evidence; healthy work can continue, and due retries resolve only after
  indexing completes. Index reset detection still defers to a separately
  admitted operation. These foundations and fixtures do not yet change the
  ordinary command, installed service or public synchronous indexing path, and
  do not qualify full periodic-service behavior.

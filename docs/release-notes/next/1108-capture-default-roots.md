## Changed

- Extend the private capture-service foundation with caller-bound default-root
  selection under durable worker admission. Resolved format order and directory
  identities persist across replacement; interrupted or refused resolution
  retains pending failure/backoff while independent work can proceed. Existing
  native location selectors and public synchronous APIs remain unchanged.
  Selection is not capture or pass completion. Metadata enumeration and added
  transaction costs remain qualification gates; ordinary CLI, append-only
  command routing and installed service integration remain unfinished.

## Changed

- Extend the private capture-service worker foundation with resumable discovery
  of explicitly selected native and AW roots. Bounded metadata pages rotate
  among formats and commit with their queue checkpoints, preserving per-format
  order and selected-directory identity checks across worker replacement.
  Refused roots retain pending checkpoints and private backoff while replacement
  workers can advance safe independent work with a truthful failed-pass receipt.
  Directory-name arrays retain their documented metadata cost. Enumeration
  does not certify processing or pass completion; ordinary command routing,
  installed service behavior and final qualification remain unfinished.

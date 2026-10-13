## Fixed

- **Desktop: the fix OATS sends with a refused preview reaches the Spawn
  dialog** ([#1015](https://github.com/awebai/oats/issues/1015)). When OATS
  refuses the preview of a spawn it may send, beside its message, a fix: what
  to do about it. The Desktop's reader of the CLI's answer kept the code and
  the message and dropped the fix, so no fix reached the dialog from an
  installed OATS. It now keeps the fix beside OATS's own message, as one
  printable line of at most 1,024 characters, and nothing else of the
  refusal's details. What a person sees differently today is in one place:
  the three lines under Details for an unmatched launch preference (under
  Changed) are read from it. A harness that is not installed reads as it did,
  since OATS's message for it already holds its fix.

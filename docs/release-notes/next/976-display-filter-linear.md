## Fixed

- **One long text with no space no longer slows the Desktop and the TUI
  ([#976](https://github.com/awebai/oats/issues/976)).** Both show the
  kernel's free text through one filter, which withholds a text that looks
  like a credential. Its check for a URL with credentials took time that grew
  with the square of a run of letters: one 8192-letter message with no space
  cost from a tenth of a second to most of a second each time it was shown,
  depending on the machine, in the Desktop on each render and in the TUI on
  each paint. The check now takes time that grows with the length of the
  text: the same message takes about a millisecond or less. The filters of
  the readiness view and of an instance's activity had the same check and
  take the same fix. **What is withheld and what is shown are the same as
  before.**

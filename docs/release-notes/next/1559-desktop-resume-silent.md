## Changed

- **Desktop: no notice about resumed sessions**
  ([#1559](https://github.com/awebai/oats/issues/1559)). OATS Desktop still
  asks OATS to resume lost sessions when it opens and when a roster shows one
  lost, exactly as before, but it no longer shows a notice about what was
  resumed, started fresh, left waiting or could not be resumed. A resumed
  instance shows running in the roster. A sweep that fails still writes one
  line with its code to Desktop's log. `oats tui` says nothing about a resume
  either. See
  [When Desktop opens](../desktop-instance-start.md#when-desktop-opens).

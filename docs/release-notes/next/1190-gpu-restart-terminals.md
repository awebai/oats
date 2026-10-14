## Fixed

- Desktop terminals draw text again after the computer wakes from sleep or
  after a switch of Spaces or windows. When the graphics process restarted,
  every terminal pane went blank, showing only its background and the cursor,
  for old output and new alike, until the app was reloaded. Now, once the
  graphics contexts are back, the app redraws the text of every open terminal,
  hidden tabs included.
  ([#1190](https://github.com/awebai/oats/issues/1190))

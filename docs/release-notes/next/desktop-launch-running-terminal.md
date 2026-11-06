## Changed

- A Desktop launch with `--dir <deployment> --instance <name>` opens the named
  running local instance's terminal tab in the main area, through the same
  viewer path as a roster click. Keyboard focus stays on the roster row;
  the launch sends no input and starts nothing. Stopped, unknown, held,
  unavailable or stale rows stay selected only, without a Start dialog.
  A row first seen stopped during the 30-second pending window does not open
  when it later starts. Your selection, typing or pointer press cancels a
  pending request; a later launch replaces it.

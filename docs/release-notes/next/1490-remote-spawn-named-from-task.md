## Added

- **Desktop: a spawn on another machine is named from its task.** With Name
  left empty, a spawn on a server whose OATS takes an exact name is now named
  from its Opening instruction, as a spawn on this computer is: the Desktop
  asks this computer's harness and model for a name (OATS here with feature
  `instance-suggest-name`), shows it in the field and under it, and the
  server spawns under it. When this computer can't name it, the server names
  it from its task if its OATS can (feature `spawn-apply-suggest-name`), and
  otherwise numbers it as before. The help under an empty Name says which,
  before you press Spawn, and a notification says why when the instance was
  numbered instead. Naming never stops a spawn
  ([desktop.md](../desktop.md)).

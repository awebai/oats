## Added

- **Desktop: an instance named from its task.** With an OATS that suggests
  names (`spawn-suggest-name`), the spawn dialog asks for a name once the
  Opening instruction holds three words and you pause typing. The soul's
  harness replies with a short name for the work, and the role is added as
  its suffix. It shows as the empty Name field's placeholder, "will be named
  release-notes-manager", and in **What will be created**, and Spawn uses
  it. Typing a name replaces it and stops suggestions for that dialog.
  Spawning with Name empty and no suggestion yet shows **Naming…** and asks
  once. When the instance can't be named from its task, it is numbered, and
  a notification says why ("Named oats-desktop-expert-3: naming took longer
  than 20 seconds."). Nothing is asked before you type, nor on a timer.
  Spawns on a server keep their purpose. ([Desktop](../desktop.md))

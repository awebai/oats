## Changed

- **A composed `AGENTS.md` puts the capabilities in the soul's order, and the
  kernel's blocks last.** It is the soul's own `AGENTS.md`, then the inject
  of each capability the soul lists, in its `capabilities:` order, then the
  workspace defaults the soul does not list, in the order the workspace's
  `defaults:` lists them, then the instance-boundary and work-mode blocks.
  Before, the kernel's blocks came right after the soul's body and the
  injects followed in capability-name order. A soul entry that re-lists a
  workspace default sits at the soul's place; a standalone soul's kernel
  default, `oats.core`, follows the capabilities it lists. A capability
  name made only of digits comes first in its list. Spawn, `instance.json`
  `instructions` and `composition.expected`, `oats inspect --soul
  --instructions` and `oats doctor --soul` all list the blocks in the new
  order; no JSON shape changes. Modules, skills and hooks keep their name
  order, and the resolution's revisions do not move, so no instance reports
  drift. An existing home keeps the `AGENTS.md` it has; `oats instance
  upgrade` recomposes it in the capability order it recorded, with the
  kernel's blocks last
  ([capabilities.md](../capabilities.md#what-an-instance-receives)).

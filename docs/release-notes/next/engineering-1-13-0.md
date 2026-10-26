## Provider updates

- **oats.engineering 1.13.0: one release lane, and one lane per project.**
  The catalog and this workspace pin `oats.engineering: v1.13.0` (floor
  unchanged). It carries 1.12.0 and 1.13.0 together, and supersedes 1.11.0's
  "a maintainer the map doesn't name asks for a lane before it acts":
  - **The release lane** does the final review and the merge of what the
    other lanes hand it, owns and tags every release, and keeps the lane map.
  - **Every other lane is a project lane.** A maintainer defines one, or
    claims one with no active maintainer, when it holds none or its human
    asks, and adds itself to the map; several maintainers may share a lane.
    A project lane reviews its own work and hands each approved PR to the
    release lane. The map may record another arrangement for a lane, agreed
    with the release lane.
  - **A human's high-level picture is the maintainer's intake.** The
    maintainer writes the brief and launches the expert, which writes the
    spec and plan. A lead launched for work in a lane the maintainer holds is
    its child (`--parent`); work for another lane goes to that lane's
    maintainer, or to a maintainer spawned for it, and the human is told who
    has it.
  - Also taught: splitting a lane, the owning lane's second read on a
    cross-lane PR, confirming a relayed human decision directly, cleaning up
    a cancelled effort, and a failed publication (re-run from the same tag).
- **Upgrade:** `oats sync` locks it; new spawns get it, or a stopped home
  moved with `oats instance upgrade`. Peer maintainers record their lanes,
  and any non-default arrangement, in their lane map.

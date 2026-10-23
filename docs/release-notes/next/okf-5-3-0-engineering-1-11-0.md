## Provider updates

- **oats.okf 5.3.0: named harvest checkpoints; instances name their
  harvesters.** The catalog and this workspace pin `oats.okf: v5.3.0`
  (floor unchanged, OATS >=0.49.0).
  - The checkpoints are a PR handed over for review, a finished task and, in
    a long-lived role such as a maintainer's, a feature ready, a release or
    deploy shipped, and a direction decision taken with the human. Each gets
    one proposal carrying only what no earlier proposal carried, and a line
    in `log.md` even when there is nothing to propose.
  - The available-memory gate before a harvester spawn is gone. A proposal
    held back by a harvester that is still listed launches at the next
    checkpoint.
  - The proposer names each harvester:
    `oats spawn oats.okf/knowledge-harvester --name <harvester-name> …`,
    with a name **okf-propose** prints from the source's name and a fresh
    UUID. The kernel's numbered default could land on an alias that a
    retired harvester's messaging certificate still holds, and the spawn
    then failed at identity minting. `E_INSTANCE_NAME_TAKEN` and identity
    failures stop and are reported, with no automatic rename.
  - See [Knowledge](../knowledge.md#the-flow).
- **oats.engineering 1.11.0: the release lane.** The catalog and this
  workspace pin `oats.engineering: v1.11.0` (floor unchanged). One
  maintainer lane is the release lane: it plans and tags every release and
  keeps the lane map, which says when another lane's merge needs its
  sign-off. A maintainer the map doesn't name asks for a lane before it
  acts. The maintainer's harvest checkpoints defer to the knowledge layer's
  rules.
- **Upgrade:** `oats sync` locks both; only new spawns get them, or a
  stopped home moved with `oats instance upgrade` (from OATS 0.68.0).
  Peer maintainers name the release lane and the sign-off rule in their
  lane map.

## Provider updates

- **oats.engineering 1.10.0: maintainers work in lanes**
  ([#1103](https://github.com/awebai/oats/issues/1103),
  [oats-engineering#14](https://github.com/awebai/oats-engineering/pull/14)).
  The official catalog, the reference workspace and the generated mirrors
  (`mirrors/oats-developer`, `mirrors/oats-code-review`,
  `mirrors/oats-engineering-expert`, `mirrors/oats-maintainer`) take published
  `v1.10.0` at `TAG_COMMIT`; each mirror's tree equals the tag's. Instruction
  text only: no skill is added or removed, and the requirement is unchanged
  (OATS 0.30.0 or later). `oats.maintainer` and `oats.engineering-expert`
  change; the other two capabilities only change version. What changes:
  - **Each maintainer holds a lane.** The peers' agreement becomes a written
    lane map: what each lane covers, its maintainer and its second reader,
    the label a PR shows its lane with, the hold label, and who owns the next
    release. A maintainer's state file holds its own lane only; the forge is
    the one copy of a PR's state.
  - **Every PR gets one second reader, asked once,** at the head the lane's
    maintainer approved. This replaces every peer reviewing every PR and
    re-binding its verdict at every head.
  - **Intake no longer sweeps on every wake:** a full sweep at session start,
    after a compaction and at least weekly; on a wake, the event alone.
  - **Peers message each other for five things** (a second read, a hold that
    must stop work in flight, the release plan, a lane changing hands, a
    request that belongs to the peer's lane), and send no notice before or
    after a merge or a tag. A hold is a label on the forge, and the merge step
    reads it.
  - **The merging maintainer brings a branch up to date itself;** the verdicts
    carry when the PR's own change is unchanged and CI is green. When the
    default branch moved since CI ran, it runs the affected test files on a
    trial merge first.
  - **Experts hand over to one maintainer,** the one whose lane the work is
    in, and leave the branch alone after the hand-over.
  - **To adopt it:** peer maintainers rewrite their agreement as a lane map
    (`/cross-review-peer`), create the lane labels and the hold label, and
    drop each other's PRs from their state files. A maintainer alone has
    nothing to do. Pin `oats.engineering: v1.10.0` and run `oats sync`.

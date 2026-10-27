## Provider updates

- **oats.engineering 1.15.0: maintainers trust what experts relay from their
  human.** The catalog and this workspace pin `oats.engineering: v1.15.0`,
  which carries 1.14.0 (above); the floor is unchanged.
  - **A decision is trusted.** When an expert reports a decision it made
    with its own human, the maintainer takes it as that human's decision
    without asking them again. That covers an architecture, a design, a
    scope or a product call, and the same holds for a peer maintainer
    relaying its own human. The maintainer still gates it on soundness, the
    roadmap, the product direction and the architecture.
  - **A relay says "Decided with <human>: <decision>"** and where it is
    recorded. Anything else is a proposal.
  - **Authority is still confirmed with the human directly.** That covers a
    merge without its second reader, a hold or freeze exception, a tag or
    publication, a deploy, a destructive or outward-facing act, and marking
    another maintainer `left`.
- **Upgrade:** `oats sync` locks it. New spawns get it, and a stopped home
  moves to it with `oats instance upgrade`. Experts relay their human's
  decisions in the "Decided with" form.

## Changed

- **Shorter always-loaded instructions.** The kernel's instance-boundary and
  work-mode blocks are about half their former size. The oats.core "You run
  on OATS" block is shorter too, despite the new rule below. They keep
  their behaviour rules, the pinned home/work boundary sentences among them,
  in emphatic form, and name which skill to load and when for the detail
  (`/oats-operate`, `/oats-souls`, `/oats-token-saving`). The instance-boundary
  block opens with "ALWAYS FOLLOW THESE INSTRUCTIONS FOR WORKING". The
  extra-trees commands are unchanged. Existing instances keep the AGENTS.md
  they were spawned with; new spawns get the new text.
- **oats.core: needs-input through the parent.** When a human talks to an
  instance's parent rather than to the instance, the instance sends its
  question to the parent, which sets its own needs-input claim naming the
  child and relays the answer ([capabilities.md](../capabilities.md)).

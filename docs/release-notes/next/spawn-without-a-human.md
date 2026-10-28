## Changed

- **oats.core: spawning a child your capabilities call for needs no human.**
  `/oats-operate` and `/oats-souls` said to spawn only when your task or your
  human asks (or a documented workflow requires it), and to ask your human
  when a relation is unclear. They now also admit your soul's capabilities, as
  the "You run on OATS" block already does (a developer spawning its
  reviewer, an expert its developers), and send a question about an unclear
  relation to your parent or the agent that gave you the task, and to your
  human only when no agent can say. A capability that spawns its own helpers
  no longer reads as needing a human for it.

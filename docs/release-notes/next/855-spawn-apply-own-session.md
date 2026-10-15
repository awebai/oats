## Changed

- **A spawn runs in a process session of its own.** The `oats spawn` child of
  a confirmed spawn now runs in a process session of its own, so a hang-up or
  a Ctrl-C in the terminal that started the client does not reach a spawn
  while its worktree hooks run. The deadline the confirmed preview implies
  still interrupts it, and the kernel rolls it back.

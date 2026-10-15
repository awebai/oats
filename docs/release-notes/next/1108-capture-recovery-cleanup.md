## Changed

- The private capture service foundation can enumerate retained recovery
  cleanup independently of completed source work and resume bounded hash
  cleanup after worker interruption. Deletion still requires the exact
  durable allocation reference and registered worker ownership. Partial
  cleanup keeps its reference until both metadata tables are finished;
  active allocations and committed source cursors are preserved. This does
  not yet install or switch commands to the periodic service.

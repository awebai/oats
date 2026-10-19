## Fixed

- Capture setup now shares one checked publisher for hooks, service definitions
  and pending activation markers: it syncs file contents before rename, then
  the containing directory, and syncs newly created parent entries in order.
  Required sync failures exit nonzero; failures after publication name the
  affected target and stage without claiming rollback or established durability.

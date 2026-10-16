## Fixed

- **A viewer from `oats session attach` no longer outlives an attach that
  died without detaching** ([#1332](https://github.com/awebai/oats/issues/1332)).
  A cgroup-wide `systemctl kill`, a stop timeout, oomd or a killed ssh used
  to leave the `oatsview-*` session, and a keyed viewer's key table, on the
  agents' tmux server. Now the viewer's client sets a `client-detached` hook
  on its own session once it has attached, so the server removes the session
  when its last client goes, however the client went. That hook also unbinds a keyed viewer's key table. A viewer session
  that ends another way has its table unbound by one global hook entry,
  `session-closed[900]`, the only one OATS owns on the agents' server: keep
  your own `session-closed` hooks at other indexes (tmux 3.2 and later;
  before 3.2 the sweep removes the table). Every
  attach also sweeps what earlier attaches left before it opens its viewer.
  It removes a viewer session that has no client and whose attach is gone,
  and every viewer key table whose session is gone. When the sweep removed
  something, the attach says so in one line on stderr. Exit statuses are
  unchanged, a leave by the detach key's 20 included
  ([execution targets](../execution-targets.md#inspect-input-and-attach)).

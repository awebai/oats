## Added

- **Desktop: lost sessions are resumed.** After a shutdown, a reboot or a
  crash, opening Desktop asks OATS to resume every instance whose session was
  lost, on every deployment on this computer. While Desktop is open, it asks
  again when it sees a session that was lost, at most once every 30 seconds,
  and not again for an instance OATS could not resume. None of this holds
  anything up. When an instance was resumed, started fresh, is waiting for you
  or could not be resumed, a notice says so and stays until you dismiss it.
  Its Details name each instance and what happened to it, and say which
  deployments were not checked. An instance that keeps losing its session is
  named once, and OATS stops resuming it until you start it yourself. More
  than three notices fold into one. Nothing lost means no notice. Quitting
  Desktop while the sessions are being resumed does not cut that short
  ([desktop-instance-start.md](../desktop-instance-start.md#when-desktop-opens)).

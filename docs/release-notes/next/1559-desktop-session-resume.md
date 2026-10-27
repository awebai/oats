## Added

- **Desktop: lost sessions are resumed when Desktop opens.** After a shutdown,
  a reboot or a crash, opening Desktop asks OATS to resume every instance
  whose session was lost, on every deployment on this computer. It happens
  once each time Desktop opens and holds up nothing. When an instance was
  resumed, started fresh, is waiting for you or could not be resumed, a notice
  says so and stays until you dismiss it. Its Details name each instance and
  what happened to it, and say which deployments were not checked. Nothing
  lost means no notice. Quitting Desktop while the sessions are being resumed
  does not cut that short. To turn it off, uncheck **Resume lost sessions when
  Desktop opens** in the settings menu, or use the palette's **Settings:
  Resume lost sessions when Desktop opens**. The change takes effect the next
  time Desktop opens. `session.resume: off` in a deployment's
  `oats-local.yaml` turns it off for that deployment only
  ([desktop-instance-start.md](../desktop-instance-start.md#when-desktop-opens)).

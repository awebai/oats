## Fixed

- **A directory-mode instance starts again after a macOS reboot**
  ([#1261](https://github.com/awebai/oats/issues/1261)). macOS gives a volume a
  new device number each time it is mounted, so after every reboot
  `oats session start` refused every directory-mode home with "directory home
  was exchanged; restore the owned root before retrying start", although its
  home and `work/` were the same directories. On macOS a start now accepts a
  root whose inode matches the one the spawn recorded, and whose birth time
  matches too when one was recorded. A spawn now records each root's birth
  time; homes spawned earlier, whose baselines hold none, start with no edit.
  A real exchange, another directory renamed into the home's or `work/`'s
  place, is still refused with the same error, and Linux keeps comparing
  device and inode. Captured Pi sessions on macOS had the same problem at the
  next start after a reboot ("original Pi session directory was replaced");
  the same rule now applies to their session directory
  ([`directory` — independent execution](../souls-and-instances.md#directory--independent-execution)).

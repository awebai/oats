/** Whether `actual` ({dev, ino, birthtimeNs?}, read now) is the directory `recorded` names.
 *  The inode is the identity: on one volume a different directory has a different inode.
 *  macOS gives an APFS volume a new `dev` each time it is mounted, so after a reboot `dev`
 *  no longer matches; there an equal inode is enough, unless the record holds a birth time
 *  (a decimal string of ns), which must then match too. Birth time is not an identity (it can
 *  be set, and copies keep it): it closes only the gap a dropped `dev` opens, another volume
 *  showing the same inode. A record without one, or with "0" (no birth times on that volume),
 *  is judged by the inode alone. Elsewhere `dev` and `ino` must both match. */
export function sameDirectory(recorded, actual, platform = process.platform) {
  if (!recorded || !actual || recorded.ino !== actual.ino) return false;
  if (recorded.dev === actual.dev) return true;
  if (platform !== "darwin") return false;
  return recorded.birthtimeNs === undefined || recorded.birthtimeNs === "0" || recorded.birthtimeNs === actual.birthtimeNs;
}

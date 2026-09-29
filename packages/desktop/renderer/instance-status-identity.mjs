/** What of a roster row makes an instance's as-spawned resolution another subject
 * (desktop/loading-states item 8; spec 02 caches `inspect --home` by the same facts):
 * its home, the last session start (a restart), its module drift rows and its soul
 * source. A context-panel section re-reads when this changes for the same selection;
 * a poll that changes nothing here changes nothing there. Facts an older kernel does
 * not report are absent (null), never synthesized. */
export function instanceStatusIdentity(instance) {
  if (!instance || typeof instance !== 'object') return null;
  return JSON.stringify([instance.home ?? null, instance.startedAt ?? null, instance.running === true, instance.modules ?? null, instance.soul ?? null]);
}

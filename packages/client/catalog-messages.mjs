/** The sentence of a failed catalog read (a held entry's `reason`), the same in every client and for
 * every catalog a client shows: the souls (soul-catalog.mjs) and the capabilities
 * (capability-catalog.mjs). The noun is one of those two, so no client words a third catalog its own
 * way. The kernel's message in it is text from outside: a client draws it through its display
 * filter. */
const NOUNS = Object.freeze(['souls', 'capabilities']);

export function catalogFailure(noun, reason) {
  if (!NOUNS.includes(noun)) throw new TypeError(`catalogFailure: noun must be one of ${NOUNS.join(', ')}`);
  const message = typeof reason?.message === 'string' && reason.message ? reason.message : '';
  return message ? `Couldn't read this workspace's ${noun}: ${message}` : `Couldn't read this workspace's ${noun}.`;
}

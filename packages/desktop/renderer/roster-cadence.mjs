/** How often a window re-reads its roster (#481): every ROSTER_POLL_FOCUSED_MS while it is focused,
 * and at the server's blurred cadence (server/refresh-loop.mjs REFRESH_BLURRED_MS) while it is not:
 * the server observes no faster then, so an unfocused window's extra reads would show nothing new. */
export const ROSTER_POLL_FOCUSED_MS = 4000;
export const ROSTER_POLL_BLURRED_MS = 30000;

/** Is a poll due on this tick? Ticks come every ROSTER_POLL_FOCUSED_MS and drift by a few ms, so an
 * unfocused window's tick within half a tick of the interval counts. */
export function rosterPollDue({ focused, last, now }) {
  return focused || now - last >= ROSTER_POLL_BLURRED_MS - ROSTER_POLL_FOCUSED_MS / 2;
}

// Cadence (#481, item 11): a focused window's roster polls every 4 s; an unfocused window's at the
// server's blurred cadence. The server's own reduction (any window focused) is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_POLL_FOCUSED_MS, ROSTER_POLL_BLURRED_MS, rosterPollDue } from '../renderer/roster-cadence.mjs';
import { REFRESH_BLURRED_MS } from '../../client/refresh-loop.mjs';

test('the blurred roster cadence is the server\'s blurred refresh interval', () => {
  assert.equal(ROSTER_POLL_FOCUSED_MS, 4000);
  assert.equal(ROSTER_POLL_BLURRED_MS, REFRESH_BLURRED_MS);
});

test('a focused window polls on every tick; an unfocused one once per blurred interval', () => {
  assert.equal(rosterPollDue({ focused: true, last: 1000, now: 1001 }), true);
  for (const elapsed of [ROSTER_POLL_FOCUSED_MS, 10_000, 27_000]) assert.equal(rosterPollDue({ focused: false, last: 0, now: elapsed }), false, String(elapsed));
  // Ticks drift by a few ms: the tick that lands on the interval counts.
  for (const elapsed of [ROSTER_POLL_BLURRED_MS - 5, ROSTER_POLL_BLURRED_MS, ROSTER_POLL_BLURRED_MS + 4000]) assert.equal(rosterPollDue({ focused: false, last: 0, now: elapsed }), true, String(elapsed));
});

test('source pin: the shell polls through the cadence and reads at once when its window is focused', async () => {
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  assert.match(shell, /rosterPollDue\(\{ focused: document\.hasFocus\(\)/);
  assert.match(shell, /setInterval\([^]*?ROSTER_POLL_FOCUSED_MS\)/);
  assert.match(shell, /window\.addEventListener\("focus", \(\) => \{ if \(!rosterPoll\) pollContextRoster\(\); \}\)/);
  assert.doesNotMatch(shell, /pollContextRoster\(\); \}, 4000\)/);
});

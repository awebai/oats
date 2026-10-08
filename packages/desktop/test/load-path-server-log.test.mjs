// The load-path helper's call logs (helpers/load-path-server.mjs) are polled while a fake appends to
// them, and one large row is not written atomically to a reader (#646): `calls()` and `tmuxCalls()`
// see an unterminated last line as "not yet", and still throw on a terminated line that does not
// parse. The fake oats logs elsewhere here (FAKE_LOG) and no fake tmux is installed, so only the test
// writes the two logs the helper reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { startLoadPathServer } from './helpers/load-path-server.mjs';

test('a poll of calls() or tmuxCalls() sees a half-written line as not yet, then sees it once the line ends; a broken ended line throws', async () => {
  const s = await startLoadPathServer({ env: ({ dir }) => ({ FAKE_LOG: join(dir, 'fake-oats-calls.jsonl') }) });
  try {
    const log = join(s.dir, 'calls.jsonl');
    const start = JSON.stringify({ id: 'half-written', verb: 'status', argv: ['status', '--json'], start: 1, phase: 'start', env: { BIG: 'x'.repeat(4096) } });
    assert.deepEqual(s.calls(), [], 'only this test writes the log the helper reads');
    appendFileSync(log, start.slice(0, 3000));
    assert.deepEqual(s.calls(), [], 'an unterminated line is not yet a call, and reading it does not throw');
    const seen = s.until(() => s.calls().find(c => c.id === 'half-written'));
    appendFileSync(log, start.slice(3000) + '\n');
    const call = await seen;
    assert.equal(call.verb, 'status');
    assert.equal(call.end, null);
    assert.equal(call.env.BIG.length, 4096);
    appendFileSync(log, '{"id":"half-written","phase":"end"');
    assert.equal(s.calls()[0].end, null, 'an unterminated end line is not yet the end');
    appendFileSync(log, ',"end":2}\n');
    assert.equal(s.calls()[0].end, 2);
    appendFileSync(log, '{"id":\n');
    assert.throws(() => s.calls(), SyntaxError, 'a terminated line that does not parse is a fake bug, not a race');

    const tmuxLog = join(s.dir, 'tmux-calls.jsonl');
    const row = JSON.stringify({ argv: ['-L', 'oats', 'list-sessions'], env: { BIG: 'y'.repeat(4096) } });
    appendFileSync(tmuxLog, row.slice(0, 100));
    assert.deepEqual(s.tmuxCalls(), [], 'an unterminated tmux line is not yet a call, and reading it does not throw');
    const tmuxSeen = s.until(() => s.tmuxCalls().length === 1 && s.tmuxCalls());
    appendFileSync(tmuxLog, row.slice(100) + '\n');
    assert.deepEqual((await tmuxSeen)[0].argv, ['-L', 'oats', 'list-sessions']);
    appendFileSync(tmuxLog, 'not json\n');
    assert.throws(() => s.tmuxCalls(), SyntaxError, 'a terminated tmux line that does not parse still throws');
  } finally { await s.stop(); }
});

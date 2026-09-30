import test from 'node:test';
import assert from 'node:assert/strict';
import { handOff } from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace, workspaceGeneration } from '../renderer/views/common.mjs';

const home = '/srv/agents/dev/instances/far-a';
const row = (extra = {}) => ({ instance: 'far-a', agent: 'dev', agentsRoot: '/srv/agents', home, server: 'build', addressable: true, running: true, ...extra });
const ref = { instance: 'far-a', home, server: 'build' };
function fixture(panels, { onPoll = () => {} } = {}) {
  let polls = 0; const asked = [];
  const s = { waitOpts: { tries: 4, delayMs: 0, sleep: async () => {} }, ctx: { connectionGeneration: () => 0,
    api: path => { asked.push(path); onPoll(polls); const p = panels[Math.min(polls++, panels.length - 1)]; return Promise.resolve({ ok: true, status: 200, json: async () => p }); } } };
  return { s, asked, polls: () => polls };
}

test('handOff: switches to the member\'s workspace, waits for its row by server and home, then acts on that row', async () => {
  const previous = currentWorkspace(); setWorkspace('/w');
  try {
    const twin = row({ home: '/srv/agents/qa/instances/far-a' });
    const f = fixture([{ instances: [twin] }, { instances: [twin, row()] }]);
    let acted = null;
    const done = await handOff(f.s, { workspace: 'remote:build:1', ref, then: found => { acted = found; } });
    assert.equal(done, true); assert.equal(currentWorkspace(), 'remote:build:1');
    assert.equal(acted.home, home, 'the same-named twin under another soul was not taken');
    assert.ok(f.asked.every(p => p.includes('ws=remote%3Abuild%3A1')));
  } finally { setWorkspace(previous); }
});

test('handOff: "present" accepts a stopped row (Show in roster); the default waits for an openable one', async () => {
  const previous = currentWorkspace(); setWorkspace('remote:build:1');
  try {
    const stopped = { instances: [row({ running: false })] };
    const gen = workspaceGeneration();
    let acted = null;
    assert.equal(await handOff(fixture([stopped]).s, { workspace: 'remote:build:1', ref, present: true, then: found => { acted = found; } }), true);
    assert.equal(acted.running, false);
    assert.equal(workspaceGeneration(), gen, 'already there: no workspace switch');
    acted = 'untouched';
    assert.equal(await handOff(fixture([stopped]).s, { workspace: 'remote:build:1', ref, then: found => { acted = found; } }), false);
    assert.equal(acted, null, 'not openable: then hears null, so the caller can say so');
  } finally { setWorkspace(previous); }
});

test('handOff: the workspace changes mid-wait: it gives up quietly and never acts', async () => {
  const previous = currentWorkspace(); setWorkspace('/w');
  try {
    const f = fixture([{ instances: [] }, { instances: [row()] }], { onPoll: n => { if (n === 0) setWorkspace('/elsewhere'); } });
    let called = false;
    assert.equal(await handOff(f.s, { workspace: 'remote:build:1', ref, then: () => { called = true; } }), false);
    assert.equal(called, false); assert.equal(currentWorkspace(), '/elsewhere');
  } finally { setWorkspace(previous); }
});

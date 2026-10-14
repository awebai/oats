// Discovery must agree with the existing sorted public inventory. Content
// streaming does not authorize changing precedence for colliding native IDs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SESSION_FORMATS } from '../lib/formats.mjs';
import { RecordStore } from '../lib/store.mjs';
import { captureSessions } from '../lib/capture-cc.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), 'capture-discovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}
function file(path, text = 'fixture') {
  fs.mkdirSync(join(path, '..'), { recursive: true });
  fs.writeFileSync(path, JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', text }) + '\n');
}
function reverseRawDirectoryOrder() {
  const original = fs.opendirSync;
  fs.opendirSync = (...args) => {
    const dir = original(...args), entries = [];
    for (let e; (e = dir.readSync()) !== null;) entries.push(e);
    entries.sort((a, b) => b.name.localeCompare(a.name));
    let i = 0;
    dir.readSync = () => entries[i++] ?? null;
    return dir;
  };
  syncBuiltinESMExports();
  return () => { fs.opendirSync = original; syncBuiltinESMExports(); };
}

test('background discovery preserves public per-directory order for all native formats', t => {
  const base = fixture(t), restore = reverseRawDirectoryOrder();
  try {
    for (const format of ['cc', 'pi', 'codex']) {
      for (const count of [8, 180]) {
        const root = join(base, format, String(count));
        for (let i = count - 1; i >= 0; i--) file(join(root, 'Z-project', `${i % 2 ? 'É' : 'a'}-${i}.jsonl`));
        file(join(root, 'a-project', 'z.jsonl')); file(join(root, 'a-project', 'A.jsonl'));
        if (format === 'cc') file(join(root, 'a-project', 'parent', 'subagents', 'agent-z.jsonl'));
        if (format === 'codex') file(join(root, 'a-project', 'month', 'day', 'nested.jsonl'));
        const fmt = SESSION_FORMATS[format], expected = fmt.listFiles([root]);
        assert.equal(expected.length, count + (format === 'pi' ? 2 : 3));
        assert.deepEqual([...fmt.iterateFiles([root])], expected, `${format}/${count}`);
      }
    }
  } finally { restore(); }
});

test('existing native-ID collision precedence stays aligned with sorted profiles and projects', t => {
  const base = fixture(t), home = join(base, 'home');
  for (const profile of ['.claude-Z', '.claude-a']) for (const project of ['Z', 'a']) {
    file(join(home, profile, 'projects', project, 'same.jsonl'), `${profile}/${project}`);
  }
  const roots = SESSION_FORMATS.cc.defaultRoots(home, {});
  const expected = SESSION_FORMATS.cc.listFiles(roots), restore = reverseRawDirectoryOrder();
  try {
    assert.deepEqual([...SESSION_FORMATS.cc.iterateFiles(roots)], expected);
    const store = new RecordStore(join(base, 'record'), { owner: 'fixture' });
    const result = captureSessions(store, { owner: 'fixture', roots });
    assert.equal(result.appended, 1);
    assert.equal(result.complete, false, 'collision remains an unresolved fault');
    const turns = store.readStream('fixture~cc.same');
    assert.equal(turns.length, 1);
    assert.equal(turns[0].body.line + '\n', fs.readFileSync(expected[0], 'utf8'));
  } finally { restore(); }
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';

const tables = ['turns', 'turn_text', 'tombstones', 'tags', 'outfits', 'segments', 'spawns', 'index_state', 'index_bytes'];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'record-reset-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  const index = new RecordIndex(store);
  t.after(() => { index.close(); rmSync(root, { recursive: true, force: true }); });
  index.db.exec(`INSERT INTO turns VALUES ('id','2026-01-01','fixture',NULL,'thread','note','test','projected','fixture~a',0,0,0);
    INSERT INTO turn_text VALUES ('id', 'body', 'user', 'searchable');
    INSERT INTO tombstones VALUES ('gone','fixture');
    INSERT INTO tags VALUES ('tag','id','turn','[]',NULL,'note');
    INSERT INTO outfits VALUES ('outfit','task','open','[]');
    INSERT INTO segments VALUES ('segment','thread',1,2,'session','done','[]','[]',NULL,'2026-01-01',0);
    INSERT INTO spawns VALUES ('spawn','thread','outfit',NULL,NULL,NULL,'2026-01-01');
    INSERT INTO index_state VALUES ('fixture~a',1);
    INSERT INTO index_bytes VALUES ('fixture~a',100,1,'epoch');
    INSERT INTO meta VALUES ('owner','fixture');`);
  return { root, store, index };
}
const schema = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
const rows = db => tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());

test('reset preserves the complete schema and owner, with truncate clears and FTS recreation', t => {
  const { index } = fixture(t), before = schema(index.db), exec = index.db.exec.bind(index.db), statements = [];
  // This guards the work reason, not just the resulting empty row count.
  for (const table of tables.filter(name => name !== 'turn_text')) {
    const instructions = index.db.prepare(`EXPLAIN DELETE FROM ${table}`).all().map(row => row.opcode);
    assert.ok(instructions.includes('Clear'), `${table} uses SQLite's truncate operation`);
    assert.equal(instructions.includes('Next'), false, `${table} does not walk rows`);
  }
  index.db.exec = sql => { statements.push(sql); return exec(sql); };
  index.reset();
  assert.ok(statements.includes('DROP TABLE turn_text'));
  assert.equal(statements.includes('DELETE FROM turn_text'), false);
  assert.deepEqual(schema(index.db), before);
  assert.deepEqual(rows(index.db), tables.map(() => []));
  assert.equal(index.recordOwner(), 'fixture');
  assert.equal(index.db.prepare('PRAGMA user_version').get().user_version, 1);
  index.db.exec("INSERT INTO turn_text VALUES ('new','body','user','afterreset')");
  assert.equal(index.db.prepare("SELECT count(*) AS n FROM turn_text WHERE turn_text MATCH 'afterreset'").get().n, 1);
});

test('every reset mutation rolls back together on failure, including FTS drop/recreation', t => {
  const { index } = fixture(t), before = schema(index.db), contents = rows(index.db), exec = index.db.exec.bind(index.db);
  const steps = [];
  index.db.exec = sql => { steps.push(sql); return exec(sql); };
  // Discover the transaction's mutation boundaries with a rollback at commit.
  index.db.exec = sql => { if (sql === 'COMMIT') throw Error('injected commit'); steps.push(sql); return exec(sql); };
  assert.throws(() => index.reset(), /injected commit/);
  for (const fail of steps.filter(sql => sql !== 'BEGIN' && sql !== 'ROLLBACK')) {
    index.db.exec = sql => { const result = exec(sql); if (sql === fail) throw Error('injected mutation'); return result; };
    assert.throws(() => index.reset(), /injected mutation/);
    assert.deepEqual(schema(index.db), before);
    assert.deepEqual(rows(index.db), contents);
    assert.equal(index.db.prepare('PRAGMA user_version').get().user_version, 1);
  }
  index.db.exec = exec;
  index.reset();
  assert.deepEqual(rows(index.db), tables.map(() => []));
});

test('an already-open reader sees the old union during reset and the empty union after commit', t => {
  const { index, store } = fixture(t), reader = new RecordIndex(store), exec = index.db.exec.bind(index.db);
  t.after(() => reader.close());
  const before = rows(reader.db);
  reader.db.exec('PRAGMA busy_timeout = 0');
  index.db.exec = sql => {
    const result = exec(sql);
    if (sql === 'DROP TABLE turn_text') {
      reader.db.exec('BEGIN');
      try { assert.deepEqual(rows(reader.db), before); } finally { reader.db.exec('ROLLBACK'); }
      assert.throws(() => reader.db.exec('BEGIN IMMEDIATE'), /locked/);
    }
    return result;
  };
  index.reset();
  assert.deepEqual(rows(reader.db), tables.map(() => []));
  assert.equal(reader.db.prepare('PRAGMA user_version').get().user_version, 1);
  reader.db.exec("INSERT INTO turn_text VALUES ('id','body','user','afterreset')");
  assert.equal(reader.db.prepare("SELECT count(*) AS n FROM turn_text WHERE turn_text MATCH 'afterreset'").get().n, 1);
});

test('a killed reset transaction recovers the complete previous union on reopening', async t => {
  const { root, index } = fixture(t), before = rows(index.db), definitions = schema(index.db);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { RecordStore } from ${JSON.stringify(resolve(import.meta.dirname, '../lib/store.mjs'))};
    import { RecordIndex } from ${JSON.stringify(resolve(import.meta.dirname, '../lib/index-db.mjs'))};
    const index = new RecordIndex(new RecordStore(${JSON.stringify(root)}, {owner:'fixture'}));
    const exec = index.db.exec.bind(index.db);
    index.db.exec = sql => { const result = exec(sql); if(sql === 'DROP TABLE turn_text') process.kill(process.pid, 'SIGKILL'); return result; };
    index.reset();
  `], { env: { HOME: root, TMPDIR: root, PATH: process.env.PATH }, stdio: ['ignore','ignore','pipe'], timeout: 10000 });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.equal(result.signal, 'SIGKILL', stderr);
  assert.deepEqual(rows(index.db), before);
  assert.deepEqual(schema(index.db), definitions);
  index.reset();
  assert.deepEqual(rows(index.db), tables.map(() => []));
});

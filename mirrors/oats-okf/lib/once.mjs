// `oats okf harvest --once` (okf 4.1.0): one reviewed harvest of one seat from
// an explicit, hash-verified record set, run by the operator. It registers
// nothing (no home pointer, no schedule, no capture); its custody is a source
// descriptor marked `once`, so the normal judgment, publication and review
// path (and the okf-harvest wrappers, which accept only sources/<id>/) apply.
import { fs, join, dirname, resolve, safePath, readJSON, save, hash, fail, within, relPath, withLock } from './io.mjs';
import { describeSeat, sourceFor, installSource, loadSource, loadStatus, input, inputCounts } from './sources.mjs';
import { soulHarvest } from './harvest-switch.mjs';
import { runSource, readRun } from './worker.mjs';

const MANIFEST_KEYS = ['version', 'instance', 'roots', 'notes', 'sessions'];
const MAX_ENTRIES = 2000, MAX_FILE = 16 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024;
const records = message => fail('E_RECORDS', message);

/** Where a file the manifest names is: inside one of `roots`, named relative
 *  to it (the receipt and provenance never carry paths). → {target, name} */
function locate(path, roots) {
  const target = resolve(path);
  const root = roots.find(r => within(r, target) && target !== r);
  if (!root) fail('E_PATH', `${path} is outside the home and the manifest's roots`);
  return { target, name: relPath(target.slice(root.length + 1)) };
}

/** Read a located file: a regular, single-link file reached through no
 *  symlink. Its bytes are read once, and only those bytes are hashed and used. */
function readEntry(path, target) {
  try { safePath(target); } catch (e) { if (e.code === 'E_PATH') fail('E_PATH', `${path}: symlink not allowed (${e.message})`); throw e; }
  let stat;
  try { stat = fs.lstatSync(target); } catch { fail('E_PATH', `${path}: no such file`); }
  if (!stat.isFile()) fail('E_PATH', `${path}: not a regular file (no directories, no globbing)`);
  if (stat.nlink !== 1) fail('E_PATH', `${path}: hardlink not allowed`);
  if (stat.size > MAX_FILE) records(`${path} exceeds ${MAX_FILE} bytes`);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd); } finally { fs.closeSync(fd); }
}

/** The manifest file, parsed. → {manifest, manifestHash} */
function loadManifest(file) {
  if (typeof file !== 'string' || !file.startsWith('/')) fail('E_USAGE', '--records must be an absolute manifest path');
  safePath(file);
  let manifest; try { manifest = readJSON(file); } catch (e) { records(`manifest unreadable: ${e.code || e.message}`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) records('manifest must be a JSON object');
  return { manifest, manifestHash: hash(manifest) };
}

/** Validate a manifest and read every entry it names, all before anything is
 *  stored. `refuseHeld` sees every entry's {name, sha256} before any note is
 *  read. → notes:[{name, sha256, text}] */
function readManifest(manifest, home, instance, refuseHeld) {
  const unknown = Object.keys(manifest).filter(k => !MANIFEST_KEYS.includes(k));
  if (unknown.length) records(`unknown manifest keys: ${unknown.join(', ')}`);
  if (manifest.version !== 1) records('manifest version must be 1');
  if (manifest.instance !== instance) records(`manifest instance ${JSON.stringify(manifest.instance)} is not the seat's instance ${instance}`);
  if (manifest.sessions !== undefined && (!Array.isArray(manifest.sessions) || manifest.sessions.length)) {
    // Session records come into the turn record through the kernel; okf never
    // parses harness formats itself.
    fail('E_UNSUPPORTED', 'session entries need the kernel feature capture-file (`oats capture --file`), which this OATS does not offer yet; harvest the notes now, the sessions with a later oats.okf');
  }
  if (!Array.isArray(manifest.notes) || !manifest.notes.length) records('manifest needs a non-empty notes list');
  if (manifest.notes.length > MAX_ENTRIES) records(`at most ${MAX_ENTRIES} entries`);
  if (manifest.roots !== undefined && !Array.isArray(manifest.roots)) records('roots must be a list of absolute directories');
  const roots = [fs.realpathSync(home)];
  for (const root of manifest.roots || []) {
    if (typeof root !== 'string' || !root.startsWith('/')) records('every root must be an absolute directory');
    try { safePath(root); } catch (e) { if (e.code === 'E_PATH') fail('E_PATH', `root ${root}: symlink not allowed`); throw e; }
    if (!fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) fail('E_PATH', `root ${root} is not a directory`);
    roots.push(resolve(root));
  }
  const seen = new Set(), located = []; let total = 0;
  for (const entry of manifest.notes) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(k => !['path', 'sha256'].includes(k))) records('a note entry is {path, sha256}');
    if (typeof entry.path !== 'string' || !entry.path) records('a note entry needs a path');
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) records(`${entry.path}: sha256 must be 64 lowercase hex`);
    if (!entry.path.endsWith('.md')) records(`${entry.path}: notes are .md files`);
    // A relative path is in the home: no `..`, no climbing into a listed root.
    if (!entry.path.startsWith('/')) relPath(entry.path);
    const path = entry.path.startsWith('/') ? entry.path : join(home, entry.path);
    if (seen.has(resolve(path))) records(`${entry.path}: duplicate entry`);
    seen.add(resolve(path));
    located.push({ ...locate(path, roots), path: entry.path, sha256: entry.sha256 });
  }
  refuseHeld(located.map(({ name, sha256 }) => ({ name, sha256 })));
  return located.map(({ target, name, path, sha256 }) => {
    const bytes = readEntry(path, target);
    if (hash(bytes) !== sha256) records(`sha256 mismatch for ${path} (manifest ${sha256}, file ${hash(bytes)})`);
    if ((total += bytes.length) > MAX_TOTAL) records(`entries exceed ${MAX_TOTAL} bytes in total`);
    return { name, sha256, text: bytes.toString('utf8') };
  });
}

/** A UUID-shaped id derived from what makes a one-shot the same one. */
function onceId(instance, owner, manifestHash) {
  const h = hash({ once: 1, instance, owner, manifestHash });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const receiptPath = source => join(dirname(source.file), 'once.json');
/** The seat's one-shot lock: its overlap checks and its install are one step. */
const seatLock = (stateDir, instance, owner) => join(stateDir, `once-${hash({ instance, owner }).slice(0, 16)}.lock`);
// Queue briefly behind another one-shot of the seat while it installs.
const SEAT_LOCK_WAIT_MS = 10000;

/** The soul's own opt-out, refused unless the operator overrides it.
 *  → whether an override was needed (and so applies to this run). */
function checkOptOut(soulDir, override) {
  const soul = soulHarvest(soulDir);
  if (soul.value === 'off' || !soul.readable) {
    if (override) return true;
    const why = soul.value === 'off' ? 'the soul opts out of harvest (knowledge: { harvest: off })' : `the soul's opt-out could not be read (${soul.why})`;
    fail('E_HARVEST_OFF', `${why}; nothing was harvested. To harvest this seat anyway, rerun with --override-opt-out: the override is recorded in the PR's provenance and in the receipt.`);
  }
  return false;
}

/** The directories of the seat's other one-shots. */
function otherOneShots(stateDir, self) {
  const dir = join(stateDir, 'sources');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(id => {
    if (id === self.id) return false;
    let other; try { other = readJSON(join(dir, id, 'source.json')); } catch { return false; }
    return other.once && other.instance === self.instance && other.owner === self.owner;
  }).map(id => ({ id, dir: join(dir, id) }));
}

/** Refuse manifest entries another one-shot of the same seat holds, by the
 *  name and sha256 its receipt records, before any note is read: a note
 *  edited since is still that one-shot's to continue. */
function refuseHeld(stateDir, self, entries) {
  for (const { id, dir } of otherOneShots(stateDir, self)) {
    let receipt; try { receipt = readJSON(join(dir, 'once.json')); } catch { continue; }
    const held = new Set((receipt.entries || []).map(e => `${e.sha256} ${e.name}`));
    const repeated = entries.filter(e => held.has(`${e.sha256} ${e.name}`));
    if (repeated.length) fail('E_ONCE_OVERLAP', `one-shot ${id} has held ${repeated.map(e => e.name).join(', ')} since ${receipt.verifiedAt}; its inputs are in custody (receipt ${join(dir, 'once.json')}); to continue it, rerun with its own manifest unchanged (sha256 ${receipt.manifestHash}), or list only notes it does not hold`);
  }
}

/** Refuse inputs another one-shot of the same seat already holds. */
function refuseOverlap(stateDir, self, ids) {
  for (const { id, dir } of otherOneShots(stateDir, self)) {
    // What the other one-shot holds, harvested or still to harvest: a note is
    // harvested by one one-shot only.
    let held; try { held = new Set(readJSON(join(dir, 'status.json')).captured.inputs); } catch { continue; }
    const repeated = ids.filter(i => held.has(i));
    if (repeated.length) fail('E_ONCE_OVERLAP', `${repeated.length} of these notes belong to one-shot ${id} (receipt ${join(dir, 'once.json')}), harvested or still draining; list only notes it does not hold, or rerun its own manifest to continue it`);
  }
}

function progress(source) {
  const status = loadStatus(source);
  return { ...inputCounts(status), status };
}

/** One step of a one-shot harvest: create it on the first call, then run its
 *  next bounded run; a rerun with the same manifest continues it. */
export function harvestOnce({ home, records: manifestFile, overrideOptOut = false, noLaunch = false, env = process.env }) {
  if (typeof home !== 'string' || !home.startsWith('/')) fail('E_USAGE', '--once needs --home <absolute instance home>');
  home = fs.realpathSync(safePath(home));
  const caller = env.OATS_INSTANCE_HOME;
  if (caller && fs.existsSync(caller) && fs.realpathSync(caller) === home) fail('E_INVOCATION', 'a seat does not harvest itself on demand: run harvest --once from the deployment, as the operator');
  const seat = describeSeat(home, { fromHome: true });
  const soulName = seat.meta.workspace?.soul?.name || String(seat.meta.workspace?.soul?.id || '').split('#')[1] || seat.agent;
  const named = /^name:\s*(\S+)\s*$/m.exec(fs.existsSync(join(seat.soul, 'soul.yaml')) ? fs.readFileSync(join(seat.soul, 'soul.yaml'), 'utf8') : '')?.[1]?.replace(/^['"]|['"]$/g, '');
  if (named !== soulName) fail('E_INVOCATION', `the soul given (${named || 'unnamed'}) is not this seat's soul (${soulName}); pass --soul ${soulName}`);
  const override = checkOptOut(seat.soul, overrideOptOut);
  const { manifest, manifestHash } = loadManifest(manifestFile);
  const id = onceId(seat.instance, seat.decl.owner, manifestHash), stateDir = seat.bindings.stateDir;
  const source = withLock(seatLock(stateDir, seat.instance, seat.decl.owner), () => {
    const planned = sourceFor(id, seat);
    // The receipt is written last: a one-shot without it was interrupted while
    // installing, and is installed again from the re-verified manifest. One
    // with it continues from custody (its inputs are verified on read), never
    // from the listed notes, which may have changed since.
    if (fs.existsSync(receiptPath(planned))) {
      const recorded = readJSON(receiptPath(planned)).manifestHash;
      if (recorded !== manifestHash) fail('E_RECORDS', `one-shot ${id} was started from manifest ${recorded}, not this one (${manifestHash}); its inputs are in custody (receipt ${receiptPath(planned)}); rerun with the manifest it was started from, unchanged, to continue it`);
      return loadSource(planned.file);
    }
    const notes = readManifest(manifest, home, seat.instance, entries => refuseHeld(stateDir, planned, entries));
    const payloads = notes.map(n => ({ version: 1, kind: 'note', name: n.name, contentHash: hash(n.text), text: n.text }));
    const ids = payloads.map(p => hash(p));
    refuseOverlap(stateDir, planned, ids);
    const source = { ...planned, once: { manifestHash, entries: notes.length } };
    for (const payload of payloads) save(join(dirname(source.file), 'inputs', `${hash(payload)}.json`), payload);
    installSource(source, { marker: false, status: { auto: false, captured: { notes: [], threads: {}, inputs: ids } } });
    save(receiptPath(source), { version: 1, manifestHash, verifiedAt: new Date().toISOString(),
      entries: notes.map(n => ({ kind: 'note', name: n.name, sha256: n.sha256 })), inputs: ids, runs: [] });
    return source;
  }, { waitMs: SEAT_LOCK_WAIT_MS, reclaimDead: true });
  for (const i of loadStatus(source).captured.inputs) input(source, i); // re-verify durable evidence
  const before = progress(source);
  if (!before.remaining && !before.status.activeRun) return answer(source, { status: 'already-delivered' });
  // An opt-out override is the run's: a soul may opt out between two runs.
  const result = runSource(source, { manual: true, noLaunch, runFields: { once: { override } } });
  const receipt = readJSON(receiptPath(source));
  if (result.run && !receipt.runs.some(r => r.run === result.run)) { receipt.runs.push({ run: result.run, override: readRun(source, result.run).once?.override ?? false }); save(receiptPath(source), receipt); }
  return answer(source, result);
}

function answer(source, result) {
  const { total, processed, remaining, status } = progress(source);
  const run = result.run ? readRun(source, result.run) : null;
  const pending = run ? total - processed - (status.activeRun === run.id ? run.inputs.length : 0) : remaining;
  const next = result.status === 'already-delivered'
    ? 'every listed note was harvested; nothing to do'
    : pending > 0 ? `${pending} inputs remain; rerun the same command to continue once this run is processed` : 'this run holds the last inputs';
  return { ...result, source: source.file, once: { ...source.once, override: run?.once?.override ?? false }, inputs: { total, processed, remaining: pending }, delivered: status.delivered, next };
}

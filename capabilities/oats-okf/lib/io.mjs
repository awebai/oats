import * as fs from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join, sep, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
export { fs, join, resolve, dirname };
export const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJSON = path => JSON.parse(fs.readFileSync(path, 'utf8'));
export const within = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)); };
export const overlaps = (a, b) => within(a, b) || within(b, a);
export function safePath(path) {
  path = resolve(path);
  let part = path;
  while (true) {
    try { if (fs.lstatSync(part).isSymbolicLink()) fail('E_PATH', `symlink not allowed: ${part}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (dirname(part) === part) break;
    part = dirname(part);
  }
  return path;
}
export function relPath(p, dot = false) {
  if (typeof p !== 'string' || (!dot && p === '.') || !p || p.includes('\\') || p.includes('\0') || isAbsolute(p) || p.split('/').some(x => !x || x === '..' || (x === '.' && p !== '.')) || p.split('/').some(x => x === '.git')) fail('E_PATH', `noncanonical relative path: ${p}`);
  return p;
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value) || ['constructor','__proto__','prototype','toString','valueOf'].includes(value)) fail('E_ID', `invalid identity: ${value}`);
  return value;
}
export function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
export function atomic(path, bytes, { tempDir = dirname(path) } = {}) {
  safePath(path); fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Publication may stage in its owned lock directory, outside accepted data.
  safePath(tempDir);
  const temp = join(tempDir, `${basename(path)}.tmp-${randomUUID()}`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, path); syncDir(dirname(path));
}
export const save = (path, obj) => atomic(path, JSON.stringify(obj, null, 2) + '\n');
export function tree(root, { git = false } = {}) {
  safePath(root); const files = {};
  function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (git && dir === root && d.name === '.git') continue;
      const path = join(dir, d.name); safePath(path);
      if (d.isDirectory()) walk(path);
      else if (d.isFile()) { if (fs.statSync(path).nlink !== 1) fail('E_PATH', `hardlink not allowed: ${path}`); files[relative(root, path).split(sep).join('/')] = fs.readFileSync(path).toString('base64'); }
      else fail('E_PATH', `unsupported entry: ${path}`);
    }
  }
  walk(root); return files;
}
export const digest = files => hash(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
export function materialize(root, files) {
  safePath(root); fs.mkdirSync(root, { recursive: true });
  for (const [p, content] of Object.entries(files)) atomic(join(root, relPath(p)), Buffer.from(content, 'base64'));
}
export function withLock(path, fn) {
  safePath(path); fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(path, { mode: 0o700 }); } catch(e) { if(e.code === 'EEXIST') fail('E_LOCKED', `busy or abandoned lock: ${path}; inspect owner.json, never reclaim by age`); throw e; }
  const owner = { token: randomUUID(), pid: process.pid, host: hostname() };
  save(join(path, 'owner.json'), owner);
  try { return fn(); } finally { if (readJSON(join(path, 'owner.json')).token === owner.token) { fs.rmSync(path, { recursive: true }); syncDir(dirname(path)); } }
}
export function unlock(path, token) {
  safePath(path); const o = readJSON(join(path, 'owner.json'));
  if (!token || o.token !== token || o.host !== hostname()) fail('E_LOCKED', 'explicit matching local lock token required');
  try { process.kill(o.pid, 0); fail('E_LOCKED', 'lock owner is still alive'); } catch (e) { if(e.code !== 'ESRCH') throw e; }
  fs.rmSync(path, { recursive: true }); syncDir(dirname(path)); return { unlocked: path };
}
export const identityKeys = ['OATS_INSTANCE','OATS_INSTANCE_HOME','OATS_HOME','PI_AGENT_HOME','PI_AGENT_NAME','PI_AGENT_INSTANCE','PI_AGENTS_ROOT','OATS_ROOT','OATS_SOUL','OATS_AGENT','OATS_KIND','OATS_EVENT','OATS_CONTEXT','OATS_REPO','OATS_WORK','OATS_BRANCH','OATS_META','OATS_SETTINGS','OATS_BINDING_FILE','OATS_SOURCE_RECEIPT_FILE','OATS_INVOCATION_CONTEXT_FILE','OATS_DEPLOYMENT','OATS_RESOLUTION'];
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^(OATS_(?!HOME_DIR$|PACKAGE_CATALOG$)|PI_AGENT|GIT_)/.test(k)));
}
export function exec(bin, args, { cwd, env = cleanEnv(), timeout = 30000, maxBuffer = 16*1024*1024, acceptedStatus = [0] } = {}) {
  const r = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer });
  if(r.error || !acceptedStatus.includes(r.status)) throw Object.assign(new Error(`${bin} ${args[0]} failed: ${r.error?.message || r.stderr || `exit ${r.status}`}`),{code:'E_COMMAND',stdout:r.stdout,status:r.status});
  return r.stdout.trim();
}
export function cliPath() {
  const p = process.env.OATS_CLI_BIN;
  if (!p || !isAbsolute(p)) fail('E_RUNTIME', 'absolute OATS_CLI_BIN required; never resolve oats on PATH');
  return p;
}
export function oats(args, cwd, { native = false, ...opts } = {}) {
  let text;
  try {text = exec(cliPath(), args, { cwd, ...opts });}
  catch(e) {
    let response;try {response=JSON.parse(e.stdout);} catch { /* unknown side effect, preserve command failure */ }
    if(response?.schemaVersion===1 && response.ok===false) fail(response.error?.code || 'E_RUNTIME',response.error?.message || 'CLI failed');
    throw e;
  }
  let o; try { o = JSON.parse(text); } catch { fail('E_RUNTIME', 'unsupported CLI JSON response'); }
  if(native) return o;
  if(o.schemaVersion !== 1 || o.ok !== true) fail(o.error?.code || 'E_RUNTIME', o.error?.message || 'unsupported CLI envelope');
  return o.result;
}
export const quote = v => `'${String(v).replaceAll("'", "'\\''")}'`;
export function command(cwd, argv) {
  return `cd ${quote(cwd)} && env ${identityKeys.map(k => `-u ${quote(k)}`).join(' ')} ${[cliPath(), ...argv].map(quote).join(' ')}`;
}

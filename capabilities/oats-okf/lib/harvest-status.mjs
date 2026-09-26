// `oats okf harvest-status` and `oats okf setup --harvest on|off` (okf 4.0.0).
import { fs, join, dirname, resolve, readJSON, atomic, fail } from './io.mjs';
import { settings, loadBindings } from './config.mjs';
import { harvestSwitch } from './harvest-switch.mjs';
import { markerPath, harvestOffRecord } from './sources.mjs';

const SOURCE_LIMIT = 500;
/** The registered sources in the bound state directory, optionally for one soul. */
function registeredSources(soul) {
  let bindings;
  try { bindings = loadBindings(); } catch (e) { return { error: `${e.code || 'E_CONFIG'}: ${e.message}` }; }
  const dir = join(bindings.stateDir, 'sources');
  if (!fs.existsSync(dir)) return { stateDir: bindings.stateDir, sources: [] };
  const rows = [];
  for (const id of fs.readdirSync(dir).sort()) {
    if (rows.length >= SOURCE_LIMIT) return { stateDir: bindings.stateDir, sources: rows, truncated: true };
    let source, status;
    try { source = readJSON(join(dir, id, 'source.json')); status = readJSON(join(dir, id, 'status.json')); } catch { continue; }
    if (soul && source.agent !== soul) continue;
    rows.push({ id, soul: source.agent, instance: source.instance, created: source.created, retired: status.retired === true, auto: status.auto === true, activeRun: status.activeRun || null, schedule: status.schedule?.id || null, file: join(dir, id, 'source.json') });
  }
  return { stateDir: bindings.stateDir, sources: rows };
}
export function harvestStatus({ home, flags = {} }) {
  const sw = harvestSwitch({ settings: settings(), soulDir: process.env.OATS_SOUL });
  const soul = flags.soul || process.env.OATS_AGENT || null;
  const inHome = !!process.env.OATS_INSTANCE_HOME && fs.existsSync(join(home, 'instance.json'));
  const instance = inHome ? { home, registered: fs.existsSync(markerPath(home)), spawnedWith: fs.existsSync(markerPath(home)) ? 'on' : harvestOffRecord(home) ? 'off' : 'unknown' } : null;
  return { harvest: sw.effective, reason: sw.reason, rows: sw.rows, warnings: sw.warnings, soul, instance, ...registeredSources(soul),
    note: 'harvest applies from the next spawn: switching it on never captures earlier sessions, and switching it off stops run-source capture for registered sources. `oats schedule disable okf-<source>` is the per-source emergency brake.' };
}

/** Find the deployment's oats-local.yaml: OATS_WORKSPACE, else up from cwd. */
function localFile() {
  const candidates = [];
  if (process.env.OATS_WORKSPACE) candidates.push(join(process.env.OATS_WORKSPACE, 'oats-local.yaml'));
  for (let d = resolve(process.cwd()); ; d = dirname(d)) { candidates.push(join(d, 'oats-local.yaml')); if (dirname(d) === d) break; }
  return candidates.find((f) => fs.existsSync(f)) || null;
}
/** Edit `settings: / oats.okf: / harvest:` in block style; null when the file
 *  has any shape this small editor will not touch (then the line is printed). */
export function editLocalYaml(text, value) {
  if (/\t/.test(text)) return null;
  const lines = text.split('\n');
  const top = (i) => /^\S/.test(lines[i]) && !/^#/.test(lines[i]);
  const s = lines.findIndex((l) => /^settings\s*:/.test(l));
  if (s < 0) {
    const tail = text.endsWith('\n') || text === '' ? '' : '\n';
    return `${text}${tail}settings:\n  oats.okf:\n    harvest: ${value}\n`;
  }
  if (lines[s].replace(/^settings\s*:/, '').replace(/\s+#.*$/, '').trim() !== '') return null;
  let end = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (top(i)) { end = i; break; }
  let o = -1, childIndent = null;
  for (let i = s + 1; i < end; i++) {
    const m = /^(\s+)(['"]?)oats\.okf\2\s*:(.*)$/.exec(lines[i]);
    if (m) { if (m[3].replace(/\s+#.*$/, '').trim() !== '') return null; o = i; childIndent = m[1].length; break; }
  }
  if (o < 0) {
    const first = lines.slice(s + 1, end).find((l) => /^\s+\S/.test(l) && !/^\s*#/.test(l));
    const ind = first ? /^(\s+)/.exec(first)[1] : '  ';
    lines.splice(s + 1, 0, `${ind}oats.okf:`, `${ind}  harvest: ${value}`);
    return lines.join('\n');
  }
  let blockEnd = end, keyIndent = null;
  for (let i = o + 1; i < end; i++) {
    if (/^\s*(#.*)?$/.test(lines[i])) continue;
    const lead = /^(\s*)/.exec(lines[i])[1].length;
    if (lead <= childIndent) { blockEnd = i; break; }
    if (keyIndent === null) keyIndent = lead;
    if (lead === keyIndent && /^\s*harvest\s*:/.test(lines[i])) { lines[i] = `${' '.repeat(lead)}harvest: ${value}`; return lines.join('\n'); }
  }
  lines.splice(o + 1, 0, `${' '.repeat(keyIndent ?? childIndent + 2)}harvest: ${value}`);
  return lines.join('\n');
}
export function setupHarvest(value) {
  if (!['on', 'off'].includes(value)) fail('E_USAGE', '--harvest must be on or off');
  const line = `settings:\n  oats.okf:\n    harvest: ${value}`;
  const file = localFile();
  const note = value === 'on'
    ? 'Harvest applies to new spawns of souls that do not opt out (knowledge: { harvest: off }). Earlier sessions are never captured. Run `oats okf harvest-status` to confirm.'
    : 'New spawns register no source. Registered sources stop capturing at their next run-source. Nothing is deleted.';
  if (!file) return { written: false, harvest: value, reason: 'no oats-local.yaml found (OATS_WORKSPACE or up from the current directory)', add: line, note };
  const edited = editLocalYaml(fs.readFileSync(file, 'utf8'), value);
  if (edited === null) return { written: false, file, harvest: value, reason: 'oats-local.yaml has a shape this command does not edit (flow style or tabs); add the line by hand', add: line, note };
  atomic(file, edited);
  return { written: true, file, harvest: value, note };
}

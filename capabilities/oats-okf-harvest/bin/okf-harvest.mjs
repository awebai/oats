#!/usr/bin/env node
// oats.okf-harvest: the harvester's two commands. Both are thin: the delivery
// code lives in oats.okf (a capability module is fetched per directory, so it
// cannot import oats.okf's lib), and `complete` runs the source's frozen
// `oats okf complete` from the source deployment, never from this home.
import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `oats okf-harvest complete --source FILE --run ID --judgment ABS_FILE [--json]
oats okf-harvest harvest-status --source FILE --run ID [--json]
complete runs the source's frozen \`oats okf complete\` in its deployment (the
only delivery path). harvest-status reports each PR's state and what to do:
stay, retire or max-age (setting harvester-max-age, default 7d).
`;
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, ...extra }); };
const IDENTITY = /^(OATS_(?!HOME_DIR$|PACKAGE_CATALOG$)|PI_AGENT|GIT_)/;

export function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) fail('E_USAGE', `unexpected argument ${a}`);
    const k = a.slice(2);
    if (k in flags) fail('E_USAGE', `duplicate --${k}`);
    if (!allowed.includes(k)) fail('E_USAGE', `unknown flag --${k}`);
    if (k === 'json') { flags.json = true; continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail('E_USAGE', `--${k} needs a value`);
    flags[k] = args[++i];
  }
  return flags;
}
const readJson = (file, what) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail('E_SOURCE', `${what} is unreadable: ${file} (${e.code || e.message})`); }
};
/** The frozen source descriptor: <stateDir>/sources/<uuid>/source.json. */
export function readSource(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file) fail('E_USAGE', '--source must be an absolute descriptor path');
  if (basename(file) !== 'source.json' || !/^[0-9a-f-]{36}$/.test(basename(dirname(file))) || basename(dirname(dirname(file))) !== 'sources') fail('E_SOURCE', 'not an OKF source descriptor path (<stateDir>/sources/<id>/source.json)');
  if (lstatSync(file, { throwIfNoEntry: false })?.isFile() !== true) fail('E_SOURCE', `source descriptor missing: ${file}`);
  const s = readJson(file, 'source descriptor');
  if (s?.version !== 1 || s.id !== basename(dirname(file)) || typeof s.context !== 'string' || !isAbsolute(s.context) || typeof s.agent !== 'string') fail('E_SOURCE', 'invalid source descriptor');
  return s;
}
export function readRun(source, file, id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail('E_USAGE', '--run must be a run id');
  const run = readJson(join(dirname(file), 'runs', id, 'run.json'), 'run');
  if (run?.id !== id || run.source !== source.id) fail('E_RUN', 'run identity mismatch');
  return run;
}
/** The completion argv, exactly as oats.okf's completionArgv freezes it. */
export function completionArgv(source, file, run, judgment) {
  const tail = ['okf', 'complete', '--source', file, '--run', run, '--judgment', judgment];
  const e = source.executionBinding;
  if (e !== undefined) {
    if (e?.schemaVersion !== 1 || typeof e.deployment !== 'string' || !isAbsolute(e.deployment) || !/^sha256-[a-f0-9]{64}$/.test(e.resolution?.id || '')) fail('E_SOURCE', 'invalid captured completion execution binding');
    return ['--deployment', e.deployment, '--resolution', e.resolution.id, ...tail, '--json'];
  }
  return [...tail, '--soul', source.agent, '--json'];
}
// A refusal meaning oats.okf cannot run for the source soul in its deployment.
const INACTIVE = new Set(['E_CAPABILITY_INACTIVE', 'E_CAPABILITY_BLOCKED', 'E_CAPABILITY_MISSING', 'E_PACKAGE_MISSING', 'E_PACKAGE_INTEGRITY', 'E_SOUL_UNKNOWN', 'E_SOUL_DISABLED', 'E_UNKNOWN_COMMAND']);
export function complete(flags, env = process.env) {
  for (const k of ['source', 'run', 'judgment']) if (!flags[k]) fail('E_USAGE', `--${k} is required`);
  if (!isAbsolute(flags.judgment)) fail('E_USAGE', '--judgment must be an absolute path');
  const source = readSource(flags.source);
  readRun(source, flags.source, flags.run);
  const cli = env.OATS_CLI_BIN;
  if (!cli || !isAbsolute(cli)) fail('E_RUNTIME', 'absolute OATS_CLI_BIN required; never resolve oats on PATH');
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !IDENTITY.test(k)));
  const argv = completionArgv(source, flags.source, flags.run, flags.judgment);
  const r = spawnSync(cli, argv, { cwd: source.context, env: clean, encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  let answer; try { answer = JSON.parse(r.stdout); } catch { /* below */ }
  if (answer?.schemaVersion === 1 && answer.ok === true) return { deployment: source.context, ...answer.result };
  const code = answer?.error?.code || 'E_COMPLETE', message = answer?.error?.message || (r.error?.message || r.stderr || `exit ${r.status}`).trim();
  if (INACTIVE.has(code)) fail('E_SOURCE_INACTIVE', `oats.okf cannot run for source soul ${source.agent} in ${source.context} (${code}: ${message}). Nothing was published: report this to the okf team and your operator, and stay.`, { cause: code });
  fail(code, `${message} (completion ran in ${source.context}; keep your home and report)`);
}
/** "7d" | "48h" | "90m" | seconds → milliseconds. */
export function maxAgeMs(value) {
  if (value === undefined || value === null) return 7 * 86400000;
  if (Number.isInteger(value) && value > 0) return value * 1000;
  const m = /^(\d+)(m|h|d)$/.exec(String(value));
  if (!m || Number(m[1]) < 1) fail('E_CONFIG', 'harvester-max-age must be a duration like 7d, 48h or 90m, or a positive number of seconds');
  return Number(m[1]) * { m: 60000, h: 3600000, d: 86400000 }[m[2]];
}
function settings(env) {
  let s; try { s = JSON.parse(env.OATS_SETTINGS || '{}'); } catch { fail('E_CONFIG', 'OATS_SETTINGS is not JSON'); }
  return s && typeof s === 'object' ? s : {};
}
function prState(pr, env) {
  const r = spawnSync('gh', ['pr', 'view', pr.url, '--json', 'state,mergedAt,closedAt,url,number'], { encoding: 'utf8', timeout: 60000, env: Object.fromEntries(Object.entries(env).filter(([k]) => !IDENTITY.test(k))) });
  if (r.status !== 0) return { url: pr.url, number: pr.number, state: 'UNKNOWN', error: (r.stderr || r.error?.message || `exit ${r.status}`).trim() };
  const v = JSON.parse(r.stdout);
  return { url: v.url, number: v.number, state: v.state, mergedAt: v.mergedAt || null, closedAt: v.closedAt || null };
}
export function harvestStatus(flags, env = process.env, { now = Date.now(), view = prState } = {}) {
  for (const k of ['source', 'run']) if (!flags[k]) fail('E_USAGE', `--${k} is required`);
  const source = readSource(flags.source), run = readRun(source, flags.source, flags.run);
  const limit = maxAgeMs(settings(env)['harvester-max-age']);
  const age = now - Date.parse(run.created);
  const receipts = run.receipts && typeof run.receipts === 'object' ? run.receipts : {};
  const destinations = Object.entries(receipts).map(([alias, r]) => {
    if (r?.pr?.url) return { alias, receipt: r.status, pr: view(r.pr, env) };
    return { alias, receipt: r?.status ?? null, pr: null };
  });
  const judged = !!run.judgment;
  let action, reason;
  const open = destinations.filter((d) => d.pr && !['MERGED', 'CLOSED'].includes(d.pr.state));
  const pending = destinations.filter((d) => !d.pr && !['no-change', 'accepted'].includes(d.receipt));
  if (!judged || pending.length) { action = age >= limit ? 'max-age' : 'stay'; reason = !judged ? 'the run is not completed yet' : `destinations not delivered: ${pending.map((d) => d.alias).join(', ')}`; }
  else if (open.length) { action = age >= limit ? 'max-age' : 'stay'; reason = `open PR: ${open.map((d) => d.pr.url).join(', ')}`; }
  else { action = 'retire'; reason = destinations.some((d) => d.pr) ? 'every PR is merged or closed' : 'no PR was needed (no-change or directory publication)'; }
  if (action === 'max-age') reason += `; older than harvester-max-age (${Math.round(limit / 3600000)}h): tell the okf team and retire, never close the PR`;
  return { run: run.id, status: run.status, ageSeconds: Math.round(age / 1000), maxAgeSeconds: limit / 1000, destinations, action, reason };
}
function text(event, r) {
  if (event === 'harvest-status') return [`run ${r.run} (${r.status}): ${r.action} — ${r.reason}`, ...r.destinations.map((d) => `  ${d.alias}: ${d.pr ? `${d.pr.state} ${d.pr.url}` : d.receipt}`)].join('\n');
  return `completed run ${r.run}: ${r.status}${Object.entries(r.receipts || {}).map(([a, x]) => `\n  ${a}: ${x.status}${x.pr?.url ? ` ${x.pr.url}` : ''}`).join('')}`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), event = args[0];
  if (!event || args.includes('--help') || args.includes('-h')) process.stdout.write(HELP);
  else {
    const json = args.includes('--json');
    try {
      let result;
      if (event === 'complete') result = complete(parseFlags(args.slice(1), ['source', 'run', 'judgment', 'json']));
      else if (event === 'harvest-status') result = harvestStatus(parseFlags(args.slice(1), ['source', 'run', 'json']));
      else fail('E_USAGE', `unknown command ${event}; see --help`);
      process.stdout.write((json ? JSON.stringify({ schemaVersion: 1, ok: true, result }) : text(event, result)) + '\n');
    } catch (e) {
      const code = e.code || 'E_OKF_HARVEST';
      if (json) process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: e.message } }) + '\n');
      else process.stderr.write(`oats okf-harvest ${event}: ${code}: ${e.message}\n`);
      process.exitCode = 1;
    }
  }
}

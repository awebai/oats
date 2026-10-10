#!/usr/bin/env node
// oats.okf-harvest 5.0.0: a harvester judges ONE proposal (its TASK.md) and
// publishes with plain Git and gh (skill knowledge-harvest). It has no
// delivery commands: the 4.x `complete` and `harvest-status` refuse, so an old
// 4.x TASK or worker protocol in a 5.0 harvester never runs a completion.
//
// Its one piece of code is the required spawn hook: before a harvester exists,
// it checks the source the proposal names against the deployment's own record
// and refuses a source whose recorded soul opts out (knowledge: { harvest: off })
// or whose record cannot be established. Instructions alone are not
// enforcement. A matching record proves consistency, not authorship.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `oats.okf-harvest 5.0 has no commands of its own: a harvester follows the
knowledge-harvest skill (read the proposal and the named source's records,
judge, publish one labelled PR with git and gh, hand over and retire on success
or nothing promotable; publication failure retains the live home and reports
the error without retiring).
oats okf-harvest complete | harvest-status   removed in 5.0 (E_REMOVED)
`;
export const REMOVED = 'was removed in oats.okf 5.0: there are no harvest runs, custody or delivery to complete. A 5.0 harvester judges the proposal in its TASK.md and opens the PR itself (skill knowledge-harvest). A 4.x TASK (one naming a source descriptor and a run) cannot be processed by 5.0: report it to your operator and retire; nothing was delivered';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const real = (p) => { try { return realpathSync(String(p)); } catch { return null; } };
const file = (p) => { try { const s = lstatSync(p); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } };

/** The proposal's source, checked against the deployment's record. → { instance, soul, agent }. */
export function checkSource({ task = '', deployment } = {}) {
  // Exactly one Source line: with two, which one names the source is ambiguous.
  if ((String(task).match(/^Source:/gm) || []).length > 1) fail('E_SOURCE', 'the proposal has more than one `Source:` line; exactly one names the source');
  const m = /^Source:\s*instance\s+(\S+?),\s*home\s+(\S+?),\s*soul\s+(\S+?)\s*$/m.exec(task);
  if (!m) fail('E_SOURCE', 'the task is not an oats.okf 5.0 proposal: it has no `Source: instance <name>, home <path>, soul <name>` line; a harvester is spawned only on a proposal');
  const [, instance, home, soul] = m;
  if (!NAME.test(instance) || !NAME.test(soul)) fail('E_SOURCE', 'the proposal\'s source instance and soul must be plain names');
  if (typeof deployment !== 'string' || !isAbsolute(deployment)) fail('E_SOURCE', 'the deployment is unknown (no absolute OATS_WORKSPACE), so the source cannot be checked');
  // The exact record directory: never a retirement copy (dot directories) or a guess by basename.
  let agents; try { agents = readdirSync(join(deployment, 'agents')).filter((a) => !a.startsWith('.')); } catch { agents = []; }
  const records = agents.map((a) => ({ agent: a, path: join(deployment, 'agents', a, 'instances', instance, 'instance.json') })).filter((r) => file(r.path));
  if (records.length !== 1) fail('E_SOURCE', records.length ? `more than one record names source instance ${instance}; its authority cannot be established` : `no record of source instance ${instance} in this deployment (retired?); its authority cannot be established`);
  let record; try { record = JSON.parse(readFileSync(records[0].path, 'utf8')); } catch { fail('E_SOURCE', `the record of source instance ${instance} is unreadable`); }
  if (record?.instance !== instance || resolve(String(record.home)) !== resolve(home) || real(record.home) !== real(dirname(records[0].path))) fail('E_SOURCE', `the record of source instance ${instance} does not match the proposal's home`);
  if (typeof record.soulDir !== 'string' || !isAbsolute(record.soulDir) || !file(join(record.soulDir, 'soul.yaml'))) fail('E_SOURCE', `the recorded soul of source instance ${instance} is unreadable`);
  const soulYaml = readFileSync(join(record.soulDir, 'soul.yaml'), 'utf8');
  if (/^name:\s*['"]?([^'"\s#]+)/m.exec(soulYaml)?.[1] !== soul) fail('E_SOURCE', `the recorded soul of source instance ${instance} is not ${soul}`);
  const okf = record.providers?.['oats.okf'];
  if (!okf || typeof okf !== 'object') fail('E_SOURCE', `source instance ${instance} has no oats.okf knowledge slot`);
  // The recorded soul itself: any `harvest: off` there refuses (fail closed),
  // even when a host or default value masked it in the settings.
  const optedOut = `the soul of source instance ${instance} opts out of harvest (knowledge: { harvest: off }, or a "harvest: off" anywhere in its soul.yaml): its knowledge is not harvested`;
  if (/\bharvest\s*:\s*['"]?off\b/.test(soulYaml)) fail('E_OPTED_OUT', optedOut);
  // What the kernel handed oats.okf, judged by its RECORDED origin (the record's
  // capability entry): a 4.x manifest default (harvest off, harvest-runtime pi)
  // is nobody's decision; a soul `off` is the opt-out; any other legacy key, or
  // one with no recorded origin, means the source's authority is not established.
  const origins = [record.capabilities, record.capabilityRuntime].flatMap((l) => (Array.isArray(l) ? l : [])).find((c) => c?.id === 'oats.okf')?.settingsOrigins;
  for (const key of ['harvest', 'harvest-runtime', 'harvest-model'].filter((k) => Object.hasOwn(okf, k))) {
    const kind = origins?.[`/${key}`]?.kind;
    if (kind === 'manifest-default') continue;
    if (key === 'harvest' && okf.harvest === 'off' && kind === 'soul') fail('E_OPTED_OUT', optedOut);
    fail('E_SOURCE', typeof kind === 'string'
      ? `the record of source instance ${instance} sets oats.okf ${key} from ${kind}, a setting removed in oats.okf 5.0 that the source itself refuses; its authority cannot be established`
      : `the record of source instance ${instance} sets oats.okf ${key} with no recorded origin, so whether its soul opts out cannot be established`);
  }
  return { instance, soul, agent: records[0].agent };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), event = process.env.OATS_EVENT || args[0];
  if (event === 'spawn') {
    // Hook answer: JSON on stdout; a failure exits 1, and the required hook refuses the spawn.
    // No meta either way: the check reads files and creates nothing, and the
    // kernel keeps meta as the receipt of external state (a spawn rolled back
    // after this capability, which has no retire hook, reported meta is
    // quarantined). The record keeps no source name: no link to the proposer.
    try {
      checkSource({ task: process.env.OATS_TASK, deployment: process.env.OATS_WORKSPACE });
      process.stdout.write('{}\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ warning: `oats-okf-harvest ${e.code || 'E_SOURCE'}: ${e.message}` }) + '\n');
      process.exitCode = 1;
    }
  } else if (!event || args.includes('--help') || args.includes('-h')) process.stdout.write(HELP);
  else {
    const error = ['complete', 'harvest-status'].includes(event)
      ? { code: 'E_REMOVED', message: `oats okf-harvest ${event} ${REMOVED}` }
      : { code: 'E_USAGE', message: `unknown command ${event}; see --help` };
    if (args.includes('--json')) process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error }) + '\n');
    else process.stderr.write(`oats okf-harvest ${event}: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

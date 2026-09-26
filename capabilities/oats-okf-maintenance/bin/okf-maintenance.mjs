#!/usr/bin/env node
// oats.okf-maintenance: the maintainer's two helpers. review-context turns one
// harvest PR (the trigger event or a URL) into a validated provenance and a
// reading list; notify-harvester composes the okf-team message (C4). Neither
// merges, comments or sends anything: the maintainer does that deliberately.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProvenance } from '../lib/provenance.mjs';

const HELP = `oats okf-maintenance review-context (--event FILE | --pr URL) [--checkout DIR] [--json]
oats okf-maintenance notify-harvester (--event FILE | --pr URL) --state question|amend-request|amended|merged|closed [--body TEXT] [--json]
`;
const STATES = ['question', 'amend-request', 'amended', 'merged', 'closed'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const IDENTITY = /^(OATS_(?!HOME_DIR$|PACKAGE_CATALOG$)|PI_AGENT|GIT_)/;
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !IDENTITY.test(k)));

export function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) fail('E_USAGE', `unexpected argument ${a}`);
    const k = a.slice(2);
    if (k in flags) fail('E_USAGE', `duplicate --${k}`);
    if (!allowed.includes(k)) fail('E_USAGE', `unknown flag --${k}`);
    if (k === 'json') { flags.json = true; continue; }
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) fail('E_USAGE', `--${k} needs a value`);
    flags[k] = args[++i];
  }
  return flags;
}
/** A GitHub PR reference → { repo: "owner/name", host, number, url }. */
export function prRef(text) {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/.exec(String(text || '').trim());
  if (!m) fail('E_USAGE', '--pr must be a pull request URL (https://github.com/<owner>/<repo>/pull/<n>)');
  return { host: m[1].toLowerCase(), repo: `${m[2]}/${m[3]}`, number: Number(m[4]), url: `https://${m[1]}/${m[2]}/${m[3]}/pull/${m[4]}` };
}
/** The trigger event file (OATS_TRIGGER_EVENT_FILE): only its structured fields are used. */
export function eventRef(file) {
  if (!isAbsolute(file || '')) fail('E_USAGE', '--event must be an absolute path (use "$OATS_TRIGGER_EVENT_FILE")');
  let ev; try { ev = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail('E_EVENT', `trigger event unreadable: ${e.code || e.message}`); }
  if (ev?.source !== 'github.pull_request' || !Number.isInteger(ev.number)) fail('E_EVENT', 'not a github.pull_request trigger event');
  const ref = prRef(ev.url);
  if (ref.number !== ev.number) fail('E_EVENT', 'event url and number disagree');
  return { ...ref, event: ev.event ?? null, headSha: typeof ev.headSha === 'string' ? ev.headSha : null, trigger: ev.trigger ?? null };
}
function viewPr(ref, env) {
  const r = spawnSync('gh', ['pr', 'view', ref.url, '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName,labels,body,mergedAt,closedAt'], { encoding: 'utf8', timeout: 60000, env: cleanEnv(env), maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) fail('E_GH', `gh pr view ${ref.url} failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
  return JSON.parse(r.stdout);
}
function resolveRef(flags) {
  if (!!flags.event === !!flags.pr) fail('E_USAGE', 'give --event FILE or --pr URL');
  return flags.event ? eventRef(flags.event) : prRef(flags.pr);
}
/** Map the provenance nodes to paths in a checkout of the PR (bounded, read-only). */
function checkoutFacts(dir, pr, provenance, git) {
  if (!isAbsolute(dir)) dir = resolve(dir);
  if (!existsSync(join(dir, '.git'))) fail('E_USAGE', `--checkout is not a Git checkout: ${dir}`);
  const bases = (provenance?.source.bases || []).filter((b) => b.kind === 'git');
  const facts = { dir, bases: [] };
  const changed = git(dir, ['diff', '--name-only', `origin/${pr.baseRefName}...HEAD`]).split('\n').filter(Boolean);
  facts.changed = changed;
  for (const b of bases) {
    const root = b.root && b.root !== '.' ? b.root : '';
    const metaFile = join(dir, root, 'okf-base.json');
    if (!existsSync(metaFile) || !lstatSync(metaFile).isFile()) { facts.bases.push({ alias: b.alias, root: root || '.', problem: 'okf-base.json not found at this root' }); continue; }
    let meta; try { meta = JSON.parse(readFileSync(metaFile, 'utf8')); } catch { facts.bases.push({ alias: b.alias, root: root || '.', problem: 'okf-base.json is not JSON' }); continue; }
    const node = (ref) => { const [alias, n] = ref.split('/'); return alias === b.alias && meta?.nodes?.[n] ? { ref, path: join(root, meta.nodes[n].path), owner: meta.nodes[n].owner } : null; };
    const owned = provenance.source.ownedNodes.map(node).filter(Boolean), read = provenance.source.readNodes.map(node).filter(Boolean);
    const within = (p, n) => p === n.path || p.startsWith(`${n.path}/`);
    const touched = changed.filter((p) => p === join(root, 'index.md') || p === join(root, 'log.md') || [...owned, ...read].some((n) => within(p, n)) || !root || p.startsWith(`${root}/`));
    const outsideOwned = touched.filter((p) => p.endsWith('.md') && ![join(root, 'index.md'), join(root, 'log.md')].includes(p) && !owned.some((n) => within(p, n)));
    const neighbours = [...new Set(touched.filter((p) => p.endsWith('.md')).map((p) => dirname(p)))].map((d) => ({ dir: d, entries: existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.endsWith('.md')).sort().slice(0, 200) : [] }));
    facts.bases.push({ alias: b.alias, root: root || '.', owned, read, changed: touched, outsideOwned, neighbours });
  }
  return facts;
}
const gitRun = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, env: cleanEnv(process.env) });
  if (r.status !== 0) fail('E_GIT', `git ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
};
export function reviewContext(flags, env = process.env, { view = viewPr, git = gitRun } = {}) {
  const ref = resolveRef(flags), pr = view(ref, env);
  const provenance = parseProvenance(pr.body);
  const labels = (pr.labels || []).map((l) => l.name);
  const p = provenance.value;
  const reading = [
    `git clone https://${ref.host}/${ref.repo}.git ./work/kb && cd ./work/kb && gh pr checkout ${pr.number}`,
    `git diff --stat origin/${pr.baseRefName}...HEAD`,
    ...(p ? [`read the owned nodes' index.md and neighbours: ${p.source.ownedNodes.join(', ') || '(none)'}`, `read the source's read nodes for context: ${p.source.readNodes.join(', ') || '(none)'}`] : ['no valid provenance: review it as an unprovenanced change (request changes or close)']),
  ];
  const result = {
    pr: { repo: ref.repo, number: pr.number, url: pr.url, state: pr.state, draft: pr.isDraft === true, head: pr.headRefName, headSha: pr.headRefOid, base: pr.baseRefName, labels, mergedAt: pr.mergedAt || null, closedAt: pr.closedAt || null },
    event: flags.event ? { event: ref.event, headSha: ref.headSha, trigger: ref.trigger, headMoved: !!ref.headSha && ref.headSha !== pr.headRefOid } : null,
    settled: pr.state !== 'OPEN',
    provenance: { valid: provenance.valid, problems: provenance.problems, value: p },
    tasks: p ? { provider: p.tasks.provider, refs: p.tasks.refs, note: p.tasks.provider ? `read these through your tasks capability if it is ${p.tasks.provider}; otherwise record tasks: "unavailable"` : 'no tasks provider recorded: record tasks: "unavailable"' } : null,
    harvester: p ? p.harvester : null,
    reading,
  };
  if (flags.checkout) result.checkout = checkoutFacts(flags.checkout, pr, p, git);
  return result;
}
export function notifyHarvester(flags, env = process.env, { view = viewPr } = {}) {
  if (!STATES.includes(flags.state)) fail('E_USAGE', `--state must be one of ${STATES.join(', ')}`);
  const ref = resolveRef(flags), pr = view(ref, env), provenance = parseProvenance(pr.body);
  if (!provenance.valid) fail('E_PROVENANCE', `the PR has no valid provenance, so its harvester is unknown: ${provenance.problems.join('; ')}`);
  const h = provenance.value.harvester;
  const body = flags.body ?? {
    merged: `Your harvest PR ${pr.url} is merged. Confirm with oats okf-harvest harvest-status, then retire.`,
    closed: `Your harvest PR ${pr.url} was closed without merge; see the okf-review comment for the reason. Confirm with oats okf-harvest harvest-status, then retire.`,
    question: `A question on your harvest PR ${pr.url}: see the okf-review comment.`,
    'amend-request': `An amendment request on your harvest PR ${pr.url}: see the okf-review comment and reply with the change you would make.`,
    amended: `I amended your harvest PR ${pr.url}; see the okf-review comment.`,
  }[flags.state];
  return { to: h.alias || h.instance, instance: h.instance, alias: h.alias, team: 'okf', subject: `okf: ${flags.state} ${pr.url}`, body, send: 'send this with your messaging capability in the okf team' };
}
function text(event, r) {
  if (event === 'notify-harvester') return `to: ${r.to} (team okf)\nsubject: ${r.subject}\n\n${r.body}`;
  const lines = [`${r.pr.url} ${r.pr.state}${r.pr.draft ? ' (draft)' : ''} ${r.pr.head}@${String(r.pr.headSha).slice(0, 12)} → ${r.pr.base} [${r.pr.labels.join(', ')}]`];
  lines.push(r.provenance.valid ? `provenance: run ${r.provenance.value.run}, source ${r.provenance.value.source.soul}/${r.provenance.value.source.instance}, harvester ${r.harvester.alias || r.harvester.instance}` : `provenance INVALID: ${r.provenance.problems.join('; ')}`);
  if (r.tasks) lines.push(`tasks: ${r.tasks.refs.join(', ') || '(none)'} — ${r.tasks.note}`);
  lines.push('reading list:', ...r.reading.map((x) => `  - ${x}`));
  if (r.checkout) for (const b of r.checkout.bases) lines.push(`checkout ${b.alias} (${b.root}): ${b.problem || `${b.changed.length} changed; outside owned nodes: ${b.outsideOwned.join(', ') || 'none'}`}`);
  return lines.join('\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), event = args[0];
  if (!event || args.includes('--help') || args.includes('-h')) process.stdout.write(HELP);
  else {
    const json = args.includes('--json');
    try {
      let result;
      if (event === 'review-context') result = reviewContext(parseFlags(args.slice(1), ['event', 'pr', 'checkout', 'json']));
      else if (event === 'notify-harvester') result = notifyHarvester(parseFlags(args.slice(1), ['event', 'pr', 'state', 'body', 'json']));
      else fail('E_USAGE', `unknown command ${event}; see --help`);
      process.stdout.write((json ? JSON.stringify({ schemaVersion: 1, ok: true, result }) : text(event, result)) + '\n');
    } catch (e) {
      const code = e.code || 'E_OKF_MAINTENANCE';
      if (json) process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: e.message } }) + '\n');
      else process.stderr.write(`oats okf-maintenance ${event}: ${code}: ${e.message}\n`);
      process.exitCode = 1;
    }
  }
}

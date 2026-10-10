#!/usr/bin/env node
// oats.okf-maintenance: the maintainer's two helpers. review-context turns one
// harvest PR (the trigger event or a URL) into a validated provenance and a
// reading list; notify-harvester composes the okf-team message (C4). Neither
// merges, comments or sends anything: the maintainer does that deliberately.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProvenance, safeRoot } from '../lib/provenance.mjs';

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
/** Map the changed paths of a PR checkout onto the nodes of the ACCEPTED base
 *  (bounded, read-only). The PR body is untrusted, so ownership comes from
 *  okf-base.json at origin/<base>, never from the PR head, and owned nodes are
 *  the accepted nodes whose owner is the source's owner, not the nodes the
 *  provenance claims (okf 4.0.1 #3). */
function checkoutFacts(dir, pr, provenance, git) {
  if (!isAbsolute(dir)) dir = resolve(dir);
  if (!existsSync(join(dir, '.git'))) fail('E_USAGE', `--checkout is not a Git checkout: ${dir}`);
  const bases = (provenance?.source.bases || []).filter((b) => b.kind === 'git');
  const facts = { dir, bases: [] };
  const baseRef = `origin/${pr.baseRefName}`;
  const changed = git(dir, ['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean);
  facts.changed = changed;
  const owner = provenance?.source.owner || provenance?.source.soul || null;
  for (const b of bases) {
    if (!safeRoot(b.root ?? '.')) { facts.bases.push({ alias: b.alias, root: String(b.root), problem: 'unsafe base root in provenance (.., absolute or backslash): review as unprovenanced' }); continue; }
    const root = b.root && b.root !== '.' ? b.root : '';
    const at = (p) => (root ? `${root}/${p}` : p);
    let meta;
    try { meta = JSON.parse(git(dir, ['show', `${baseRef}:${at('okf-base.json')}`])); }
    catch { facts.bases.push({ alias: b.alias, root: root || '.', problem: `okf-base.json not readable at ${baseRef}:${at('okf-base.json')}` }); continue; }
    const nodes = Object.entries(meta?.nodes || {}).map(([n, v]) => ({ ref: `${b.alias}/${n}`, path: at(v.path), owner: v.owner }));
    const owned = nodes.filter((n) => owner !== null && n.owner === owner);
    const claimed = provenance.source.ownedNodes.filter((r) => r.startsWith(`${b.alias}/`));
    const claimedNotOwned = claimed.filter((r) => !owned.some((n) => n.ref === r));
    const read = nodes.filter((n) => provenance.source.readNodes.includes(n.ref));
    const within = (p, n) => p === n.path || p.startsWith(`${n.path}/`);
    const nav = [at('index.md'), at('log.md')], metaFile = at('okf-base.json');
    const touched = changed.filter((p) => !root || p.startsWith(`${root}/`));
    const baseMetaChanged = touched.includes(metaFile);
    // Any change to okf-base.json (the node/owner map) is outside owned, always.
    const outsideOwned = touched.filter((p) => p === metaFile || (!nav.includes(p) && !owned.some((n) => within(p, n))));
    const neighbours = [...new Set(touched.filter((p) => p.endsWith('.md')).map((p) => dirname(p)))]
      .filter((d) => { const full = resolve(dir, d); return full === dir || full.startsWith(`${dir}/`); })
      .map((d) => ({ dir: d, entries: existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.endsWith('.md')).sort().slice(0, 200) : [] }));
    facts.bases.push({ alias: b.alias, root: root || '.', ownerFrom: provenance?.source.owner ? 'provenance source.owner' : 'provenance source.soul', owner, owned, claimedNotOwned, read, changed: touched, baseMetaChanged, outsideOwned, neighbours });
  }
  return facts;
}
const gitRun = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, env: cleanEnv(process.env) });
  if (r.status !== 0) fail('E_GIT', `git ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
};
export const NEEDS_HUMAN = 'okf-needs-human';
export function reviewContext(flags, env = process.env, { view = viewPr, git = gitRun } = {}) {
  const ref = resolveRef(flags), pr = view(ref, env);
  const provenance = parseProvenance(pr.body);
  const labels = (pr.labels || []).map((l) => l.name);
  const p = provenance.value;
  const reading = [
    `git clone https://${ref.host}/${ref.repo}.git ./work/kb && cd ./work/kb && gh pr checkout ${pr.number}`,
    `git diff --stat origin/${pr.baseRefName}...HEAD`,
    ...(p ? [`read the owned nodes' index.md and neighbours: ${p.source.ownedNodes.join(', ') || '(none)'}`, `read the source's read nodes for context: ${p.source.readNodes.join(', ') || '(none)'}`] : ['no valid provenance: review it as an unprovenanced change (request changes or close)']),
    // v2 evidence names the source's own notes; the PR body carries the claims they back.
    ...(p?.version === 2 ? [`the claims and their evidence are in the PR body; the harvester relied on: ${p.evidence.map((e) => `${e.note}${e.sha256 ? ` (sha256 ${e.sha256.slice(0, 12)})` : ' (not read)'}`).join(', ') || '(no notes)'}`] : []),
  ];
  const result = {
    pr: { repo: ref.repo, number: pr.number, url: pr.url, state: pr.state, draft: pr.isDraft === true, head: pr.headRefName, headSha: pr.headRefOid, base: pr.baseRefName, labels, mergedAt: pr.mergedAt || null, closedAt: pr.closedAt || null },
    event: flags.event ? { event: ref.event, headSha: ref.headSha, trigger: ref.trigger, headMoved: !!ref.headSha && ref.headSha !== pr.headRefOid } : null,
    // okf 4.0.1 #5: okf-needs-human is a HARD STOP. Only a human removing the
    // label clears it; no event (reopened, ready_for_review, a new head) does.
    blocked: labels.includes(NEEDS_HUMAN) ? 'needs-human' : null,
    settled: pr.state !== 'OPEN' || labels.includes(NEEDS_HUMAN),
    provenance: { valid: provenance.valid, problems: provenance.problems, value: p },
    tasks: p ? { provider: p.tasks.provider, refs: p.tasks.refs, note: p.tasks.provider ? `read these through your tasks capability if it is ${p.tasks.provider}; otherwise record tasks: "unavailable"` : 'no tasks provider recorded: record tasks: "unavailable"' } : null,
    harvester: p ? p.harvester : null,
    evidence: p?.version === 2 ? p.evidence : null,
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
  // okf 5.0 (v2): the harvester normally retires after successful handover;
  // publication failure may retain it. The notice concerns only this PR,
  // with no callback; review never waits for the harvester.
  const body = flags.body ?? (provenance.value.version === 2 ? {
    merged: `Your harvest PR ${pr.url} is merged. Nothing else is needed.`,
    closed: `Your harvest PR ${pr.url} was closed without merge; see the okf-review comment for the reason.`,
    question: `A question on your harvest PR ${pr.url}: see the okf-review comment.`,
    'amend-request': `An amendment request on your harvest PR ${pr.url}: see the okf-review comment.`,
    amended: `I amended your harvest PR ${pr.url}; see the okf-review comment.`,
  } : {
    merged: `Your harvest PR ${pr.url} is merged. Confirm with oats okf-harvest harvest-status, then retire.`,
    closed: `Your harvest PR ${pr.url} was closed without merge; see the okf-review comment for the reason. Confirm with oats okf-harvest harvest-status, then retire.`,
    question: `A question on your harvest PR ${pr.url}: see the okf-review comment.`,
    'amend-request': `An amendment request on your harvest PR ${pr.url}: see the okf-review comment and reply with the change you would make.`,
    amended: `I amended your harvest PR ${pr.url}; see the okf-review comment.`,
  })[flags.state];
  return { to: h.alias || h.instance, instance: h.instance, alias: h.alias, subject: `okf: ${flags.state} ${pr.url}`, body, send: provenance.value.version === 2 ? 'optional: a 5.0 harvester normally retires after successful handover; publication failure may retain it, but review never waits for it; the okf-review comment is the record' : 'send this with your messaging capability' };
}
function text(event, r) {
  if (event === 'notify-harvester') return `to: ${r.to}\nsubject: ${r.subject}\n\n${r.body}`;
  const lines = [`${r.pr.url} ${r.pr.state}${r.pr.draft ? ' (draft)' : ''} ${r.pr.head}@${String(r.pr.headSha).slice(0, 12)} → ${r.pr.base} [${r.pr.labels.join(', ')}]`];
  const v = r.provenance.value;
  lines.push(r.provenance.valid ? `provenance v${v.version}: ${v.version === 1 ? `run ${v.run}, ` : ''}source ${v.source.soul}/${v.source.instance}, harvester ${r.harvester.alias || r.harvester.instance}` : `provenance INVALID: ${r.provenance.problems.join('; ')}`);
  if (r.tasks) lines.push(`tasks: ${r.tasks.refs.join(', ') || '(none)'} — ${r.tasks.note}`);
  if (r.blocked) lines.push(`BLOCKED: ${r.blocked} — the okf-needs-human label is a hard stop: do not review, amend, merge or close; only a human removes it`);
  lines.push('reading list:', ...r.reading.map((x) => `  - ${x}`));
  if (r.checkout) for (const b of r.checkout.bases) lines.push(`checkout ${b.alias} (${b.root}): ${b.problem || `${b.changed.length} changed; owner ${b.owner ?? '(unknown)'}; outside owned nodes: ${b.outsideOwned.join(', ') || 'none'}${b.baseMetaChanged ? '; okf-base.json CHANGED' : ''}${b.claimedNotOwned.length ? `; provenance claims nodes not owned by ${b.owner}: ${b.claimedNotOwned.join(', ')}` : ''}`}`);
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

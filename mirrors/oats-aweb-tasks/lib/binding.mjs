// The readiness check: the `team` setting, and the floors that keep a home's
// task claims present. With `team` absent the team answer is ready with nothing else.
// With `team` set it answers from configuration: for a home, oats.aweb's own
// `oats aweb teams --json`, run from the home through the kernel that runs this
// check (OATS_CLI_BIN); for a soul, the eligible teams the kernel gives every
// check (OATS_TEAMS). Whether the seat is GLOBAL is the kernel's resolved
// oats.aweb setting `identity.mode`, read with `oats inspect`, never oats.aweb's
// instance.json meta. Anything the team answer cannot read fails closed: never
// ready. A home's check then adds the claim-floor warnings to that answer,
// ready or not (lib/claim-floors.mjs): whatever keeps the home's task claims
// present (the host wake daemon, the aweb-channel plugin or the pi extension)
// below the version that heartbeats them. What it cannot read adds nothing.
import { spawnSync } from 'node:child_process';
import { teamSetting } from './team.mjs';
import { claimFloorWarnings, readWakeStatus } from './claim-floors.mjs';

const CAPABILITY = 'oats.aweb-tasks';
const SLOT = 'tasks';
// Each kernel call is bounded well inside the check's 30 s, and all provider
// checks of one readiness read share 60 s.
const CALL_TIMEOUT_MS = 10_000;
// A home's `aw wake status` read follows up to two kernel calls, so it gets
// what is left of this budget, at most CALL_TIMEOUT_MS, and the whole check
// still answers inside the kernel's 30 s.
const CHECK_BUDGET_MS = 25_000;
const MIN_AW_CALL_MS = 500;
const MAX_INPUT = 1 << 20;

const REMEDY_NONE = 'or set `tasks: none` for this soul';

class WireError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/** The released check request, key for key. */
export function decodeRequest(value) {
  if (!exactKeys(value, ['schemaVersion', 'phase', 'slot', 'capability', 'settings', 'input'])
    || value.schemaVersion !== 1 || value.phase !== 'check' || value.slot !== SLOT || value.capability !== CAPABILITY
    || !isObject(value.settings) || !exactKeys(value.input, ['context', 'action'])
    || !isObject(value.input.context) || !isObject(value.input.action) || value.input.action.kind !== 'readiness') {
    throw new WireError('invalid-binding', 'oats.aweb-tasks: the check request does not match the binding wire');
  }
  const { home, deployment, soul } = value.input.context;
  if ((home !== null && typeof home !== 'string') || (typeof deployment !== 'string' && deployment !== null) || (soul !== undefined && soul !== null && typeof soul !== 'string')) {
    throw new WireError('invalid-binding', 'oats.aweb-tasks: the check request context does not match the binding wire');
  }
  return value;
}

/** The environment of a kernel call: this check's own OATS_* removed, so the
 *  dispatched command resolves its own scope from where it runs. */
function kernelEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('OATS_')));
}

/** Run `oats <args> ` through the kernel that runs this check. → {doc} or {why}. */
export function kernelJson(args, { cwd, env = process.env, run = spawnSync } = {}) {
  const cli = env.OATS_CLI_BIN;
  if (typeof cli !== 'string' || !cli) return { why: 'OATS_CLI_BIN is not set' };
  const node = env.OATS_NODE_BIN || process.execPath;
  const r = run(node, [cli, ...args], { cwd, env: kernelEnv(env), encoding: 'utf8', timeout: CALL_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 4 << 20 });
  const command = `\`oats ${args.join(' ')}\``;
  if (r.error || r.signal) return { why: `${command} did not finish${r.error?.code === 'ETIMEDOUT' || r.signal ? ` within ${CALL_TIMEOUT_MS / 1000} s` : ''}` };
  if (r.status !== 0) return { why: `${command} exited ${r.status}${firstLine(r.stderr) ? `: ${firstLine(r.stderr)}` : ''}` };
  try { return { doc: JSON.parse(String(r.stdout || '').trim()) }; }
  catch { return { why: `${command} did not answer one JSON document` }; }
}
const firstLine = (text) => String(text || '').trim().split('\n').pop().slice(0, 200);

/** oats.aweb's teams document for a home, checked to the depth this check reads it. */
function teamsDocument(home, opts) {
  const got = kernelJson(['aweb', 'teams', '--json'], { ...opts, cwd: home });
  if (got.why) return got;
  const d = got.doc;
  if (!isObject(d) || !Array.isArray(d.joined) || !Array.isArray(d.eligible) || (d.defaultTeam !== null && !isObject(d.defaultTeam))) {
    return { why: '`oats aweb teams --json` answered no teams document' };
  }
  return { doc: d };
}

/** The soul a check names to `oats inspect --soul`. The wire's `soul` is the bare
 *  name, which another soul of that name makes ambiguous. OATS_SOUL_ID, the
 *  soul's stable id (`<repoKey>#<soul>` or `package:<id>#<soul>`), gives its
 *  qualified name, `<repoKey>/<soul>` or `<id>/<soul>`. */
export function soulSelector(soul, env = process.env) {
  const id = /^(?:package:)?([^#\s]+)#([^#\s]+)$/.exec(String(env.OATS_SOUL_ID ?? ''));
  return id && id[2] === soul ? `${id[1]}/${soul}` : soul;
}

/** The kernel's resolved oats.aweb identity.mode: {mode: 'global'|'local'} or {why}. */
export function identityMode(context, opts = {}) {
  const args = context.home ? ['inspect', '--home', context.home, '--json']
    : context.soul && context.deployment ? ['inspect', '--soul', soulSelector(context.soul, opts.env || process.env), '--dir', context.deployment, '--json'] : null;
  if (!args) return { why: 'the check names neither a home nor a soul and deployment' };
  const got = kernelJson(args, { ...opts, cwd: context.home || context.deployment });
  if (got.why) return got;
  const caps = got.doc?.result?.capabilities;
  if (!Array.isArray(caps)) return { why: `\`oats ${args.join(' ')}\` answered no capabilities` };
  const mode = caps.find((c) => isObject(c) && (c.id === 'oats.aweb' || c.name === 'oats.aweb'))?.settings?.identity?.mode;
  return mode === 'global' || mode === 'local' ? { mode } : { why: `\`oats ${args.join(' ')}\` shows no oats.aweb identity.mode` };
}

const ready = (warnings = []) => ({ status: 'ready', problems: [], warnings });
const refuse = (code, message) => ({ status: 'needs-configuration', problems: [{ code, message }] });
const unverified = (label, why) => ({ status: 'unavailable', problems: [{ code: 'team-unverified',
  message: `oats.aweb-tasks: whether this ${why.subject} can act in team ${label} is unknown: ${why.text}. Tasks stay unready until it can be read` }] });

const defaultNote = (label, subject) => ({ code: 'team-is-default',
  message: `oats.aweb-tasks: team ${label} is this ${subject}'s default team, so no join is needed: plain \`aw task …\` reads its list` });
const globalRefusal = (label, subject) => refuse('team-global-seat',
  `oats.aweb-tasks reads team ${label}'s task list, and this ${subject} is a GLOBAL seat: it cannot join teams until #60. Set \`team\` to its default team, ${REMEDY_NONE}`);
const notJoined = (label) => refuse('team-not-joined',
  `oats.aweb-tasks reads team ${label}'s task list, and this home has not joined ${label}. Run \`oats aweb join --labels ${label}\` from the home (a GLOBAL seat cannot join teams until #60), ${REMEDY_NONE}`);
const notEligible = (label, subject, labels) => refuse('team-not-eligible',
  `oats.aweb-tasks reads team ${label}'s task list, and ${label} is not one of this ${subject}'s teams (${labels.length ? labels.join(', ') : 'none'}), so it cannot join it. Make ${label} eligible for the soul, then run \`oats aweb join --labels ${label}\` from the home, ${REMEDY_NONE}`);

function checkHome(label, context, opts) {
  const teams = teamsDocument(context.home, opts);
  if (teams.why) return unverified(label, { subject: 'home', text: teams.why });
  const d = teams.doc;
  if (d.defaultTeam?.label === label) return ready([defaultNote(label, 'home')]);
  const joined = d.joined.find((j) => isObject(j) && j.label === label);
  if (joined && typeof joined.identityHome === 'string' && joined.identityHome) return ready();
  // An unknown mode is not GLOBAL: the not-joined refusal carries the #60 note.
  if (identityMode(context, opts).mode === 'global') return globalRefusal(label, 'home');
  if (d.eligible.some((e) => isObject(e) && e.label === label)) return notJoined(label);
  const labels = [d.defaultTeam?.label, ...d.eligible.map((e) => e?.label)].filter((l) => typeof l === 'string' && l);
  return notEligible(label, 'home', labels);
}

function checkSoul(label, context, opts) {
  const env = opts.env || process.env;
  let rows;
  try { rows = JSON.parse(env.OATS_TEAMS); } catch { rows = null; }
  if (!Array.isArray(rows)) return unverified(label, { subject: 'soul', text: 'the kernel gave this check no readable OATS_TEAMS' });
  rows = rows.filter(isObject);
  const defaultLabel = rows.find((r) => r.default === true)?.label ?? env.OATS_DEFAULT_TEAM;
  if (defaultLabel === label) return ready([defaultNote(label, 'soul')]);
  if (!rows.some((r) => r.default === false && r.label === label)) {
    return notEligible(label, 'soul', rows.map((r) => r.label).filter((l) => typeof l === 'string' && l));
  }
  // Ready only on a confirmed LOCAL mode: an unknown one is neither GLOBAL nor ready.
  const identity = identityMode(context, opts);
  if (identity.mode === 'global') return globalRefusal(label, 'soul');
  if (!identity.mode) return unverified(label, { subject: 'soul', text: `its oats.aweb identity mode cannot be read, and a GLOBAL seat cannot join teams until #60: ${identity.why}` });
  return ready([{ code: 'team-join-at-spawn',
    message: `oats.aweb-tasks: team ${label} is eligible, and a home must join it: spawn with oats.aweb \`join=${label}\`, or run \`oats aweb join --labels ${label}\` from the home` }]);
}

function teamResult(request, opts) {
  const team = teamSetting(request.settings);
  if (team.absent) return ready();
  if (team.problem) return refuse('team-invalid', `oats.aweb-tasks ${team.problem}`);
  const context = request.input.context;
  return context.home ? checkHome(team.label, context, opts) : checkSoul(team.label, context, opts);
}

/** The claim-floor warnings for the context. `aw wake status` runs from the
 *  home, bounded by what is left of the check's budget, and not at all when
 *  too little is left. */
function claimFloors(context, { env = process.env, runAw, now = Date.now, startedAt = now() } = {}) {
  const readStatus = () => {
    const timeout = Math.min(CALL_TIMEOUT_MS, CHECK_BUDGET_MS - (now() - startedAt));
    return timeout < MIN_AW_CALL_MS ? undefined : readWakeStatus({ cwd: context.home, timeout, env, ...(runAw ? { run: runAw } : {}) });
  };
  return claimFloorWarnings(context, { readStatus, env });
}

/** The check's result for a decoded request: the team answer, ready or not,
 *  with the claim-floor warnings added to its warnings. */
export function checkResult(request, opts = {}) {
  const startedAt = (opts.now || Date.now)();
  const result = teamResult(request, opts);
  const floors = claimFloors(request.input.context, { ...opts, startedAt });
  return floors.length ? { ...result, warnings: [...(result.warnings || []), ...floors] } : result;
}

const answer = (phase, body) => ({ schemaVersion: 1, phase, slot: SLOT, capability: CAPABILITY, ...body });

async function readStdin(input) {
  const chunks = []; let length = 0;
  for await (const chunk of input) {
    length += chunk.length;
    if (length > MAX_INPUT) throw new WireError('invalid-binding', 'oats.aweb-tasks: the check request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runBinding(phase, { input = process.stdin, output = process.stdout, opts = {} } = {}) {
  let doc;
  if (phase === 'normalize' || phase === 'bind') {
    doc = answer(phase, { ok: false, error: { code: 'provider-not-qualified', message: `oats.aweb-tasks answers only the readiness check, not ${phase}` } });
  } else if (phase !== 'check') {
    doc = answer('check', { ok: false, error: { code: 'invalid-binding', message: 'oats.aweb-tasks: the binding phase must be normalize, bind or check' } });
  } else {
    try {
      let value;
      try { value = JSON.parse(await readStdin(input)); } catch (e) { throw e instanceof WireError ? e : new WireError('invalid-binding', 'oats.aweb-tasks: the check request is not JSON'); }
      doc = answer('check', { ok: true, result: checkResult(decodeRequest(value), opts) });
    } catch (e) {
      doc = answer('check', { ok: false, error: { code: e instanceof WireError ? e.code : 'provider-unavailable', message: String(e.message || e).slice(0, 1000) } });
    }
  }
  output.write(JSON.stringify(doc) + '\n');
}

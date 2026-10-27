// Claude Code's own records of the aweb channel connection (awebai/oats#981).
//
// Claude keeps a per-account MCP failure cache, <CLAUDE_CONFIG_DIR>/
// mcp-needs-auth-cache.json. One failed aweb-channel start anywhere stamps
// plugin:aweb-channel:aweb-channel, and every Claude launched in the next 15
// minutes skips the channel ("recent failure cached") and never retries: the
// seat shows the channel banner but is deaf. A Claude channel start removes
// that one live entry, so the launch really connects; and readiness counts a
// home as on the channel only when Claude's MCP log for the home's project has
// its "Channel notifications registered" line from after the home's last start.
//
// The shapes are Claude Code 2.1.300's, read from its code and from real
// files: a cache entry is {timestamp, id?, ttlMs?}, live while
// -60 s < now - timestamp < (ttlMs ?? 15 min); the logs live in env-paths'
// cache directory for "claude-cli" (independent of CLAUDE_CONFIG_DIR), one
// directory per project named after Claude's cwd with every non-alphanumeric
// character turned into "-" (cut at 200 characters plus a hash), and each
// line is {debug|error, timestamp, sessionId, cwd}. A log also holds message
// bodies, so it is only ever matched against the one line and never echoed.
import {readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {atomicWrite} from './local-settings.mjs';

export const CHANNEL_SERVER = 'plugin:aweb-channel:aweb-channel';
const FAILURE_CACHE = 'mcp-needs-auth-cache.json';
const FAILURE_TTL_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const ENTRY_KEYS = ['timestamp', 'id', 'ttlMs'];
const CLEAR_ATTEMPTS = 3;
/** How long after a start Claude has to register the channel before readiness
 *  calls the home not connected: Claude's MCP connect timeout is 30 s. */
export const CHANNEL_CONNECT_WINDOW_MS = 2 * 60 * 1000;
const LOG_DIR = 'mcp-logs-plugin-aweb-channel-aweb-channel';
const REGISTERED = 'Channel notifications registered';
const PROJECT_KEY_MAX = 200;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = value => typeof value === 'string' && value !== '' && isAbsolute(value) && !value.includes('\0');

/** Why one cache entry is not in the verified shape, or nothing. */
function entryProblem(name, entry) {
  if (!object(entry)) return `entry ${JSON.stringify(name)} is not an object`;
  const unknown = Object.keys(entry).find(key => !ENTRY_KEYS.includes(key));
  if (unknown) return `entry ${JSON.stringify(name)} has an unknown key ${JSON.stringify(unknown)}`;
  if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return `entry ${JSON.stringify(name)} has no numeric timestamp`;
  if (entry.id !== undefined && typeof entry.id !== 'string') return `entry ${JSON.stringify(name)} has a non-string id`;
  if (entry.ttlMs !== undefined && !(typeof entry.ttlMs === 'number' && Number.isFinite(entry.ttlMs) && entry.ttlMs > 0)) return `entry ${JSON.stringify(name)} has an invalid ttlMs`;
  return undefined;
}

/** What one read of the cache allows: remove the live entry (`next` is the
 *  rest of the document), or leave the file alone with the reason. */
function clearPlan(text, now) {
  let doc;
  try { doc = JSON.parse(text); } catch { return {state: 'unrecognized', detail: 'it is not JSON'}; }
  if (!object(doc)) return {state: 'unrecognized', detail: 'it is not a JSON object'};
  for (const [name, entry] of Object.entries(doc)) {
    const problem = entryProblem(name, entry);
    if (problem) return {state: 'unrecognized', detail: problem};
  }
  const entry = doc[CHANNEL_SERVER];
  if (!entry) return {state: 'none'};
  const age = now - entry.timestamp;
  if (!(age > -FUTURE_SKEW_MS && age < (entry.ttlMs ?? FAILURE_TTL_MS))) return {state: 'none'};
  const {[CHANNEL_SERVER]: _removed, ...rest} = doc;
  return {state: 'clear', next: JSON.stringify(rest), stampedAt: new Date(entry.timestamp).toISOString()};
}

/** Remove a live aweb-channel failure from the cache in `configDir`, leaving
 *  every other entry as it was. The file is rewritten atomically with its own
 *  mode, and only when that entry is live and the whole file is in the
 *  verified shape; anything else is reported and left alone.
 *  Claude's processes write the file without a lock, so the file is read
 *  again just before the rename: a write that landed since the snapshot sends
 *  the clear back to the new contents, and a file that keeps changing is left
 *  alone. Only the instant between that check and the rename stays open.
 *  Answers {state: cleared|none|absent|unrecognized|changed, file, stampedAt?, detail?}. */
export function clearChannelFailure(configDir, {now = Date.now()} = {}) {
  const file = join(configDir, FAILURE_CACHE);
  for (let attempt = 0; attempt < CLEAR_ATTEMPTS; attempt++) {
    let text, mode;
    try { mode = statSync(file).mode & 0o777; text = readFileSync(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return {state: 'absent', file};
      return {state: 'unrecognized', file, detail: `it could not be read (${error.code || 'error'})`};
    }
    const plan = clearPlan(text, now);
    if (plan.state !== 'clear') return {state: plan.state, file, ...(plan.detail ? {detail: plan.detail} : {})};
    let current;
    try { current = readFileSync(file, 'utf8'); } catch { continue; }
    if (current !== text) continue;
    atomicWrite(file, plan.next, mode);
    return {state: 'cleared', file, stampedAt: plan.stampedAt};
  }
  return {state: 'changed', file};
}

/** The Claude config dir of the home's recorded launch: its literal absolute
 *  CLAUDE_CONFIG_DIR, else HOME's .claude when the launch sets none. Unknown
 *  (undefined) for any other value, such as a {fromEnv} reference, or when
 *  the home has no launch record. The kernel gives hooks no resolved config
 *  dir, and a spawn hook runs before the record exists. */
export function recordedClaudeConfigDir(home, env = process.env) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')); } catch { return undefined; }
  if (!object(doc?.launch)) return undefined;
  const launchEnv = object(doc.launch.env) ? doc.launch.env : {};
  if (!Object.hasOwn(launchEnv, 'CLAUDE_CONFIG_DIR')) return absolute(env.HOME) ? join(env.HOME, '.claude') : undefined;
  return absolute(launchEnv.CLAUDE_CONFIG_DIR) ? launchEnv.CLAUDE_CONFIG_DIR : undefined;
}

/** What a Claude channel start says about the failure cache: `result` is
 *  clearChannelFailure's answer, or undefined when the start did not look
 *  (`why` says why). Nothing when there was nothing to remove. */
export function channelCacheNote(result, why) {
  const consequence = 'if Claude skips the channel, readiness reports channel-not-connected';
  if (!result) return `channel-cache-unchecked — ${why}, so Claude's MCP failure cache was not checked; ${consequence}`;
  if (result.state === 'cleared') return `channel-failure-cleared — removed Claude's cached recent failure of the aweb-channel plugin (stamped ${result.stampedAt}) from ${result.file}, so this start connects to the channel`;
  if (result.state === 'unrecognized') return `channel-cache-unrecognized — ${result.file} is not in the shape OATS reads (${result.detail}), so OATS left it alone; ${consequence}`;
  if (result.state === 'changed') return `channel-cache-changed — ${result.file} kept changing while OATS read it (another Claude writing it), so OATS left it alone; ${consequence}`;
  return undefined;
}

/** Where Claude writes its MCP logs on this platform (env-paths' cache dir
 *  for "claude-cli" with its "-nodejs" suffix), or undefined where unknown. */
export function claudeLogRoot(env = process.env, platform = process.platform) {
  if (!absolute(env.HOME)) return undefined;
  if (platform === 'darwin') return join(env.HOME, 'Library', 'Caches', 'claude-cli-nodejs');
  if (platform === 'win32') return undefined;
  return join(absolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(env.HOME, '.cache'), 'claude-cli-nodejs');
}

const projectKey = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-');
const canon = path => { try { return realpathSync(path); } catch { return path; } };
const entries = dir => { try { return readdirSync(dir); } catch { return []; } };

/** Claude's project directories that may hold `home`'s logs: by its exact key,
 *  or, for a key past Claude's cut, every directory with that prefix (each
 *  line's cwd then decides). */
function projectDirs(root, homes) {
  const dirs = new Set();
  for (const home of homes) {
    const key = projectKey(home);
    if (key.length <= PROJECT_KEY_MAX) dirs.add(join(root, key));
    else for (const name of entries(root)) if (name.startsWith(`${key.slice(0, PROJECT_KEY_MAX)}-`)) dirs.add(join(root, name));
  }
  return [...dirs];
}

/** The start time in a log file's name (one file per Claude process), or NaN. */
function fileStartedAt(name) {
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z\.jsonl$/.exec(name);
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`) : NaN;
}

/** When Claude registered the aweb channel for `home` at or after `since`
 *  (ms), as its log line states it, or undefined. */
function registeredSince(root, home, since) {
  const homes = [...new Set([home, canon(home)])];
  const cwds = new Set(homes.map(canon));
  for (const dir of projectDirs(root, homes)) {
    const logs = join(dir, LOG_DIR);
    for (const name of entries(logs)) {
      if (!name.endsWith('.jsonl')) continue;
      // A process started before the start cannot have registered for it.
      if (fileStartedAt(name) < since) continue;
      let text;
      try { text = readFileSync(join(logs, name), 'utf8'); } catch { continue; }
      for (const raw of text.split('\n')) {
        if (!raw.includes(REGISTERED)) continue;
        let row;
        try { row = JSON.parse(raw); } catch { continue; }
        const at = Date.parse(row?.timestamp);
        if (row?.debug === REGISTERED && at >= since && typeof row.cwd === 'string' && cwds.has(canon(row.cwd))) return new Date(at).toISOString();
      }
    }
  }
  return undefined;
}

/** Whether the home's last start (`startedAt`, ms) is on the aweb channel:
 *  registered (with when), pending inside the connect window, not-connected
 *  after it, or unproven when the start or the log root is unknown. */
export function channelConnection({home, startedAt, now = Date.now(), env = process.env, platform = process.platform, windowMs = CHANNEL_CONNECT_WINDOW_MS}) {
  if (!Number.isFinite(startedAt)) return {state: 'unproven', reason: 'the home has no recorded start'};
  const root = claudeLogRoot(env, platform);
  if (!root) return {state: 'unproven', reason: `Claude's MCP log location is unknown on ${platform}`};
  const at = registeredSince(root, home, startedAt);
  if (at) return {state: 'registered', at};
  const since = new Date(startedAt).toISOString();
  return now - startedAt < windowMs ? {state: 'pending', since} : {state: 'not-connected', since};
}

/** The readiness items for a Claude channel home's connection: problems,
 *  warnings, and the message of its native-receive-unproven warning. */
export function channelReadiness(connection, home) {
  const restart = `restart the session: oats session restart --home ${home}`;
  const stream = "registration is not proof that the plugin's aweb event stream is up";
  const unproven = 'native receive connection is unproven: plugin/extension configuration and confirmation do not establish connected receive';
  if (connection.state === 'registered') return {problems: [], warnings: [], receiveMessage: `native receive connection is unproven: Claude registered the aweb channel for this start at ${connection.at} (its MCP log), but that is not proof that the plugin's aweb event stream is up`};
  if (connection.state === 'pending') return {problems: [], warnings: [{code: 'channel-connection-pending', message: `Claude has not registered the aweb channel yet for the start at ${connection.since}; readiness reports channel-not-connected if its "${REGISTERED}" line has not appeared ${CHANNEL_CONNECT_WINDOW_MS / 1000} s after the start (${stream})`}], receiveMessage: unproven};
  if (connection.state === 'not-connected') return {problems: [{code: 'channel-not-connected', message: `this Claude session is not on the aweb channel: its MCP log has no "${REGISTERED}" line for this home since the start at ${connection.since}, so it hears no mail. Claude skips the plugin after a recent failure cached in <CLAUDE_CONFIG_DIR>/mcp-needs-auth-cache.json, or the plugin failed to start; ${restart}`}], warnings: [], receiveMessage: unproven};
  return {problems: [], warnings: [{code: 'channel-connection-unproven', message: `whether Claude registered the aweb channel is unknown: ${connection.reason}`}], receiveMessage: unproven};
}

// Read-only evidence for the approved Claude channel route: whether the
// machine's file-based managed settings admit aweb-channel. The file is
// evidence, not proof: server-managed settings or MDM take precedence over it
// when present, and only a nonce exchange proves receive (oats-aweb skill,
// section 4). Nothing here writes, and no environment variable moves the path.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

export const AWEB_CHANNEL_ENTRY = Object.freeze({plugin: 'aweb-channel', marketplace: 'awebai-marketplace'});

// Claude Code's documented system directories for managed-settings.json and
// managed-settings.d/ (code.claude.com/docs/en/managed-settings.md).
const MANAGED_SETTINGS_DIRS = Object.freeze({
  linux: '/etc/claude-code',
  darwin: '/Library/Application Support/ClaudeCode',
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One managed document: {absent}, {doc}, {error} or {malformed}. An empty
 *  file is {}. Only a regular file is read, so a FIFO or device cannot stall. */
function readDocument(file) {
  let text;
  try {
    if (!statSync(file).isFile()) return {error: `${file} is unreadable (not a regular file)`};
    text = readFileSync(file, 'utf8');
  } catch (error) { return error.code === 'ENOENT' ? {absent: true} : {error: `${file} is unreadable (${error.code || 'read failed'})`}; }
  if (!text.trim()) return {doc: {}};
  let doc;
  try { doc = JSON.parse(text); } catch { return {malformed: `${file} is not valid JSON`}; }
  return object(doc) ? {doc} : {malformed: `${file} is not a JSON object`};
}

/** The machine managed-settings policy for aweb-channel, as one of
 *  {state: 'admitted', sources}, {state: 'not-admitted', missing, sources},
 *  {state: 'malformed', reason} or {state: 'unknown', reason}. Files merge as Claude Code documents them:
 *  managed-settings.json first, then managed-settings.d/*.json in alphabetical
 *  order (hidden files skipped); a later single value replaces an earlier one
 *  and lists combine. `root` exists for tests only; production passes none. */
export function readClaudeManagedPolicy({platform = process.platform, root = '/'} = {}) {
  const base = MANAGED_SETTINGS_DIRS[platform];
  if (!base) return {state: 'unknown', platform: false, reason: `no machine managed-settings location is known for platform ${platform}`};
  const dir = join(root, base), file = join(dir, 'managed-settings.json'), dropins = join(dir, 'managed-settings.d');
  const files = [file];
  try {
    // Code-unit order: the documented "alphabetical" order for plain names.
    files.push(...readdirSync(dropins).filter(name => !name.startsWith('.') && name.endsWith('.json')).sort().map(name => join(dropins, name)));
  } catch (error) {
    if (error.code !== 'ENOENT') return {state: 'unknown', reason: `${dropins} is unreadable (${error.code || 'read failed'})`};
  }
  const sources = [];
  let channelsEnabled, plugins;
  for (const path of files) {
    const read = readDocument(path);
    if (read.error) return {state: 'unknown', reason: read.error};
    if (read.malformed) return {state: 'malformed', reason: read.malformed};
    if (read.absent) continue;
    sources.push(path);
    if (Object.hasOwn(read.doc, 'channelsEnabled')) channelsEnabled = read.doc.channelsEnabled;
    if (Object.hasOwn(read.doc, 'allowedChannelPlugins')) plugins = [...(plugins || []), ...(Array.isArray(read.doc.allowedChannelPlugins) ? read.doc.allowedChannelPlugins : [])];
  }
  if (!sources.length) return {state: 'unknown', reason: `no managed-settings file at ${file} or ${dropins}/*.json`};
  const missing = [];
  // Pro/Max accounts are not gated by channelsEnabled; API-key and Team/Enterprise are.
  if (channelsEnabled !== true) missing.push(`${channelsEnabled === undefined ? 'channelsEnabled is absent' : 'channelsEnabled is not true'} (required for API-key and Team/Enterprise accounts)`);
  const entries = (plugins || []).filter(object);
  if (plugins === undefined) missing.push('allowedChannelPlugins is absent');
  else if (!entries.some(e => e.plugin === AWEB_CHANNEL_ENTRY.plugin && e.marketplace === AWEB_CHANNEL_ENTRY.marketplace)) {
    const named = entries.filter(e => e.plugin === AWEB_CHANNEL_ENTRY.plugin);
    missing.push(!named.length ? `allowedChannelPlugins has no {plugin: "aweb-channel", marketplace: "${AWEB_CHANNEL_ENTRY.marketplace}"} entry`
      : named.every(e => e.marketplace === undefined) ? `allowedChannelPlugins lists aweb-channel with no marketplace; it needs marketplace "${AWEB_CHANNEL_ENTRY.marketplace}"`
      : `allowedChannelPlugins lists aweb-channel from another marketplace, not ${AWEB_CHANNEL_ENTRY.marketplace}`);
  }
  return missing.length ? {state: 'not-admitted', missing, sources} : {state: 'admitted', sources};
}

/** The readiness warning for a home whose captured mode is approved. */
export function approvedChannelPolicyWarning(options) {
  let policy;
  try { policy = readClaudeManagedPolicy(options); }
  catch (error) { policy = {state: 'unknown', reason: `the managed-settings read failed (${error.code || 'unexpected error'})`}; }
  const caveat = 'server-managed settings or MDM, if present, take precedence over this file and are not visible to this check; only the nonce exchange proves receive (oats-aweb skill, section 4)';
  if (policy.state === 'admitted') return {code: 'claude-channel-policy-admitted', message: `the machine managed-settings file (${policy.sources.join(', ')}) sets channelsEnabled and lists aweb-channel@awebai-marketplace in allowedChannelPlugins; this is evidence, not proof: ${caveat}`};
  if (policy.state === 'not-admitted') return {code: 'claude-channel-policy-not-admitted', message: `the machine managed-settings file (${policy.sources.join(', ')}) does not set up the approved route: ${policy.missing.join('; ')}; an admin fixes it as in section 4 host step 1; ${caveat}`};
  if (policy.state === 'malformed') return {code: 'claude-channel-policy-malformed', message: `approved mode: a machine managed-settings file is malformed: ${policy.reason}; Claude Code documents that it refuses to start while a managed-settings file cannot be parsed, so an admin repairs it (section 4 host step 1)`};
  const remedy = policy.platform === false ? 'section 4 names machine files for Linux and macOS only' : 'an admin writes it as in section 4 host step 1';
  return {code: 'claude-channel-enrollment-unverified', message: `approved mode: whether the host admits aweb-channel is unknown: ${policy.reason}; ${remedy}; ${caveat}`};
}

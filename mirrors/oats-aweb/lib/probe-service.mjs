// Read only the native workspace format qualified at aw 1.36.28. This is a
// conservative projection, not a YAML implementation or a configuration writer.
import {openSync, readSync, closeSync, fstatSync, constants, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {refuse} from './probe-runtime.mjs';
const topKeys = new Set(['aweb_url', 'api_key', 'active_team', 'memberships', 'human_name', 'agent_type', 'repo_id', 'canonical_origin', 'aweb_tmux_tmpdir', 'hostname', 'workspace_path', 'updated_at']);
const memberKeys = new Set(['team_id', 'alias', 'role_name', 'workspace_id', 'cert_path', 'joined_at']);
const invalid = () => refuse('selected-service-config-unavailable');
function scalar(raw) {
  if (!raw || /[\x00-\x1f\x7f]/.test(raw)) invalid();
  if (raw.startsWith('"')) {
    try { const v = JSON.parse(raw); if (typeof v === 'string' && !/[\r\n\x00]/.test(v)) return v; } catch { /* not a qualified scalar */ }
    invalid();
  }
  if (raw.startsWith("'")) {
    if (/^'(?:[^']|'')*'$/.test(raw)) return raw.slice(1, -1).replaceAll("''", "'");
    invalid();
  }
  if (/^[\w/][^\[\]{}&*!|>'"`#]*$/.test(raw) && !raw.includes(': ') && !raw.endsWith(':')) return raw;
  invalid();
}
export function projectWorkspaceService(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u0085\u2028\u2029]/.test(text)) invalid();
  const seen = new Set(); let service, inMembers = false, memberSeen, memberIndent;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^ *#/.test(line)) continue;
    const top = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (top) {
      const [, key, value = ''] = top;
      if (!topKeys.has(key) || seen.has(key)) invalid();
      seen.add(key); inMembers = key === 'memberships'; memberSeen = undefined;
      if (inMembers) { if (value !== '' && value !== '[]') invalid(); inMembers = value === ''; continue; }
      const parsed = scalar(value);
      if (key === 'aweb_url') service = parsed;
      continue;
    }
    const member = /^( +)(- )?([a-z_]+): (.+)$/.exec(line);
    if (!inMembers || !member || !memberKeys.has(member[3])) invalid();
    if (member[2]) { memberSeen = new Set(); memberIndent = member[1].length + 2; }
    else if (!memberSeen || member[1].length !== memberIndent) invalid();
    if (memberSeen.has(member[3])) invalid();
    memberSeen.add(member[3]); scalar(member[4]);
  }
  if (typeof service !== 'string' || !service || service !== service.trim()) invalid();
  return service;
}
export function readWorkspaceService(identityHome) {
  let fd;
  try {
    const path = join(identityHome, 'workspace.yaml');
    if (realpathSync(path) !== path) invalid();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) invalid();
    const bytes = Buffer.alloc(65537); let size = 0, n;
    while (size < bytes.length && (n = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += n;
    if (size > 65536) invalid();
    const content = bytes.subarray(0, size);
    const text = new TextDecoder('utf-8', {fatal: true}).decode(content);
    return {awebUrl: projectWorkspaceService(text), digest: createHash('sha256').update(content).digest('hex')};
  } catch { invalid(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

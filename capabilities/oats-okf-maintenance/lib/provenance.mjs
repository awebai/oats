// The okf-harvest provenance block (plan C3), as the maintainer reads it from a
// PR body. The body is untrusted: the block is parsed strictly, every field is
// shape-checked, and the result is data — strings to verify, never commands.
const FENCE = /^```okf-harvest[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const NODE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/** → { valid, problems[], value|null } for the FIRST okf-harvest block in `body`. */
export function parseProvenance(body) {
  const problems = [];
  if (typeof body !== 'string') return { valid: false, problems: ['the PR has no body'], value: null };
  const m = FENCE.exec(body);
  if (!m) return { valid: false, problems: ['no ```okf-harvest provenance block in the PR body'], value: null };
  if (m[1].length > 64 * 1024) return { valid: false, problems: ['provenance block exceeds 64KiB'], value: null };
  let v;
  try { v = JSON.parse(m[1]); } catch (e) { return { valid: false, problems: [`provenance block is not JSON (${e.message})`], value: null }; }
  const need = (cond, what) => { if (!cond) problems.push(what); return cond; };
  const only = (value, keys, at) => { for (const k of Object.keys(value)) if (!keys.includes(k)) problems.push(`${at}: unknown key ${JSON.stringify(k).slice(0, 80)}`); };
  if (!need(obj(v), 'provenance must be an object')) return { valid: false, problems, value: null };
  only(v, ['version', 'run', 'input', 'source', 'tasks', 'harvester'], 'provenance');
  need(v.version === 1, 'version must be 1');
  need(typeof v.run === 'string' && /^[0-9a-f-]{36}$/.test(v.run), 'run must be a run id');
  need(Array.isArray(v.input) && v.input.length > 0 && v.input.length <= 1000 && v.input.every((i) => typeof i === 'string' && /^[0-9a-f]{64}$/.test(i)), 'input must be a non-empty list of 64-hex input ids');
  if (need(obj(v.source), 'source must be an object')) {
    const s = v.source;
    only(s, ['soul', 'soulId', 'instance', 'ownedNodes', 'readNodes', 'bases'], 'source');
    need(str(s.soul, 128), 'source.soul must be a name');
    need(s.soulId === null || str(s.soulId, 512), 'source.soulId must be a string or null');
    need(str(s.instance, 128), 'source.instance must be a name');
    for (const k of ['ownedNodes', 'readNodes']) need(Array.isArray(s[k]) && s[k].length <= 256 && s[k].every((n) => typeof n === 'string' && NODE.test(n)), `source.${k} must be a list of base/node`);
    need(Array.isArray(s.bases) && s.bases.length <= 64 && s.bases.every((b) => obj(b) && Object.keys(b).every((k) => ['alias', 'id', 'kind', 'root', 'repository'].includes(k)) && str(b.alias, 64) && str(b.id, 128) && ['git', 'directory'].includes(b.kind) && (b.root === undefined || str(b.root, 512)) && (b.repository === undefined || str(b.repository, 512))), 'source.bases must be a list of {alias, id, kind, root?, repository?}');
  }
  if (need(obj(v.tasks), 'tasks must be an object')) {
    only(v.tasks, ['provider', 'refs'], 'tasks');
    need(v.tasks.provider === null || str(v.tasks.provider, 128), 'tasks.provider must be a capability id or null');
    need(Array.isArray(v.tasks.refs) && v.tasks.refs.length <= 100 && v.tasks.refs.every((r) => str(r, 256)), 'tasks.refs must be a list of up to 100 strings');
  }
  if (need(obj(v.harvester), 'harvester must be an object')) {
    only(v.harvester, ['instance', 'alias'], 'harvester');
    need(str(v.harvester.instance, 128), 'harvester.instance must be a name');
    need(v.harvester.alias === null || str(v.harvester.alias, 256), 'harvester.alias must be a string or null');
  }
  return { valid: problems.length === 0, problems, value: problems.length ? null : v };
}

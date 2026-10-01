/** `oats capabilities show <name> (--member <repoKey> | --package <id>) [--file <path>] --json`
 * (feature `capability-show`, `capabilityShowApi: 1`): what a capability ships — its injected
 * instructions and its skills' files — read at the commit the catalog reports. Shared by the
 * zero-dependency server (it validates before caching) and the capability page's Contents reader.
 *
 * The decoder is strict and bounded: an unknown API version, a field of the wrong type, an
 * oversize string or list, or a path that is not a plain relative POSIX path inside the
 * capability refuses the WHOLE answer (null), never a partial render. Presentation-only: nothing
 * here infers a file the kernel did not list. */

export const CAPABILITY_SHOW_API = 1;
export const CAPABILITY_SHOW_FEATURE = 'capability-show';
/** What a kernel answer this Desktop cannot read says (the failed state's message). */
export const CAPABILITY_SHOW_UNREADABLE = "This Desktop can't read what this OATS version reports about the capability. Update OATS Desktop.";

/** Bounds. A file's text is at most 256 KiB (the kernel truncates there, `truncated: true`). */
export const FILE_TEXT_MAX_BYTES = 256 * 1024;
export const LIMITS = Object.freeze({ path: 1024, skills: 256, files: 200, description: 1024, problems: 64, message: 4096, code: 128, name: 128 });

const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const CONTROL = /[\u0000-\u001f\u007f]/;
const CAPABILITY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/; // the kernel's package-id grammar, bounded
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export const validCapabilityName = v => typeof v === 'string' && CAPABILITY_NAME.test(v);
export const validPackageId = v => typeof v === 'string' && PACKAGE_ID.test(v);
/** A repository key is the kernel's to parse; the Desktop refuses only what could not be one argv value. */
export const validRepoKey = v => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.path && v.trim() === v && !CONTROL.test(v) && !v.startsWith('-');
/** A plain relative POSIX path inside the capability: no leading `/`, no `.`/`..`/empty segment,
 * no backslash, no control character, not option-looking, bounded. */
export function validRelativePath(v) {
  if (typeof v !== 'string' || !v || v.length > LIMITS.path || CONTROL.test(v) || v.includes('\\') || v.startsWith('-') || v.startsWith('/')) return false;
  return v.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** The connected CLI can answer `capabilities show` (the feature AND the API integer; never a version number). */
export const capabilityShowSupported = cli => cli?.ok === true && Array.isArray(cli.features) && cli.features.includes(CAPABILITY_SHOW_FEATURE)
  && cli.capabilityShowApi === CAPABILITY_SHOW_API;

/** The verb's selector for a catalog row: { name, kind: 'member', repoKey } | { name, kind: 'package', package };
 * null for a row the verb cannot address (an external capability, a malformed row). */
export function capabilitySelector(row) {
  if (!record(row) || !validCapabilityName(row.name)) return null;
  if (row.kind === 'member' && validRepoKey(row.repoKey)) return { name: row.name, kind: 'member', repoKey: row.repoKey };
  if (row.kind === 'package' && validPackageId(row.package)) return { name: row.name, kind: 'package', package: row.package };
  return null;
}
/** The same selector, validated as a request body field (the server's half: exact keys only). */
export function selectorOf(v) {
  if (!record(v)) return null;
  const keys = Object.keys(v).sort().join(',');
  if (v.kind === 'member' && keys === 'kind,name,repoKey') return capabilitySelector(v);
  if (v.kind === 'package' && keys === 'kind,name,package') return capabilitySelector(v);
  return null;
}
export const sameSelector = (a, b) => !!a && !!b && a.name === b.name && a.kind === b.kind && (a.kind === 'member' ? a.repoKey === b.repoKey : a.package === b.package);

/* ── the decoder ─────────────────────────────────────────────────────────── */
class Unreadable extends Error {}
const refuse = () => { throw new Unreadable(); };
const byteLength = s => new TextEncoder().encode(s).byteLength;
function str(v, max) { if (typeof v !== 'string' || v.length > max) refuse(); return v; }
function nullableStr(v, max) { return v === null ? null : str(v, max); }
function path(v) { if (!validRelativePath(v)) refuse(); return v; }
function bytes(v) { if (v === null) return null; if (!Number.isSafeInteger(v) || v < 0) refuse(); return v; }
function bool(v) { if (typeof v !== 'boolean') refuse(); return v; }

/** File = { path, bytes: number|null, text: string|null, binary, truncated }, the kernel's invariants: text is at
 * most 256 KiB of UTF-8 (truncated or not); a binary file has no text and is never truncated; a truncated one has
 * text. `text: null` on a text file (and `bytes: null`) happens only for an unreadable declared inject, which a
 * problem names: never in a `--file` answer (`fileAnswer`). An inject's `path` is null when the manifest's value
 * is not a safe relative path (a problem with `path: null` carries the raw value); then it has no content. */
function file(v, { fileAnswer = false, inject = false } = {}) {
  if (!record(v)) refuse();
  const out = { path: inject && v.path === null ? null : path(v.path), bytes: bytes(v.bytes), text: nullableStr(v.text, FILE_TEXT_MAX_BYTES), binary: bool(v.binary), truncated: bool(v.truncated) };
  if (out.text !== null && byteLength(out.text) > FILE_TEXT_MAX_BYTES) refuse();
  if (out.binary && (out.text !== null || out.truncated)) refuse();
  if (out.truncated && out.text === null) refuse();
  if (fileAnswer && (out.bytes === null || (!out.binary && out.text === null))) refuse();
  if (out.path === null && (out.text !== null || out.binary || out.bytes !== null)) refuse();
  return out;
}
/** A skill's `files` is null when its directory could not be listed (a problem names the skill's path; never
 * truncated then); a listed skill always has at least its SKILL.md. */
function skill(v) {
  if (!record(v)) refuse();
  const files = v.files === null ? null : Array.isArray(v.files) && v.files.length > 0 && v.files.length <= LIMITS.files ? v.files : refuse();
  const description = nullableStr(v.description ?? null, 4 * LIMITS.description);
  if (description !== null && byteLength(description) > LIMITS.description) refuse();
  const out = { name: str(v.name, LIMITS.name), path: path(v.path), description,
    files: files && files.map(f => { if (!record(f)) refuse(); return { path: path(f.path), bytes: bytes(f.bytes) }; }), filesTruncated: bool(v.filesTruncated) };
  if (!out.name || CONTROL.test(out.name)) refuse();
  if (out.files === null) { if (out.filesTruncated) refuse(); return out; }
  // Every path is relative to the capability directory: a skill's files sit under its own directory.
  if (out.files.some(f => !f.path.startsWith(`${out.path}/`))) refuse();
  if (new Set(out.files.map(f => f.path)).size !== out.files.length) refuse();
  return out;
}
function problem(v) {
  if (!record(v)) refuse();
  const code = str(v.code, LIMITS.code);
  if (!CODE.test(code)) refuse();
  return { code, message: str(v.message, LIMITS.message), path: v.path === null || v.path === undefined ? null : path(v.path) };
}
function head(v, name) {
  if (!record(v) || v.capabilityShowApi !== CAPABILITY_SHOW_API) refuse();
  if (!validCapabilityName(v.name) || (name !== undefined && v.name !== name)) refuse();
  if (!['member', 'package'].includes(v.kind)) refuse();
  if (typeof v.commit !== 'string' || !COMMIT.test(v.commit)) refuse();
}

/** The show answer, normalized, or null when this Desktop cannot read it. `name` / `selector`: the capability
 * asked for (an answer about another capability, or the same name from another member or package, is refused). Every path — the inject's, a skill's, a skill file's — is
 * relative to the capability directory: what `--file` takes, verbatim. */
export function capabilityShowData(v, { selector, name = selector?.name } = {}) {
  try {
    head(v, name);
    if (v.kind === 'member' ? !validRepoKey(v.repoKey) : !(validPackageId(v.package) && (v.repoKey === null || v.repoKey === undefined || validRepoKey(v.repoKey)))) refuse();
    if (selector && (v.kind !== selector.kind || (v.kind === 'member' ? v.repoKey !== selector.repoKey : v.package !== selector.package))) refuse();
    const skills = v.skills === null ? null : Array.isArray(v.skills) && v.skills.length <= LIMITS.skills ? v.skills.map(skill) : refuse();
    if (skills && new Set(skills.map(s => s.path)).size !== skills.length) refuse();
    const problems = Array.isArray(v.problems) && v.problems.length <= LIMITS.problems ? v.problems.map(problem) : refuse();
    return {
      capabilityShowApi: CAPABILITY_SHOW_API, name: v.name, kind: v.kind, repoKey: v.repoKey ?? null,
      package: v.kind === 'package' ? v.package : null, version: v.version === null || v.version === undefined ? null : str(v.version, 64),
      commit: v.commit, path: v.path === null || v.path === undefined ? null : str(v.path, LIMITS.path),
      inject: v.inject === null ? null : file(v.inject, { inject: true }), skills, problems,
    };
  } catch (error) { if (error instanceof Unreadable) return null; throw error; }
}
/** The `--file` answer, normalized, or null when unreadable or not about `name` / `path`. */
export function capabilityFileData(v, { selector, name = selector?.name, path: asked } = {}) {
  try {
    head(v, name);
    if (selector && v.kind !== selector.kind) refuse();
    const out = { capabilityShowApi: CAPABILITY_SHOW_API, name: v.name, kind: v.kind, commit: v.commit, file: file(v.file, { fileAnswer: true }) };
    if (asked !== undefined && out.file.path !== asked) refuse();
    return out;
  } catch (error) { if (error instanceof Unreadable) return null; throw error; }
}

/** A skill file's path relative to the capability root (what `--file` takes): the kernel's, verbatim. */
export const skillFilePath = (skill, file) => file.path;
/** The same path relative to its skill's directory (what the navigation shows). */
export const skillRelativePath = (skill, file) => file.path.slice(skill.path.length + 1);
/** Every file the answer lists, by its path relative to the capability root (what `--file` may be asked for):
 * the inject (when its path is safe), then each listed skill's files. */
export function listedFiles(show) {
  const out = new Map();
  if (show?.inject?.path) out.set(show.inject.path, { kind: 'inject', file: show.inject });
  for (const skill of show?.skills || []) for (const f of skill.files || []) out.set(skillFilePath(skill, f), { kind: 'skill', skill, file: f });
  return out;
}

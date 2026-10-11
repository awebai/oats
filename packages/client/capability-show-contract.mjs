/** `oats capabilities show <name> (--member <repoKey> | --package <id>) [--file <path>] --json`
 * (feature `capability-show`, `capabilityShowApi: 1`): what a capability ships — its injected
 * instructions and its skills' files — read at the commit the catalog reports. Shared by the
 * zero-dependency server (it validates before caching) and the capability page's Contents reader.
 *
 * The decoder is strict and bounded: an unknown API version, a field of the wrong type, an
 * oversize string or list, or a path that is not a plain relative POSIX path inside the
 * capability refuses the WHOLE answer (null), never a partial render. Presentation-only: nothing
 * here infers a file the kernel did not list. The tolerant fields: `warnings` (OATS 0.49.0), projected by
 * capability-warnings-contract.mjs, and `triggerSources` / `triggerSourceProblems` (feature `trigger-sources`),
 * projected below: never a reason to refuse the answer (an older kernel sends none). */
import { warningsOf } from './capability-warnings-contract.mjs';

export const CAPABILITY_SHOW_API = 1;
export const CAPABILITY_SHOW_FEATURE = 'capability-show';
/** What a kernel answer this Desktop cannot read says (the failed state's message). */
export const CAPABILITY_SHOW_UNREADABLE = "This Desktop can't read what this OATS version reports about the capability. Update OATS Desktop.";

/** Bounds. A file's text is at most 256 KiB (the kernel truncates there, `truncated: true`). */
export const FILE_TEXT_MAX_BYTES = 256 * 1024;
export const LIMITS = Object.freeze({ path: 1024, skills: 256, files: 200, description: 1024, problems: 64, message: 4096, code: 128, name: 128,
  sources: 16, events: 16, event: 64 });

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

/* ── trigger sources (feature `trigger-sources`) ─────────────────────────── */
/** A string held to `max` UTF-16 units, cut there (never inside a surrogate pair): cutting twice equals cutting once. */
function cut(s, max) {
  if (s.length <= max) return s;
  const last = s.charCodeAt(max - 1);
  return s.slice(0, last >= 0xD800 && last <= 0xDBFF ? max - 1 : max);
}
/** One declared source as far as the page shows it: { events, description? }, or null when the value is not that
 * shape. `command`, `parameters`, `fields` and `urlHosts` are not shown, so they are not relayed. */
function triggerSourceOf(v) {
  if (!record(v) || !Array.isArray(v.events)) return null;
  const events = v.events.filter(e => typeof e === 'string').slice(0, LIMITS.events).map(e => cut(e, LIMITS.event));
  return { events, ...(typeof v.description === 'string' ? { description: cut(v.description, LIMITS.description) } : {}) };
}
/** The manifest's `triggerSources`, which the kernel answers exactly as written, whatever its shape: null when it
 * is not an object (declared, not readable; the raw value is not relayed), else its first LIMITS.sources entries in
 * the kernel's order, each name bounded and each value a `triggerSourceOf`. Every string is the manifest's:
 * untrusted, shown only as quoted text (source-quote.mjs). Built from entries, never by assignment: a manifest key
 * may be `__proto__`. Tolerant, bounded and idempotent, like `warningsOf`. */
export function triggerSourcesOf(v) {
  if (!record(v)) return null;
  return Object.fromEntries(Object.entries(v).slice(0, LIMITS.sources).map(([name, value]) => [cut(name, LIMITS.name), triggerSourceOf(value)]));
}
/** `triggerSourceProblems`: [{ source, pointer, message }], the kernel's text (what a trigger naming the source
 * gets as E_TRIGGER_SOURCE). `source: null` is a top-level problem; `pointer` a JSON pointer into the manifest.
 * An entry that is not an object or has no message is skipped; at most LIMITS.problems are kept. They are never
 * `problems`: a malformed declaration does not fail the capability. */
export function triggerSourceProblemsOf(v) {
  const out = [];
  for (const entry of Array.isArray(v) ? v : []) {
    if (!record(entry) || typeof entry.message !== 'string') continue;
    out.push({ source: typeof entry.source === 'string' ? cut(entry.source, LIMITS.name) : null,
      pointer: typeof entry.pointer === 'string' ? cut(entry.pointer, LIMITS.path) : null, message: cut(entry.message, LIMITS.message) });
    if (out.length === LIMITS.problems) break;
  }
  return out;
}
/** What the capability page says about the declaration, from a projected answer (presentation-free):
 * null — the manifest declares none (or an older kernel answered);
 * { unreadable: [the kernel's messages] } — it is not an object, or a top-level problem (`source: null`) disables
 *   every source; the messages may be none;
 * { sources: [{ name, events: [..] | null, description: string | null, problems: [the kernel's messages] }] } —
 *   the listed sources in the kernel's order, then every source a problem names that the listing does not hold,
 *   at most LIMITS.sources. A source with a problem, or with `events: null` (its value is not a source's shape),
 *   is declared but not usable. */
export function triggerSourcesView(show) {
  if (!record(show) || !Object.hasOwn(show, 'triggerSources')) return null;
  const declared = show.triggerSources, problems = Array.isArray(show.triggerSourceProblems) ? show.triggerSourceProblems.filter(record) : [];
  const top = problems.filter(p => p.source === null);
  if (!record(declared) || top.length) return { unreadable: (record(declared) ? top : problems).map(p => p.message) };
  const sources = Object.entries(declared).map(([name, value]) => ({ name, events: Array.isArray(value?.events) ? value.events : null,
    description: typeof value?.description === 'string' ? value.description : null, problems: [] }));
  const named = new Map(sources.map(source => [source.name, source]));
  for (const p of problems) {
    if (!named.has(p.source)) { const source = { name: p.source, events: null, description: null, problems: [] }; named.set(p.source, source); sources.push(source); }
    named.get(p.source).problems.push(p.message);
  }
  return { sources: sources.slice(0, LIMITS.sources) };
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
      // Tolerant and idempotent: the server's projection, relayed, projects to itself in the renderer.
      warnings: warningsOf(v.warnings),
      // Only when the kernel answers them (feature `trigger-sources`: the manifest declares the key; the problems
      // follow only when it has some), so an older kernel's answer projects as before. Never `problems`.
      ...(Object.hasOwn(v, 'triggerSources') ? { triggerSources: triggerSourcesOf(v.triggerSources) } : {}),
      ...(Array.isArray(v.triggerSourceProblems) ? { triggerSourceProblems: triggerSourceProblemsOf(v.triggerSourceProblems) } : {}),
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

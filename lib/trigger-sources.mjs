/** A capability manifest's trigger sources (`triggerSources`, #669; docs/capabilities.md "Trigger sources"):
 *  the use-time validator. A source is one of the capability's own commands that, at each poll, lists the
 *  events due now; the kernel keeps everything after that (lib/triggers.mjs).
 *
 *  Containment (the trigger-as-gate decision): a malformed `triggerSources` never refuses the capability. This
 *  module is called only where a source is used — `trigger add`, a poll, `trigger test`, `trigger poll` and
 *  `capabilities show` — and never from manifestContractProblems, the manifest loader, discovery or the lock:
 *  a trigger naming a malformed source fails E_TRIGGER_SOURCE, and nothing else changes.
 *
 *  Validity is per source: a problem inside one source disables only that source; a malformed top level (not an
 *  object, more than MAX_SOURCES) disables every source. docs/capability-manifest.schema.json carries the same
 *  closed shape; what JSON Schema cannot say (a pattern compiles, `command` names one of `commands`, a parameter
 *  default matches its pattern) is checked here only.
 *
 *  Patterns compile once, with the `u` flag: the flag JSON Schema's `pattern` uses (Ajv compiles with it), so
 *  an author's pattern means the same in the published schema's tooling and here. Every pattern is anchored:
 *  it is wrapped as `^(?:…)$`, which leaves an already anchored pattern's meaning unchanged and anchors one
 *  like `^a|b$` whose alternatives are not. */

import { safeText } from "./refused-text.mjs";

export const SOURCE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A parameter value, when the parameter declares no pattern. */
export const DEFAULT_PARAM_PATTERN = "^[A-Za-z0-9._/:@ ,*-]{0,200}$";
/** A field value, when the field declares no pattern. */
export const DEFAULT_FIELD_PATTERN = "^[A-Za-z0-9._/:@-]{1,200}$";
const MAX_SOURCES = 16, MAX_EVENTS = 16, MAX_PARAMETERS = 16, MAX_FIELDS = 16, MAX_URL_HOSTS = 16, TEXT_MAX = 200;
const EVENT_RE = /^[a-z][a-z0-9_]{0,39}$/;
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
/** An exact lowercase hostname: no scheme, port, wildcard or trailing dot. */
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
/** One line: no control character (C0, DEL, C1) and no line or paragraph separator. */
const ONE_LINE_RE = /^[^\p{Cc}\u2028\u2029]*$/u;
const SOURCE_KEYS = ["command", "description", "events", "parameters", "fields", "urlHosts"];
const PARAMETER_KEYS = ["required", "default", "description", "pattern"];
const FIELD_KEYS = ["pattern"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chars = (s) => [...s].length;
/** An RFC 6901 pointer from its reference tokens. */
const pointerOf = (...tokens) => tokens.map((t) => `/${String(t).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
const oneLine = (v) => typeof v === "string" && chars(v) <= TEXT_MAX && ONE_LINE_RE.test(v);
/** `src` compiled and anchored, or null when it does not compile. */
function compile(src) {
  try { return new RegExp(`^(?:${src})$`, "u"); } catch { return null; }
}

/** Validate one source. → the normalized source, or null after pushing its problems. */
function checkSource(manifest, name, decl, problems) {
  const at = (...tokens) => pointerOf("triggerSources", name, ...tokens);
  const bad = (pointer, message) => problems.push({ source: name, pointer, message: `trigger source ${JSON.stringify(name)}: ${message}` });
  if (!SOURCE_NAME_RE.test(name)) bad(at(), "the name must be 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit");
  if (!isObject(decl)) { bad(at(), "must be an object { command, events, description?, parameters?, fields?, urlHosts? }"); return null; }
  for (const k of Object.keys(decl)) if (!SOURCE_KEYS.includes(k)) bad(at(k), `unknown key ${JSON.stringify(k)} (allowed: ${SOURCE_KEYS.join(", ")})`);

  const commands = isObject(manifest.commands) ? manifest.commands : {};
  const spec = typeof decl.command === "string" && Object.hasOwn(commands, decl.command) ? commands[decl.command] : undefined;
  if (typeof decl.command !== "string" || !decl.command) bad(at("command"), "command must name one of the manifest's commands");
  else if (typeof spec !== "string" || !spec.trim()) bad(at("command"), `command ${JSON.stringify(decl.command)} is not one of the manifest's commands`);

  if (decl.description !== undefined && !oneLine(decl.description)) bad(at("description"), `description must be one line of at most ${TEXT_MAX} characters`);

  const events = decl.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS) bad(at("events"), `events must list 1 to ${MAX_EVENTS} event names`);
  else {
    events.forEach((e, i) => { if (typeof e !== "string" || !EVENT_RE.test(e)) bad(at("events", i), "an event name is 1 to 40 lowercase letters, digits and underscores, starting with a letter"); });
    events.forEach((e, i) => { if (events.indexOf(e) !== i) bad(at("events", i), `event ${JSON.stringify(e)} is listed twice`); });
  }

  /** A declared pattern (or `fallback`), compiled. */
  const patternAt = (value, pointer, fallback) => {
    if (value === undefined) return compile(fallback);
    if (typeof value !== "string" || !value) { bad(pointer, "pattern must be a non-empty regular expression"); return null; }
    const re = compile(value);
    if (!re) bad(pointer, `pattern ${JSON.stringify(value)} is not a valid regular expression`);
    return re;
  };
  /** A named map (parameters, fields): at most `max` entries, each an object of `keys`. */
  const namedMap = (key, max, keys, each) => {
    const map = decl[key];
    if (map === undefined) return {};
    if (!isObject(map)) { bad(at(key), `${key} must be an object of named entries`); return null; }
    const names = Object.keys(map);
    if (names.length > max) bad(at(key), `at most ${max} ${key}`);
    const out = {};
    for (const n of names) {
      if (!NAME_RE.test(n)) bad(at(key, n), `${JSON.stringify(n)} is not a valid name (a letter, then letters, digits and underscores, at most 40)`);
      const entry = map[n];
      if (!isObject(entry)) { bad(at(key, n), `must be an object with only ${keys.join(", ")}`); continue; }
      for (const k of Object.keys(entry)) if (!keys.includes(k)) bad(at(key, n, k), `unknown key ${JSON.stringify(k)} (allowed: ${keys.join(", ")})`);
      out[n] = each(n, entry);
    }
    return out;
  };
  const parameters = namedMap("parameters", MAX_PARAMETERS, PARAMETER_KEYS, (n, p) => {
    if (p.required !== undefined && typeof p.required !== "boolean") bad(at("parameters", n, "required"), "required must be true or false");
    if (p.description !== undefined && !oneLine(p.description)) bad(at("parameters", n, "description"), `description must be one line of at most ${TEXT_MAX} characters`);
    const pattern = patternAt(p.pattern, at("parameters", n, "pattern"), DEFAULT_PARAM_PATTERN);
    if (p.default !== undefined) {
      if (typeof p.default !== "string" || chars(p.default) > TEXT_MAX) bad(at("parameters", n, "default"), `default must be a string of at most ${TEXT_MAX} characters`);
      else if (pattern && !pattern.test(p.default)) bad(at("parameters", n, "default"), `default ${JSON.stringify(p.default)} does not match the parameter's pattern`);
    }
    return { required: p.required === true, default: typeof p.default === "string" ? p.default : null, description: typeof p.description === "string" ? p.description : null, pattern };
  });
  const fields = namedMap("fields", MAX_FIELDS, FIELD_KEYS, (n, f) => ({ pattern: patternAt(f.pattern, at("fields", n, "pattern"), DEFAULT_FIELD_PATTERN) }));

  const hosts = decl.urlHosts === undefined ? [] : decl.urlHosts;
  if (!Array.isArray(hosts) || hosts.length > MAX_URL_HOSTS) bad(at("urlHosts"), `urlHosts must list at most ${MAX_URL_HOSTS} hostnames`);
  else hosts.forEach((h, i) => {
    if (typeof h !== "string" || h.length > 253 || !HOST_RE.test(h)) bad(at("urlHosts", i), "a URL host is an exact lowercase hostname (no scheme, port or wildcard)");
    else if (hosts.indexOf(h) !== i) bad(at("urlHosts", i), `host ${JSON.stringify(h)} is listed twice`);
  });

  if (problems.length) return null;
  const [script, ...args] = spec.trim().split(/\s+/);
  return { name, command: decl.command, script, args, description: decl.description ?? null, events: [...events], parameters, fields, urlHosts: [...hosts] };
}

/** A manifest's trigger sources, validated where they are used. Never throws, whatever `manifest` is.
 *  → { sources: { <name>: { name, command, script, args, description, events, parameters: { <p>: { required,
 *  default, description, pattern } }, fields: { <f>: { pattern } }, urlHosts } }, problems: [{ source, pointer,
 *  message }] } — `sources` holds only the well-formed sources; `source` is null for a top-level problem. */
export function triggerSourcesOf(manifest) {
  const out = { sources: {}, problems: [] };
  const decl = isObject(manifest) ? manifest.triggerSources : undefined;
  if (decl === undefined) return out;
  if (!isObject(decl)) { out.problems.push({ source: null, pointer: "/triggerSources", message: "triggerSources must be an object of named trigger sources" }); return out; }
  const names = Object.keys(decl);
  if (names.length > MAX_SOURCES) { out.problems.push({ source: null, pointer: "/triggerSources", message: `triggerSources declares ${names.length} sources; at most ${MAX_SOURCES}` }); return out; }
  for (const name of names) {
    const problems = [];
    const source = checkSource(manifest, name, decl[name], problems);
    if (source) out.sources[name] = source;
    else out.problems.push(...problems);
  }
  return out;
}

// ------------------------------------------------------------ the wire (docs/capabilities.md "Trigger sources")

/** At most this many events, and skipped items, in one answer (more is `too-many-events`). */
export const MAX_ANSWER_EVENTS = 500, MAX_ANSWER_SKIPPED = 100;
/** Caps on the source's own text (§7): a skipped item's `why`, a refusal's message and code. */
export const SOURCE_TEXT_MAX = Object.freeze({ why: 200, message: 500, code: 128, invalidEvent: 200 });
const KEY_RE = /^[\x21-\x7e]{1,512}$/;
const SUBJECT_RE = /^[A-Za-z0-9._/:@-]{1,200}$/;
const URL_MAX = 500;
const EVENT_KEYS = ["key", "subject", "event", "url", "fields"];
const SUCCESS_KEYS = ["schemaVersion", "phase", "capability", "source", "ok", "result"];
const REFUSAL_KEYS = ["schemaVersion", "phase", "capability", "source", "ok", "error"];

/** A wire failure: E_TRIGGER_POLL with its `cause` (and the source's own refusal, made safe). */
export function pollFailure(cause, message, source) {
  return Object.assign(new Error(message), { code: "E_TRIGGER_POLL", details: { cause, ...(source ? { source } : {}) } });
}

/** One event's rule broken, or null when it is valid for `source` (a validated source). */
function eventProblem(source, ev) {
  if (!isObject(ev)) return "shape";
  if (Object.keys(ev).some((k) => !EVENT_KEYS.includes(k))) return "unknown-key";
  if (typeof ev.key !== "string" || !KEY_RE.test(ev.key)) return "key";
  if (typeof ev.subject !== "string" || !SUBJECT_RE.test(ev.subject)) return "subject";
  if (typeof ev.event !== "string" || !source.events.includes(ev.event)) return "event";
  if (ev.url !== undefined) {
    if (typeof ev.url !== "string" || ev.url.length > URL_MAX) return "url";
    let u; try { u = new URL(ev.url); } catch { return "url"; }
    if (u.protocol !== "https:" || u.username || u.password || !source.urlHosts.includes(u.hostname.toLowerCase())) return "url";
  }
  if (ev.fields !== undefined) {
    if (!isObject(ev.fields)) return "fields";
    const names = Object.keys(ev.fields);
    if (names.length > MAX_FIELDS || names.some((n) => !Object.hasOwn(source.fields, n) || typeof ev.fields[n] !== "string" || !source.fields[n].pattern.test(ev.fields[n]))) return "fields";
  }
  return null;
}

/** Judge a source's answer (the document `runModuleCommand` decoded) against the request it was
 *  sent and the source's declaration; `selected` is the trigger's `on.events`.
 *  → { events, invalidEvents: [{ text, rule }], skipped: [{ subject, why }], filtered }:
 *  `events` are the valid events the trigger selects, first of each key; an invalid event is
 *  dropped alone; an event the source declares but the trigger does not select is counted in
 *  `filtered`. Throws E_TRIGGER_POLL: `result` (the envelope or its result is malformed),
 *  `too-many-events`, or `refused` (with the source's own code and message, made safe). */
export function judgeAnswer(doc, request, source, selected) {
  const safe = safeText;
  const malformed = (why) => pollFailure("result", `${request.capability}:${request.source} answered a malformed poll result: ${why}`);
  if (!isObject(doc)) throw malformed("not a JSON object");
  const keys = doc.ok === true ? SUCCESS_KEYS : doc.ok === false ? REFUSAL_KEYS : null;
  if (!keys) throw malformed("ok must be true or false");
  const extra = Object.keys(doc).filter((k) => !keys.includes(k)), missing = keys.filter((k) => !Object.hasOwn(doc, k));
  if (extra.length || missing.length) throw malformed(`the envelope's keys must be exactly ${keys.join(", ")}`);
  for (const k of ["schemaVersion", "phase", "capability", "source"]) if (doc[k] !== request[k]) throw malformed(`${k} must echo the request's ${JSON.stringify(request[k])}`);
  if (doc.ok === false) {
    const e = doc.error;
    if (!isObject(e) || typeof e.code !== "string" || !e.code || (e.message !== undefined && typeof e.message !== "string") || Object.keys(e).some((k) => k !== "code" && k !== "message")) throw malformed("error must be { code, message? }");
    const said = { code: safe(e.code, SOURCE_TEXT_MAX.code), ...(e.message !== undefined ? { message: safe(e.message, SOURCE_TEXT_MAX.message) } : {}) };
    throw pollFailure("refused", `${request.capability}:${request.source} refused the poll`, said);
  }
  const res = doc.result;
  if (!isObject(res) || !Array.isArray(res.events) || Object.keys(res).some((k) => k !== "events" && k !== "skipped") || (res.skipped !== undefined && !Array.isArray(res.skipped))) throw malformed("result must be { events: [...], skipped?: [...] }");
  const skippedIn = res.skipped ?? [];
  if (res.events.length > MAX_ANSWER_EVENTS || skippedIn.length > MAX_ANSWER_SKIPPED) throw pollFailure("too-many-events", `${request.capability}:${request.source} answered ${res.events.length} events and ${skippedIn.length} skipped (at most ${MAX_ANSWER_EVENTS} and ${MAX_ANSWER_SKIPPED})`);
  const skipped = skippedIn.map((s) => {
    if (!isObject(s) || typeof s.subject !== "string" || typeof s.why !== "string" || Object.keys(s).some((k) => k !== "subject" && k !== "why")) throw malformed("a skipped item must be { subject, why }");
    return { subject: safe(s.subject, SOURCE_TEXT_MAX.why), why: safe(s.why, SOURCE_TEXT_MAX.why) };
  });
  const events = [], invalidEvents = [], seen = new Set();
  let filtered = 0;
  const drop = (ev, rule) => invalidEvents.push({ text: safe(JSON.stringify(ev) ?? String(ev), SOURCE_TEXT_MAX.invalidEvent), rule });
  for (const ev of res.events) {
    const rule = eventProblem(source, ev);
    if (rule) { drop(ev, rule); continue; }
    if (seen.has(ev.key)) { drop(ev, "duplicate-key"); continue; }
    seen.add(ev.key);
    if (!selected.includes(ev.event)) { filtered++; continue; }
    events.push({ key: ev.key, subject: ev.subject, event: ev.event, ...(ev.url !== undefined ? { url: ev.url } : {}), fields: { ...(ev.fields ?? {}) } });
  }
  return { events, invalidEvents, skipped, filtered };
}

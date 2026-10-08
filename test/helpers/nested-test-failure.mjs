// The failure message for a nested `node --test` run, built from the child's
// spawnSync result. test/release-workflow.test.mjs runs the whole Desktop
// suite as a child; its results go to stdout, so a message built from stderr
// alone said `npm test failed:` with nothing after it (awebai/oats#644).
//
// The message names the failing tests first: a 200 s suite's last couple of
// kilobytes are its summary, not the failure. It understands both reporters
// the nested run can produce: TAP (Node 22's default when stdout is a pipe,
// which is CI) with its indented YAML block per `not ok`, and spec (Node 23+'s
// default) with its `✖ failing tests:` summary, or only its `✖` lines when the
// run died before printing that summary. Bounded tails of stdout and stderr
// follow for whatever the parse misses. Everything is capped, so a mass
// failure cannot flood the log.

export const MAX_FAILURES = 8;
export const MAX_MESSAGE = 8192;
const MAX_FAILURE_CHARS = 600;
const MAX_CONTEXT_CHARS = 400;
const MAX_STDERR_TAIL = 2000;

const ANSI = /\x1b\[[0-9;]*m/g;
const EMPTY = "(empty)\n";

export function describeNestedTestFailure(r, label = "nested node --test run") {
  const stdout = String(r?.stdout ?? "").replace(ANSI, "");
  const stderr = String(r?.stderr ?? "").replace(ANSI, "");
  const why = [`status ${r?.status ?? null}`];
  if (r?.signal) why.push(`signal ${r.signal}`);
  if (r?.error) why.push(r.error.message);
  const failures = parseTapFailures(stdout) ?? parseSpecFailures(stdout);
  const parts = [`${label} failed (${why.join(", ")})`];
  if (failures.length === 0) {
    parts.push("No failing test could be read from its output; see the tails below.");
  } else {
    parts.push(`${failures.length} failing test${failures.length === 1 ? "" : "s"}${failures.length > MAX_FAILURES ? `, the first ${MAX_FAILURES} shown` : ""}:`);
    for (const f of failures.slice(0, MAX_FAILURES)) parts.push(clip(formatFailure(f), MAX_FAILURE_CHARS));
    if (failures.length > MAX_FAILURES) parts.push(`… and ${failures.length - MAX_FAILURES} more failing tests not shown.`);
  }
  const head = parts.join("\n\n");
  const frame = (out, err) => `${head}\n\n--- stdout tail ---\n${out || EMPTY}--- stderr tail ---\n${err || EMPTY}`;
  const room = Math.max(0, MAX_MESSAGE - frame(EMPTY, EMPTY).length);
  const errTail = tail(stderr, Math.min(MAX_STDERR_TAIL, Math.floor(room / 2)));
  const outTail = tail(stdout, room - errTail.length);
  return frame(outTail, errTail);
}

function formatFailure({ name, location, error, context }) {
  const lines = [`✖ ${name}${location ? `  (${location})` : ""}`];
  if (error) lines.push(indent(error));
  if (context) lines.push("  output before it:", indent(context, "    "));
  return lines.join("\n");
}

// TAP: `not ok N - name` at the subtest's depth (4 spaces per level), then a
// YAML block two spaces deeper, between `---` and `...`. `# Subtest:` headers
// give the enclosing names. Returns null when the output is not TAP.
function parseTapFailures(out) {
  if (!/^TAP version \d+$/m.test(out)) return null;
  const lines = out.split("\n");
  const path = [];
  const failures = [];
  const cancelled = [];
  for (let i = 0; i < lines.length; i++) {
    const sub = lines[i].match(/^( *)# Subtest: (.*)$/);
    if (sub) {
      path.length = Math.min(path.length, Math.floor(sub[1].length / 4));
      path.push(tapUnescape(sub[2]));
      continue;
    }
    const m = lines[i].match(/^( *)not ok \d+ - (.*)$/);
    if (!m || /\s# TODO\b/i.test(m[2])) continue;
    const depth = Math.floor(m[1].length / 4);
    const yaml = readYaml(lines, i + 1, m[1].length + 2);
    // A parent that failed only because a subtest did repeats nothing new.
    if (yaml.failureType === "subtestsFailed") continue;
    const name = [...path.slice(0, depth), tapUnescape(m[2])].join(" › ");
    const f = { name, location: yaml.location, error: [yaml.error, ...userFrames(yaml.stack)].filter(Boolean).join("\n") };
    // A whole test file that exited nonzero says only 'test failed'; what it
    // printed before dying is the `# ` diagnostics just above its header.
    if (yaml.exitCode !== undefined) f.context = precedingDiagnostics(lines, i);
    // Tests cancelled because their parent failed come last: they are fallout.
    (yaml.failureType === "cancelledByParent" ? cancelled : failures).push(f);
  }
  return [...failures, ...cancelled];
}

// The flat keys of one YAML block whose lines start at `pad` spaces. A `|-`
// block scalar takes the deeper-indented lines after it.
function readYaml(lines, start, pad) {
  const prefix = " ".repeat(pad);
  if (lines[start] !== `${prefix}---`) return {};
  const fields = {};
  for (let i = start + 1; i < lines.length && lines[i] !== `${prefix}...`; i++) {
    const kv = lines[i].startsWith(prefix) && lines[i].slice(pad).match(/^([A-Za-z_]+):(?: (.*))?$/);
    if (!kv) continue;
    const [, key, value = ""] = kv;
    if (value === "|-" || value === "|") {
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].startsWith(`${prefix}  `) || lines[i + 1].trim() === "")) body.push(lines[++i].slice(pad + 2));
      fields[key] = body.join("\n").trimEnd();
    } else {
      fields[key] = yamlScalar(value);
    }
  }
  return fields;
}

function yamlScalar(v) {
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length > 1) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  return v;
}

function tapUnescape(s) {
  return s.replace(/\\([\\#])/g, "$1");
}

// Stack frames in the code under test: ones that name a file, and not one of
// node's own.
function userFrames(stack) {
  return String(stack ?? "").split("\n").filter((l) => /file:\/\/|\(\//.test(l) && !/\bnode:/.test(l)).slice(0, 3).map((l) => `at ${l.trim()}`);
}

// The last lines are the ones that say why (the error, then `Node.js vNN`),
// so the budget keeps those, and spends nothing on node's own frames.
function precedingDiagnostics(lines, i) {
  const out = [];
  let size = 0;
  for (let j = i - 1; j >= 0 && out.length < 15; j--) {
    if (/^# Subtest: /.test(lines[j])) continue;
    const d = lines[j].match(/^# ?(.*)$/);
    if (!d || size + d[1].length > MAX_CONTEXT_CHARS) break;
    if (/^\s*at .*\bnode:/.test(d[1])) continue;
    out.unshift(d[1]);
    size += d[1].length + 1;
  }
  return out.join("\n");
}

// spec: the `✖ failing tests:` summary lists each leaf failure as an optional
// `test at <location>` line, a `✖ name (duration)` line and its indented
// error. Without the summary, the tree's `✖` lines are all there is. A `✖`
// that closes a `▶` group at the same depth is a parent: listed when nothing
// inside it failed (its own body or hook did), skipped when a descendant
// already names the failure.
function parseSpecFailures(out) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => /^✖ failing tests:\s*$/.test(l));
  return start === -1 ? specTreeFailures(lines) : specSummaryFailures(lines.slice(start + 1));
}

function specSummaryFailures(lines) {
  const failures = [];
  let location = null;
  let current = null;
  for (const line of lines) {
    const at = line.match(/^test at (.+)$/);
    const x = line.match(/^✖ (.*?)(?: \([\d.]+m?s\))?$/);
    if (at) {
      location = at[1].trim();
    } else if (x) {
      current = { name: x[1], location, body: [] };
      failures.push(current);
      location = null;
    } else if (current) {
      current.body.push(line.replace(/^ {2}/, ""));
    }
  }
  return failures.map(({ name, location, body }) => {
    let frames = 0;
    const kept = body.filter((l) => !/^\s*at /.test(l) || (/file:\/\/|\(\//.test(l) && !/\bnode:/.test(l) && ++frames <= 3));
    return { name, location, error: kept.join("\n").trim() };
  });
}

function specTreeFailures(lines) {
  const open = [];
  const failures = [];
  for (const line of lines) {
    const g = line.match(/^( *)▶ (.*)$/);
    if (g) { open.push({ depth: g[1].length, name: g[2], failuresBefore: failures.length }); continue; }
    const x = line.match(/^( *)([✔✖]) (.*?)(?: \([\d.]+m?s\))?$/);
    if (!x) continue;
    const [, { length: depth }, mark, name] = x;
    while (open.length && open.at(-1).depth > depth) open.pop();
    const group = open.at(-1)?.depth === depth && open.at(-1).name === name ? open.pop() : null;
    if (mark === "✖" && (!group || failures.length === group.failuresBefore)) failures.push({ name, location: null, error: "" });
  }
  return failures;
}

function indent(text, pad = "  ") {
  return text.split("\n").map((l) => (l ? pad + l : l)).join("\n");
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// The end of `text` in at most `max` characters, newline-terminated, starting
// at a line boundary when it had to be cut.
function tail(text, max) {
  if (!text) return "";
  if (text.length < max) return text.endsWith("\n") ? text : `${text}\n`;
  if (max < 4) return "";
  const cut = text.slice(-(max - 3));
  const nl = cut.indexOf("\n");
  const body = nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
  return `…\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

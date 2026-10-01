/**
 * Markdown front matter: split a leading YAML block off a document and read it
 * as a flat key/value table when it is simple enough.
 *
 * Deliberately a strict subset, not YAML: the renderer takes no YAML
 * dependency, and the front matter we display (SKILL.md and friends) is flat
 * name/description metadata. Top level only: `key: value` with plain, quoted
 * or block (| |- > >-) scalars, block or flow lists of scalars, comments.
 * Anything else (nesting, anchors, tags, duplicate keys, tab indentation, an
 * unparsable line) yields entries: null and the caller shows `raw` as code.
 * Values stay text: no number/boolean coercion. Pure, and never throws.
 */

export const FRONT_MATTER_MAX = 64 * 1024;

const OPEN = /^﻿?---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?=[ ]|$)(.*)$/;

/** { frontMatter: null | { raw, entries }, body }; raw has \n line endings. */
export function splitFrontMatter(text) {
  const src = typeof text === "string" ? text : String(text ?? "");
  const none = { frontMatter: null, body: src };
  const open = OPEN.exec(src);
  if (!open) return none;
  const lines = [];
  let pos = open[0].length;
  while (pos <= src.length) {
    const nl = src.indexOf("\n", pos);
    const end = nl === -1 ? src.length : nl;
    const line = src.slice(pos, end).replace(/\r$/, "");
    if (CLOSE.test(line)) {
      const raw = lines.join("\n");
      return { frontMatter: { raw, entries: parseEntries(raw) }, body: nl === -1 ? "" : src.slice(nl + 1) };
    }
    if (nl === -1) break;
    lines.push(line);
    pos = nl + 1;
  }
  return none; // unclosed fence: not front matter
}

function parseEntries(raw) {
  if (raw.length > FRONT_MATTER_MAX) return null;
  try { return parseLines(raw.split("\n")); } catch { return null; }
}

const indentOf = (line) => /^ */.exec(line)[0].length;
const isBlank = (line) => /^ *$/.test(line);
const isComment = (line) => /^ *#/.test(line);

function parseLines(lines) {
  if (lines.some(l => /^ *\t/.test(l))) return null; // tab indentation
  const entries = [];
  const seen = new Set();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) { i++; continue; }
    const m = KEY.exec(line);
    if (!m || seen.has(m[1])) return null;
    seen.add(m[1]);
    // Following indented/blank lines belong to this key.
    let j = i + 1;
    while (j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) > 0 || (lines[j].startsWith("-") && /^-( |$)/.test(lines[j])))) j++;
    const value = parseValue(m[2].trim(), lines.slice(i + 1, j));
    if (value === null) return null;
    entries.push([m[1], value]);
    i = j;
  }
  return entries;
}

function parseValue(rest, more) {
  const content = more.filter(l => !isBlank(l));
  if (rest === "" || rest.startsWith("#")) {
    const items = content.filter(l => !isComment(l));
    if (!items.length) return "";
    return blockList(items);
  }
  const head = rest[0];
  if (head === "|" || head === ">") return blockScalar(rest, more);
  if (head === "'" || head === '"' || head === "[") {
    if (content.some(l => !isComment(l))) return null; // multi-line quoted/flow: out of subset
    if (head === "[") return flowList(rest);
    const q = quoted(rest, 0);
    return q && isTrailingComment(rest.slice(q.end)) ? q.value : null;
  }
  return plain(rest, more);
}

/** `- item` lines at one indentation (0 allowed: `key:\n- a`). */
function blockList(items) {
  const n = indentOf(items[0]);
  const out = [];
  for (const line of items) {
    if (indentOf(line) !== n) return null;
    const m = /^-(?: +(.*))?$/.exec(line.slice(n));
    if (!m) return null;
    const item = scalar((m[1] ?? "").trim());
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

/** A single-line scalar: quoted, or plain with an optional trailing comment. */
function scalar(text) {
  if (text === "" || text.startsWith("#")) return "";
  if (text[0] === "'" || text[0] === '"') {
    const q = quoted(text, 0);
    return q && isTrailingComment(text.slice(q.end)) ? q.value : null;
  }
  return plainText(text);
}

function plainText(text) {
  const hash = text.indexOf(" #"); // indexOf, not a regex: linear on long space runs
  const value = (hash === -1 ? text : text.slice(0, hash)).trim();
  if (/^[\[\]{},&*!|>'"%@`#]/.test(value) || /^[-?:]( |$)/.test(value)) return null;
  if (/: /.test(value) || value.endsWith(":")) return null; // would be a mapping
  return value;
}

/** Plain scalar, optionally continued on more-indented lines (folded). */
function plain(rest, more) {
  const first = plainText(rest);
  if (first === null) return null;
  if (/ #/.test(rest)) { // a comment ends the scalar: nothing may follow
    return more.some(l => !isBlank(l) && !isComment(l)) ? null : first;
  }
  let out = first;
  let breaks = 0;
  let ended = false; // a comment line ends the scalar too
  for (const line of more) {
    if (isBlank(line)) { breaks++; continue; }
    if (isComment(line)) { ended = true; continue; }
    if (ended) return null;
    const part = plainText(line.trim());
    if (part === null || part === "" || / #/.test(line)) return null;
    out += breaks ? "\n".repeat(breaks) : " ";
    out += part;
    breaks = 0;
  }
  return out;
}

const isTrailingComment = (rest) => /^(?: *| +#.*)$/.test(rest);

/** The quoted string opening at text[start] → { value, end } (end: index
 * after the closing quote), or null when malformed or unterminated. */
function quoted(text, start) {
  const q = text[start];
  let value = "";
  for (let k = start + 1; k < text.length; k++) {
    const c = text[k];
    if (q === "'") {
      if (c !== "'") { value += c; continue; }
      if (text[k + 1] === "'") { value += "'"; k++; continue; }
      return { value, end: k + 1 };
    }
    if (c === '"') return { value, end: k + 1 };
    if (c !== "\\") { value += c; continue; }
    const e = text[++k];
    if (e === '"' || e === "\\") value += e;
    else if (e === "n") value += "\n";
    else if (e === "t") value += "\t";
    else return null;
  }
  return null; // unterminated
}

const DELIM = /[,\]]/g;
/** `[a, 'b', "c"]` of scalars, single line, no nesting. */
function flowList(text) {
  const out = [];
  let k = 1;
  for (;;) {
    while (text[k] === " ") k++;
    if (text[k] === "]") break;
    let item;
    if (text[k] === "'" || text[k] === '"') {
      const q = quoted(text, k);
      if (!q) return null;
      item = q.value;
      k = q.end;
      while (text[k] === " ") k++;
    } else {
      DELIM.lastIndex = k;
      const d = DELIM.exec(text);
      if (!d) return null;
      const part = text.slice(k, d.index).trim();
      if (part === "" || /[\[{}]| #/.test(part)) return null;
      item = plainText(part);
      if (item === null) return null;
      k = d.index;
    }
    out.push(item);
    if (text[k] === ",") { k++; continue; }
    if (text[k] === "]") break;
    return null;
  }
  return isTrailingComment(text.slice(k + 1)) ? out : null;
}

/** `|` keeps newlines, `>` folds them; `-` strips the final newline. */
function blockScalar(rest, more) {
  const m = /^([|>])(-?)(?: +#.*)?$/.exec(rest);
  if (!m) return null;
  const [, style, strip] = m;
  const first = more.find(l => !isBlank(l));
  if (first === undefined) return "";
  const n = indentOf(first);
  if (n === 0) return null;
  const lines = [];
  for (const line of more) {
    if (isBlank(line)) { lines.push(""); continue; }
    if (indentOf(line) < n) return null;
    lines.push(line.slice(n));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  let text;
  if (style === "|") text = lines.join("\n");
  else {
    text = "";
    let prev = null; // previous content line
    let empties = 0;
    for (const line of lines) {
      if (line === "") { empties++; continue; }
      if (prev === null) text += "\n".repeat(empties);
      else if (prev.startsWith(" ") || line.startsWith(" ")) text += "\n".repeat(empties + 1);
      else text += empties ? "\n".repeat(empties) : " ";
      text += line;
      prev = line;
      empties = 0;
    }
  }
  return strip || text === "" ? text : text + "\n";
}

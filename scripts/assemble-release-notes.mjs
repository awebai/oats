#!/usr/bin/env node
// Release-notes entries: one file per pull request, moved into the version's
// notes file by this command.
//
// A pull request writes its entry under docs/release-notes/next/ and never
// touches docs/release-notes/v<next>.md, so two pull requests that share no
// code do not conflict there. The release-prep pull request runs this command,
// which moves every entry into docs/release-notes/<tag>.md and removes the
// entry files. docs/release-lane.md, "Release-notes entries", owns the rule.
//
// The module exports what its test, the validator and the release lane read
// (the sections, the checker, the listing, the assembly of a text) and runs as
// a command only when it is the entry script. Node builtins only.
//
// Assembly is a move of text: every line it did not add is kept byte for byte.
// The one exception is blank lines where text goes in (see assembleNotes).

import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The sections of a notes file, in the order they stand in it. A heading is
 * one of them when its line is `## <name>` from the first column, in this case
 * and spacing; spaces at the end of the line are ignored, so that an invisible
 * one does not make a second section. An indented `## ` line is text.
 */
export const SECTIONS = ["Upgrade", "Added", "Changed", "Fixed", "Removed", "Provider updates", "Documentation"];
export const ENTRY_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const TAG = /^v(\d+\.\d+\.\d+)$/;
const COMMAND = "node scripts/assemble-release-notes.mjs";

export const notesDir = (root) => join(root, "docs", "release-notes");
/** Where entries wait. The directory exists only while it holds one: anything in it is an unassembled entry. */
export const entriesDir = (root) => join(notesDir(root), "next");

const USAGE = `usage: ${COMMAND} --tag vX.Y.Z [--root <dir>]`;
const HELP = `${USAGE}

Moves every release-notes entry under docs/release-notes/next/ into
docs/release-notes/<tag>.md and removes the entry files. Run it in the
release-prep pull request and review the diff; entries may be reordered by
hand afterwards. docs/release-lane.md, "Release-notes entries", has the rule.

  --tag vX.Y.Z   the version whose notes file receives the entries (required)
  --root <dir>   the tree to work in (default: the checkout this script is in)
  --help         this text

Files are taken in file-name order, as plain strings (what \`LC_ALL=C ls\`
prints). Each body goes after what its section already holds; a section the
notes file lacks is created at its place in the order below. A notes file
that does not exist is created. All or nothing: with one problem in any entry
or in the notes file, every problem is printed and nothing is written or
removed.

sections, in order: ${SECTIONS.join(", ")}

exit status: 0 done or nothing to do, 2 refused.
`;

// ------------------------------------------------------------------- reading

const blank = (line) => line.trim() === "";
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A text as lines, without the empty piece a final newline leaves. */
function toLines(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
function trimEnd(lines) {
  let end = lines.length;
  while (end > 0 && blank(lines[end - 1])) end--;
  return lines.slice(0, end);
}
function trimBlank(lines) {
  const kept = trimEnd(lines);
  return kept.slice(kept.findIndex((line) => !blank(line)));
}

/**
 * Which lines are fenced code. A line whose first non-space characters are
 * three or more backticks or tildes opens a fence; the fence closes at a run
 * of the same character, at least as long, with nothing after it (Markdown's
 * rule, so a block that shows a shorter or a different fence stays one block).
 * A `## ` or `# ` line inside a fence is text.
 */
function scan(lines) {
  let fence = null;
  const rows = lines.map((line, index) => {
    const mark = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence.char && mark[1].length >= fence.length && blank(mark[2])) fence = null;
      return { line, fenced: true };
    }
    // An opening run of backticks takes no backtick after it: that is inline code.
    if (mark && !(mark[1][0] === "`" && mark[2].includes("`"))) {
      fence = { char: mark[1][0], length: mark[1].length, at: index + 1 };
      return { line, fenced: true };
    }
    return { line, fenced: false, heading: line.startsWith("## ") ? line.slice(3).trimEnd() : null, title: line.startsWith("# ") };
  });
  return { rows, openFence: fence ? fence.at : null };
}

/**
 * The problems of an entry file, empty when it is one. An entry is a piece of
 * the notes file: one or more `## <Section>` headings, each followed by its
 * entries, and nothing else. "An entry" is a non-blank line: an Upgrade
 * section holds paragraphs and numbered steps, so a bullet is not required.
 */
export function checkEntry(name, text) {
  const problems = [];
  if (!ENTRY_NAME.test(name)) problems.push(`the file name must match ${ENTRY_NAME} (the issue's number and a short slug, such as 991-update-every-pi-folder.md)`);
  const { rows, openFence } = scan(toLines(text));
  const seen = new Set();
  let current = null, strayAt = null;
  const close = () => { if (current && !current.filled) problems.push(`line ${current.at}: "## ${current.name}" has no entry under it`); };
  rows.forEach((row, index) => {
    const at = index + 1;
    if (!row.fenced && row.title) problems.push(`line ${at}: a "# " title belongs to the notes file, not to an entry`);
    else if (!row.fenced && row.heading !== null) {
      close();
      current = { name: row.heading, at, filled: false };
      if (!SECTIONS.includes(row.heading)) problems.push(`line ${at}: "## ${row.heading}" is not a section (one of, exactly: ${SECTIONS.join(", ")})`);
      else if (seen.has(row.heading)) problems.push(`line ${at}: "## ${row.heading}" appears twice`);
      seen.add(row.heading);
    } else if (!blank(row.line)) {
      if (current) current.filled = true;
      else strayAt ??= at;
    }
  });
  close();
  if (!current) problems.push('no "## <Section>" heading: an entry is one or more section headings, each followed by its entries');
  else if (strayAt) problems.push(`line ${strayAt}: text stands before the first "## " heading`);
  if (openFence) problems.push(`line ${openFence}: the fenced block is never closed`);
  return problems;
}

/** A notes file as its lines before the first `## ` heading and its sections; `name` is null for a hand-written heading. */
function parseNotes(lines) {
  const preamble = [];
  const sections = [];
  const { rows, openFence } = scan(lines);
  for (const row of rows) {
    if (!row.fenced && row.heading !== null) sections.push({ heading: row.line, name: SECTIONS.includes(row.heading) ? row.heading : null, lines: [] });
    else (sections.at(-1)?.lines ?? preamble).push(row.line);
  }
  return { preamble, sections, openFence };
}

/** The problems that stop an assembly into this notes file: a section could not be told from another. */
export function checkNotes(text) {
  const { sections, openFence } = parseNotes(toLines(text));
  const problems = [];
  for (const name of SECTIONS) {
    const count = sections.filter((section) => section.name === name).length;
    if (count > 1) problems.push(`"## ${name}" appears ${count} times: merge them into one section first`);
  }
  if (openFence) problems.push(`line ${openFence}: the fenced block is never closed`);
  return problems;
}

// ------------------------------------------------------------------ assembly

/**
 * The notes text with every entry in it. `notes` is the notes file's text, or
 * null when it does not exist; `entries` are checked entries ({ name, text }),
 * taken in file-name order whatever order they come in.
 *
 * For each section, in SECTIONS order, that an entry has: the bodies under
 * that heading, each without its leading and trailing blank lines and joined
 * by one blank line, go after everything the notes file already has in that
 * section. A section the notes file lacks is created before the next section
 * of SECTIONS the file has, else right after the previous one it has, else at
 * the end ("next" and "previous" in SECTIONS order, wherever they stand in
 * the file). A heading that is not one of SECTIONS is left where it is.
 *
 * Blank lines, the one thing not kept byte for byte: a section that receives
 * a body ends in that body, one blank line before it and one after it when
 * something follows; one blank line stands before a created heading; the text
 * ends in one newline.
 *
 * Returns { text, sections: [{ name, created, files }] }.
 */
export function assembleNotes(notes, entries, { version }) {
  const lines = notes === null ? [`# OATS ${version}`, "", "Unreleased"] : toLines(notes);
  const doc = parseNotes(lines);
  const ordered = [...entries].sort((a, b) => byCodeUnit(a.name, b.name))
    .map((entry) => ({ name: entry.name, sections: parseNotes(toLines(entry.text)).sections }));
  const report = [];
  for (const name of SECTIONS) {
    const bodies = ordered.flatMap((entry) => entry.sections.filter((section) => section.name === name).map((section) => ({ file: entry.name, lines: trimBlank(section.lines) })));
    if (!bodies.length) continue;
    let target = doc.sections.find((section) => section.name === name);
    const created = !target;
    if (created) {
      target = { heading: `## ${name}`, name, lines: [], created: true };
      const at = (candidates) => candidates.map((other) => doc.sections.findIndex((section) => section.name === other)).find((index) => index >= 0);
      const order = SECTIONS.indexOf(name);
      const next = at(SECTIONS.slice(order + 1));
      const previous = at(SECTIONS.slice(0, order).reverse());
      doc.sections.splice(next ?? (previous === undefined ? doc.sections.length : previous + 1), 0, target);
    }
    target.lines = [...trimEnd(target.lines), "", ...bodies.flatMap((body, index) => (index ? ["", ...body.lines] : body.lines))];
    target.received = true;
    report.push({ name, created, files: bodies.map((body) => body.file) });
  }
  const blocks = [{ lines: doc.preamble }, ...doc.sections.map((section) => ({ ...section, lines: [section.heading, ...section.lines] }))];
  const out = [];
  blocks.forEach((block, index) => {
    const following = blocks[index + 1];
    if (following && (block.received || following.created)) out.push(...trimEnd(block.lines), ...(block.lines.some((line) => !blank(line)) ? [""] : []));
    else out.push(...block.lines);
  });
  return { text: `${trimEnd(out).join("\n")}\n`, sections: report };
}

// ------------------------------------------------------------- the directory

/**
 * Everything directly under docs/release-notes/next/, in file-name order as
 * plain strings (code units: what `LC_ALL=C ls` prints, never a locale's or a
 * number's order). `regular` is false for a directory or a link. An absent
 * directory holds nothing.
 */
export function listEntryFiles(root) {
  const dir = entriesDir(root);
  if (!lstatSync(dir, { throwIfNoEntry: false })) return [];
  if (!lstatSync(dir).isDirectory()) throw new Error(`${relative(root, dir)} is not a directory`);
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => ({ name: entry.name, path: join(dir, entry.name), regular: entry.isFile() }))
    .sort((a, b) => byCodeUnit(a.name, b.name));
}

// --------------------------------------------------------------- the command

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    const [key, inline] = arg.startsWith("--") ? arg.slice(2).split(/=(.*)/s, 2) : [];
    if (key !== "tag" && key !== "root") throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    opts[key] = value;
  }
  return opts;
}

/** Run the command; returns its exit status (0 done or nothing to do, 2 refused). */
export function main(argv, { out = (line) => console.log(line), err = (line) => console.error(line) } = {}) {
  let opts;
  try { opts = parseArgs(argv); } catch (error) { err(`${error.message}\n${USAGE} (--help has the rest)`); return 2; }
  if (opts.help) { out(HELP); return 0; }
  const version = TAG.exec(opts.tag ?? "")?.[1];
  if (!version) { err(`--tag is required and must look like vX.Y.Z (got ${JSON.stringify(opts.tag ?? "")})\n${USAGE} (--help has the rest)`); return 2; }
  const root = resolve(opts.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const shown = (path) => relative(root, path).split("\\").join("/");
  if (!lstatSync(notesDir(root), { throwIfNoEntry: false })?.isDirectory()) { err(`${notesDir(root)} is not a directory: --root must be a checkout of the repository`); return 2; }

  // All or nothing: read and check everything before the first write.
  const notesPath = join(notesDir(root), `${opts.tag}.md`);
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : null;
  const problems = [];
  let found;
  try { found = listEntryFiles(root); } catch (error) { err(`refused: ${error.message}`); return 2; }
  const entries = [];
  for (const file of found) {
    if (!file.regular) { problems.push(`${shown(file.path)}: not a regular file (an entry is one Markdown file directly under ${shown(entriesDir(root))}/)`); continue; }
    const text = readFileSync(file.path, "utf8");
    const own = checkEntry(file.name, text);
    problems.push(...own.map((problem) => `${shown(file.path)}: ${problem}`));
    if (!own.length) entries.push({ name: file.name, path: file.path, text });
  }
  if (notes !== null) problems.push(...checkNotes(notes).map((problem) => `${shown(notesPath)}: ${problem}`));
  if (problems.length) {
    err(`refused: ${problems.length} problem${problems.length === 1 ? "" : "s"}; nothing was written or removed\n- ${problems.join("\n- ")}`);
    return 2;
  }
  if (!entries.length && notes !== null) { out(`nothing to do: no entry file under ${shown(entriesDir(root))}/, and ${shown(notesPath)} is left as it is`); return 0; }

  const result = assembleNotes(notes, entries, { version });
  const temporary = `${notesPath}.${process.pid}.tmp`;
  try { writeFileSync(temporary, result.text); renameSync(temporary, notesPath); }
  finally { rmSync(temporary, { force: true }); }
  out(`${shown(notesPath)}: ${notes === null ? "created" : "updated"}, ${entries.length} entry file${entries.length === 1 ? "" : "s"} moved in`);
  for (const section of result.sections) out(`  ## ${section.name}${section.created ? " (new section)" : ""}: ${section.files.join(", ")}`);
  for (const entry of entries) rmSync(entry.path);
  if (existsSync(entriesDir(root)) && !readdirSync(entriesDir(root)).length) rmdirSync(entriesDir(root));
  if (entries.length) out(`removed the entry file${entries.length === 1 ? "" : "s"}${existsSync(entriesDir(root)) ? "" : ` and ${shown(entriesDir(root))}/`}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

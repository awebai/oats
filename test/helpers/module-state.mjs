// Module-level mutable state of an ES module's source, for the deployment reads' tripwire
// (test/read-call-state.test.mjs). Token-level, not a full parser, and conservative: what it cannot prove
// read-only it reports. A binding is state when it is
//   - any declarator of a module-scope `let` or `var` (every one of `let a, b = 1`, destructured names too);
//   - a module-scope `const` bound to `new Map|Set|WeakMap|WeakSet(…)`, an object or an array literal, that
//     the module writes (a mutating method through any member chain, `?.` and spacing included; an
//     assignment, `++`/`--` or `delete` through one; `Object.assign(x, …)`), or that leaves the module's
//     sight: passed, returned, aliased or stored anywhere but in a read (`of x`, `...x`, `typeof x`). An
//     exported one is followed into the importers given (`importers`), by its local name there.
// Comments, strings, template literals and regular expression literals are skipped.

const PUNCTUATORS = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const MUTATORS = new Set(["set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??=", "++", "--"]);
const STATEMENT_WORDS = new Set(["export", "import", "function", "const", "let", "var", "class", "async", "if", "for", "while", "do", "try", "switch", "return", "throw"]);

/** The tokens of `src`: `{ v, kind: "id"|"num"|"str"|"tpl"|"re"|"p", depth, nl }` — `depth` the nesting
 *  ((, [, {) before the token, `nl` whether a line break precedes it. */
export function tokenize(src) {
  const out = [];
  let i = 0, depth = 0, nl = false;
  const resume = []; // the depths at which a `}` resumes a template literal
  const prev = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prev();
    if (!p) return true;
    if (p.kind === "id") return REGEX_AFTER_WORDS.has(p.v);
    if (p.kind === "p") return ![")", "]", "}"].includes(p.v);
    return false;
  };
  const push = (v, kind) => { out.push({ v, kind, depth, nl }); nl = false; };
  const template = () => { // from just after a "`" or a template's "}" to its end or its next "${"
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; resume.push(depth); depth++; return; }
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { nl = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("//", i)) { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; continue; }
    if (src.startsWith("/*", i)) { const j = src.indexOf("*/", i + 2); if (src.slice(i, j).includes("\n")) nl = true; i = j < 0 ? src.length : j + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      push(src.slice(i, j + 1), "str"); i = j + 1; continue;
    }
    if (c === "`") { push("`", "tpl"); i++; template(); continue; }
    if (c === "}" && resume.length && resume[resume.length - 1] === depth - 1) { resume.pop(); depth--; push("}`", "tpl"); i++; template(); continue; }
    if (c === "/" && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < src.length && (inClass || src[j] !== "/")) { if (src[j] === "\\") j++; else if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false; j++; }
      j++;
      while (/[a-z]/i.test(src[j] ?? "")) j++;
      push(src.slice(i, j), "re"); i = j; continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
    if (word) { push(word[0], "id"); i += word[0].length; continue; }
    const num = /^\d[\w.]*/.exec(src.slice(i, i + 50));
    if (num) { push(num[0], "num"); i += num[0].length; continue; }
    const p = PUNCTUATORS.find((x) => src.startsWith(x, i)) ?? c;
    if (p === "(" || p === "[" || p === "{") { push(p, "p"); depth++; }
    else if (p === ")" || p === "]" || p === "}") { depth--; push(p, "p"); }
    else push(p, "p");
    i += p.length;
  }
  return out;
}

/** The module-scope declarations of `toks`: `[{ keyword, names, init: [tokens] | null, exported }]` per
 *  declarator (`names`: one, or a destructuring pattern's). */
function declarations(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.depth !== 0 || t.kind !== "id" || !["let", "var", "const"].includes(t.v)) continue;
    const before = toks[k - 1];
    const exported = before?.v === "export";
    const start = exported ? toks[k - 2] : before;
    if (start && !(start.depth === 0 && (start.v === ";" || start.v === "}" || t.nl || (exported && before.nl)))) continue;
    let j = k + 1;
    for (;;) {
      // A binding: an identifier, or a pattern whose identifiers not followed by `:` are its names.
      const names = [];
      if (toks[j]?.v === "{" || toks[j]?.v === "[") {
        const d = toks[j].depth;
        j++;
        while (j < toks.length && !(toks[j].depth === d && (toks[j].v === "}" || toks[j].v === "]"))) {
          if (toks[j].kind === "id" && toks[j + 1]?.v !== ":" && toks[j - 1]?.v !== "=") names.push(toks[j].v);
          j++;
        }
        j++;
      } else if (toks[j]?.kind === "id") names.push(toks[j++].v);
      else throw new Error(`a ${t.v} declaration this scanner cannot read, near token ${j}`);
      let init = null;
      if (toks[j]?.v === "=") {
        const from = ++j;
        while (j < toks.length && !(toks[j].depth === 0 && (toks[j].v === "," || toks[j].v === ";" || (toks[j].nl && STATEMENT_WORDS.has(toks[j].v))))) j++;
        init = toks.slice(from, j);
      }
      out.push({ keyword: t.v, names, init, exported });
      if (toks[j]?.v === ",") { j++; continue; }
      break;
    }
    k = j - 1;
  }
  return out;
}

/** Whether the occurrence of a binding at `toks[k]` writes it or lets it out of sight (see the header). */
function stateUse(toks, k) {
  const before = toks[k - 1];
  if (before?.v === "delete" || before?.v === "++" || before?.v === "--") return true;
  // Its member chain.
  let j = k + 1, last = null;
  while (toks[j]?.v === "." || toks[j]?.v === "?." || toks[j]?.v === "[") {
    if (toks[j].v === "[") { const d = toks[j].depth; j++; while (j < toks.length && !(toks[j].v === "]" && toks[j].depth === d)) j++; j++; last = "[]"; }
    else { last = toks[j + 1]?.v; j += 2; }
  }
  if (last !== null) return ASSIGN.has(toks[j]?.v) || (toks[j]?.v === "(" && MUTATORS.has(last));
  // The bare binding is a read only here; anywhere else (passed, returned, aliased, assigned) it escapes.
  if (before?.v === "of" || before?.v === "..." || before?.v === "typeof") return false;
  return !destructured(toks, k);
}

/** Whether `toks[k]` is the whole initializer of a destructuring declaration (`const [a, b] = x;`): a read. */
function destructured(toks, k) {
  if (toks[k - 1]?.v !== "=" || ![";", ","].includes(toks[k + 1]?.v) || !["]", "}"].includes(toks[k - 2]?.v)) return false;
  const close = toks[k - 2], open = close.v === "]" ? "[" : "{";
  for (let j = k - 3; j >= 0; j--) if (toks[j].depth === close.depth && toks[j].v === open) return ["const", "let", "var"].includes(toks[j - 1]?.v);
  return false;
}

/** The word before the `{` of the brace list `toks[k]` is directly in (`import`, `export`, …), or null. */
function listOwner(toks, k) {
  for (let j = k - 1; j >= 0; j--) if (toks[j].depth < toks[k].depth) return toks[j].v === "{" ? toks[j - 1]?.v ?? null : null;
  return null;
}

/** The occurrences of the binding `name` in `toks`: not a property of something else, an object key, its
 *  own declaration, or an entry of an `import { … }` / `export { … }` list. */
function occurrences(toks, name) {
  const out = [];
  toks.forEach((t, k) => {
    if (t.kind !== "id" || t.v !== name) return;
    const before = toks[k - 1], after = toks[k + 1];
    if (before?.v === "." || before?.v === "?.") return;
    if (after?.v === ":" && (before?.v === "{" || before?.v === ",")) return;
    if (t.depth === 0 && ["const", "let", "var", ","].includes(before?.v)) return;
    if (t.depth > 0 && ["import", "export"].includes(listOwner(toks, k))) return;
    if (before?.v === "as" && toks[k - 2]?.v === "*") return; // `import * as name`
    out.push(k);
  });
  return out;
}

/** Whether an importer writes the export it imports as `local` (a namespace: `local.member`), or lets it out
 *  of sight. A namespace used bare (passed on whole) lets every export out. */
function importerWrites({ source, local, member }) {
  const toks = tokenize(source);
  if (member === undefined) return occurrences(toks, local).some((k) => stateUse(toks, k));
  return occurrences(toks, local).some((k) => (toks[k + 1]?.v === "." || toks[k + 1]?.v === "?.") ? toks[k + 2]?.v === member && stateUse(toks, k + 2) : true);
}

/** The module-level state of `src` (see the header): `[name]`. `importersOf(name)`: `[{ source, local,
 *  member? }]`, each module of the closure that imports the export `name` of this module, under `local` (or
 *  as `member` of the namespace `local`). */
export function moduleState(src, { importersOf = () => [] } = {}) {
  const toks = tokenize(src);
  const found = [];
  for (const d of declarations(toks)) {
    if (d.keyword !== "const") { found.push(...d.names); continue; }
    if (d.names.length !== 1 || !d.init?.length) continue;
    const [first, second] = d.init;
    const collection = first.v === "new" && ["Map", "Set", "WeakMap", "WeakSet"].includes(second?.v);
    if (!collection && first.v !== "{" && first.v !== "[") continue;
    const name = d.names[0];
    const written = (ts, local) => occurrences(ts, local).some((k) => stateUse(ts, k));
    // Only an export reaches an importer: `export const`, or an `export { … }` list naming it.
    const exported = d.exported || toks.some((t, k) => t.v === name && t.depth > 0 && listOwner(toks, k) === "export");
    if (written(toks, name) || (exported && importersOf(name).some((importer) => importerWrites(importer)))) found.push(name);
  }
  return found;
}

// The reader of JavaScript the reading tests share: a source as tokens, with comments left out, and every
// reading of a source where a `/` could be a regular expression or a division.

/** After one of these words comes an expression, not an operator: a `/` starts a regular expression and a `{` an object. */
const BEFORE_AN_EXPRESSION = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "default"]);
/** The statements whose `( … )` is a condition, after which a statement starts. */
const CONDITION = new Set(["if", "while", "for", "with"]);

/**
 * The code of a source as tokens `{ t, v, nl }`; `nl` says a line break stood before the token.
 *   id   a name or a keyword          str  a quoted string; `v` is its text as written
 *   num  a number                     tpl  a template; `plain` when it has no `${…}`, and then `v` is its text
 *   p    one punctuation character    re   a regular expression
 * The code inside a template's `${…}` is tokens like any other. Comments are not tokens.
 *
 * A `/` is a division after a value and starts a regular expression anywhere else. That is known from the token
 * before it (and, after a `)`, from what its `(` followed: `if (x) /re/` against `f(x) / 2`), except in three
 * places, where it is a guess: after a `}` (a block's, or an object's), after `x++`, and after `of`. A guess is
 * recorded, not hidden: the tokens carry `guesses`, one `{ regex, text }` per place where both were possible, and
 * `choices` makes the n-th one the other way. readingsOf gives every reading; who reads tokens reads them all.
 */
export function tokensOf(source, choices = []) {
  const out = [], substitutions = []; // the brace depth inside each open `${…}`
  out.guesses = [];
  const conditions = [], blocks = [];  // for each open `(`: is it a statement's condition; for each open `{`: is it a block
  let i = source.startsWith("#!") ? Math.max(source.indexOf("\n"), 0) : 0, nl = false;
  const push = (t, v, more) => { out.push({ t, v, nl, ...more }); nl = false; };
  /** From inside a template: to its closing backtick (false) or to the next `${` (true), which is left open. */
  const templateText = () => {
    let text = "";
    for (; i < source.length; i++) {
      if (source[i] === "\\") text += source.slice(i, ++i + 1);
      else if (source[i] === "`") { i++; return { text, open: false }; }
      else if (source[i] === "$" && source[i + 1] === "{") { i += 2; return { text, open: true }; }
      else text += source[i];
    }
    return { text, open: false };
  };
  const name = /[A-Za-z_$][\w$]*/y, number = /\d[\w.]*/y;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (c === "\n") { nl = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2), stop = end < 0 ? source.length : end + 2; if (source.slice(i, stop).includes("\n")) nl = true; i = stop; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      push("str", source.slice(i + 1, j)); i = j + 1; continue;
    }
    if (c === "`") {
      i++;
      const part = templateText();
      push("tpl", part.open ? null : part.text, { plain: !part.open });
      if (part.open) substitutions.push(0);
      continue;
    }
    if (substitutions.length && (c === "{" || c === "}")) {
      if (c === "{") substitutions[substitutions.length - 1]++;
      else if (substitutions.at(-1) > 0) substitutions[substitutions.length - 1]--;
      else { substitutions.pop(); i++; if (templateText().open) substitutions.push(0); continue; } // the `}` that closes a `${`: back in the template's text
    }
    const before = out.at(-1), earlier = out.at(-2), punctuation = (token, v) => token?.t === "p" && token.v === v;
    if (c === "/") {
      const property = punctuation(earlier, ".");
      // [is it a regular expression, is that known]
      const [regex, known] = !before ? [true, true]
        : before.t === "id" ? (property || !BEFORE_AN_EXPRESSION.has(before.v) ? [false, true] : [true, before.v !== "of"])
        : before.t !== "p" ? [false, true] // a number, a string, a template, a regular expression: a value
        : before.v === ")" ? [before.condition, true]
        : before.v === "]" ? [false, true]
        : before.v === "}" ? [before.block, false]
        : "+-".includes(before.v) && punctuation(earlier, before.v) ? [false, false]
        : [true, true];
      // A regular expression ends on its line; a `/` inside [ ] or after a backslash does not end it.
      let j = i + 1, inClass = false;
      for (; j < source.length && source[j] !== "\n"; j++) {
        if (source[j] === "\\") j++;
        else if (inClass) inClass = source[j] !== "]";
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "/") break;
      }
      // Without a second `/` on the line it is a division whatever stood before it.
      const closes = source[j] === "/", taken = closes && !known ? choices[out.guesses.length] ?? regex : regex;
      if (closes && !known) out.guesses.push({ regex: taken, text: source.slice(i, j + 1) });
      // The flags are every word character that follows, valid or not, as the language reads them.
      if (closes && taken) { j++; while (/[\w$]/.test(source[j] ?? "")) j++; push("re", source.slice(i, j)); i = j; continue; }
    }
    name.lastIndex = number.lastIndex = i;
    const word = name.exec(source) ?? number.exec(source);
    if (word) { push(/\d/.test(c) ? "num" : "id", word[0]); i += word[0].length; continue; }
    if (c === "(") conditions.push((before?.t === "id" && CONDITION.has(before.v) && !punctuation(earlier, ".")) || (before?.t === "id" && before.v === "await" && earlier?.t === "id" && earlier.v === "for"));
    // A `{` is an object where an expression is expected (after an operator or a word like `return`), and a block
    // anywhere else: after `)`, `=>`, `;`, another brace, a name (`else`, `try`, a class's).
    if (c === "{") blocks.push(!before || (before.t === "id" ? !BEFORE_AN_EXPRESSION.has(before.v) : before.t !== "p" || ");{}".includes(before.v) || (before.v === ">" && punctuation(earlier, "="))));
    push("p", c, c === ")" ? { condition: conditions.pop() === true } : c === "}" ? { block: blocks.pop() !== false } : undefined); i++;
  }
  return out;
}
/** Every reading of a source: its tokens with each guess taken each way (the first is the reader's own guesses). Null when
 * there are more readings than anyone would check, which is itself a reason not to judge the file. */
const read = new Map();
export function readingsOf(source) {
  if (!read.has(source)) read.set(source, everyReading(source));
  return read.get(source);
}
function everyReading(source) {
  const done = [], waiting = [[]];
  while (waiting.length) {
    const choices = waiting.pop(), T = tokensOf(source, choices);
    done.push(T);
    for (let n = choices.length; n < T.guesses.length; n++) waiting.push([...T.guesses.slice(0, n).map((guess) => guess.regex), !T.guesses[n].regex]);
    if (done.length + waiting.length > 64) return null;
  }
  return done;
}

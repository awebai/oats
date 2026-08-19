// Capture ignore list — a per-root privacy control.
//
// `<root>/ignore` is a plain text file of glob patterns, one per line
// (blank lines and `#` comments skipped). Any capture source file that
// matches is never captured at all: it is skipped before being opened, so
// no blob is stored, no turn is appended, and the seen cache never learns
// about it (removing the pattern later makes the next pass capture the
// file normally).
//
// Matching, deliberately simple (no negation, no escapes):
//   - a pattern containing `/` is matched against the source file's
//     absolute path;
//   - a pattern without `/` is matched against the file's basename and
//     against its session id (for session transcripts) or account name
//     (for aw comm logs);
//   - `*` matches within a path segment, `**` matches across segments,
//     `?` matches one non-separator character; the whole candidate must
//     match. Everything else is literal — there are no regex characters.
//
// Matching is NOT compiled to regexes: adjacent wildcards translated to
// overlapping quantifiers backtrack catastrophically on non-matching
// candidates (a "*?"-repeated pattern — one typo away from documented
// syntax — hangs a regex engine for seconds to forever, which would stall
// every capture pass at 100% CPU). Instead each pattern is tokenized once
// and matched by dynamic programming, cost bounded by
// O(pattern length x candidate length), with no backtracking of any kind.
//
// The file is local policy, not record truth: it lives beside streams/ and
// objects/ but the sync guidance replicates only those two, so each machine
// decides what its own capture process refuses to read. Ignoring is
// forward-looking only — turns already in the record stay there; use a
// tombstone to hide those.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export class IgnoreError extends Error {}

export function ignoreFilePath(root) {
  return join(root, "ignore");
}

export function parseIgnorePatterns(text) {
  const patterns = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    patterns.push(line);
  }
  return patterns;
}

// Tokenize a pattern into wildcard ops and literal characters. "**" is one
// token (any chars), "*" one segment's worth, "?" one non-separator char.
function tokenize(pattern) {
  const tokens = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        tokens.push("**");
        i++;
      } else {
        tokens.push("*");
      }
    } else if (c === "?") {
      tokens.push("?");
    } else {
      tokens.push({ c });
    }
  }
  return tokens;
}

// Whole-candidate glob match by dynamic programming over (tokens consumed,
// candidate chars consumed). Row i+1 holds, for each prefix length j of the
// candidate, whether tokens[0..i] can consume exactly that prefix. Linear
// passes only; worst case is |tokens| * |candidate| steps regardless of how
// pathological the pattern is.
export function globMatch(tokens, s) {
  const n = s.length;
  let prev = new Uint8Array(n + 1); // matches with i tokens consumed
  prev[0] = 1;
  for (const tok of tokens) {
    const cur = new Uint8Array(n + 1);
    if (tok === "**") {
      cur[0] = prev[0];
      for (let j = 1; j <= n; j++) cur[j] = prev[j] || cur[j - 1] ? 1 : 0;
    } else if (tok === "*") {
      cur[0] = prev[0];
      for (let j = 1; j <= n; j++) {
        cur[j] = prev[j] || (cur[j - 1] && s[j - 1] !== "/") ? 1 : 0;
      }
    } else if (tok === "?") {
      for (let j = 1; j <= n; j++) {
        cur[j] = prev[j - 1] && s[j - 1] !== "/" ? 1 : 0;
      }
    } else {
      for (let j = 1; j <= n; j++) {
        cur[j] = prev[j - 1] && s[j - 1] === tok.c ? 1 : 0;
      }
    }
    prev = cur;
  }
  return Boolean(prev[n]);
}

export class IgnoreMatcher {
  constructor(patterns = []) {
    this.patterns = patterns;
    this.pathRules = []; // patterns with "/": match the absolute path
    this.nameRules = []; // patterns without "/": match basename / session id
    for (const pattern of patterns) {
      (pattern.includes("/") ? this.pathRules : this.nameRules).push(tokenize(pattern));
    }
  }

  get size() {
    return this.patterns.length;
  }

  // path: absolute source file path. names: basename, session id / account.
  ignores(path, names = []) {
    if (this.patterns.length === 0) return false;
    for (const rule of this.pathRules) {
      if (globMatch(rule, path)) return true;
    }
    for (const rule of this.nameRules) {
      for (const name of names) {
        if (typeof name === "string" && globMatch(rule, name)) return true;
      }
    }
    return false;
  }
}

// Load `<root>/ignore`. A missing file is an empty matcher; a file that
// exists but cannot be read is an error — a privacy control must not fail
// open silently — raised as IgnoreError with an actionable message.
export function loadIgnore(root) {
  const path = ignoreFilePath(root);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return new IgnoreMatcher([]);
    throw new IgnoreError(
      `cannot read capture ignore file ${path} (${err.code ?? err.message}); ` +
        `capture refuses to run with an unreadable privacy control — ` +
        `make it a readable text file of patterns, or remove it`,
      { cause: err },
    );
  }
  return new IgnoreMatcher(parseIgnorePatterns(text));
}

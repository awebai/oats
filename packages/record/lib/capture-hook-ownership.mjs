// Shared setup/health recognition. This is evidence only, never permission to
// execute a shell command or widen setup ownership.
const SHELL_PLAIN = /^[A-Za-z0-9_./:@%+,-]+$/;

// The words of a command as /bin/sh reads them, for what setup writes: plain
// characters, single-quoted runs and \' for a quote, adjacent pieces joined
// into one word, words apart by spaces or tabs. null when the command holds
// anything else outside quotes (an expansion, an operator, a redirection, a
// double quote, a newline, which ends a command) or a quote left open: the
// shell would do more with it than run those words, so it is not read.
//
// Any character above U+007F is part of a word too, as an earlier setup
// wrote it bare in a path (shellWord now quotes it). bash, dash and zsh end
// a word only at a space, a tab, a newline or an operator, all ASCII, so a
// command of such words carries nothing a rewrite would lose. POSIX lets a
// shell end a word at any blank of its locale (U+3000, say): such a shell
// would see one more argument of the same command, which a rewrite does not
// lose either, so no character above U+007F is refused.
export function shellWords(command) {
  const words = [];
  let word = null;
  for (let i = 0; i < command.length; ) {
    const c = command[i];
    if (c === " " || c === "\t") {
      if (word !== null) words.push(word);
      word = null;
      i++;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? "") + command.slice(i + 1, end);
      i = end + 1;
    } else if (c === "\\" && command[i + 1] === "'") {
      word = (word ?? "") + "'";
      i += 2;
    } else if (SHELL_PLAIN.test(c) || c > "\x7F") {
      word = (word ?? "") + c;
      i++;
    } else return null;
  }
  if (word !== null) words.push(word);
  return words;
}

export function isCaptureHook(hook) {
  if (hook?.type !== "command") return false;
  const tokens = shellWords(String(hook.command));
  return tokens !== null && tokens.length >= 2 && tokens[1].endsWith("/capture.mjs") &&
    tokens.includes("--owner") && tokens.includes("--quiet");
}

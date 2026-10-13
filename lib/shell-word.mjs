/**
 * A word of a command line the kernel prints for a person or an agent to paste into a shell. PURE: no
 * I/O and no import, so a module lib/core.mjs imports (lib/launch-preference.mjs) can use the same rule
 * as core, which re-exports both names.
 */

/** `s` single-quoted for a POSIX shell. */
export function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
/** One word of a command line that a person or an agent pastes into a shell: as it is when it holds
 *  only letters, digits and `_./:-`, single-quoted otherwise (an empty string too). The safe set is
 *  deliberately small: no `~` (an unquoted leading one expands), no `=` (zsh expands a leading
 *  `=word`). */
export function shellWord(s) { const word = String(s); return /^[A-Za-z0-9_.\/:-]+$/.test(word) ? word : shq(word); }

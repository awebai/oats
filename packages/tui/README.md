# OATS TUI (preview)

`oats tui` is the OATS terminal client: one full-screen, keyboard-only program
for people who work in terminals and on machines with no display. It ships
inside `@awebai/oats` and is never published on its own.

**It is a preview.** This version draws the frame, answers `?` (help) and `q`
(quit), and reads nothing from the kernel yet; the views arrive in later
releases. While it is a preview its screens may change without notice.

[`docs/tui.md`](../../docs/tui.md) is the reference: how to start it, the keys,
the complete list of what it changes in the terminal and restores, and what it
never does.

## For developers

| path | contents |
|---|---|
| `bin/tui.mjs` | the entry `bin/oats.mjs` loads: it imports the whole module graph, then runs `main()` |
| `lib/main.mjs` | the loop: state, a pure `reduce(state, event)`, render, write |
| `lib/actions.mjs` | the action table: the reducer and the help both read it |
| `lib/client.mjs` | the one module that imports the shared readers (`packages/client/`) |
| `lib/term/keys.mjs` | bytes to key events: a pure parser with an injected clock |
| `lib/term/width.mjs` | the cells a grapheme takes |
| `lib/term/text.mjs` | safe text, the only thing the screen draws: `lit()` and `shown()` |
| `lib/term/style.mjs` | style values: the sixteen ANSI colours and four attributes |
| `lib/term/screen.mjs` | the cell buffer and the bytes of a frame |
| `lib/term/tty.mjs` | the guard: enter, leave, signals, suspend, resize, one write per frame |
| `lib/views/` | pure functions from state and size to rows of safe text |

Rules the tests pin (`test/tui-boundary.test.mjs` reads the files):

- No dependency, and no import outside `node:` modules, this package and the
  one path in `lib/client.mjs`. No dynamic `import()`.
- Nothing in `lib/` or `bin/` of the kernel imports this package, except the
  one dynamic import where `bin/oats.mjs` dispatches the word.
- Only `term/screen.mjs` and `term/tty.mjs` produce an ESC byte. Views are
  pure: no IO, no clock, no escape bytes.
- The screen takes safe text only. Text the TUI did not write goes through
  `shown()`; `lit()` is for the TUI's own words and refuses anything the
  display filter would change, a run of spaces included, so a row is spans
  placed by column, never one padded string.

Tests: `node --test packages/tui/test/*.test.mjs` (no dependency needed), the
root tests `test/tui-*.test.mjs`, and the end-to-end tests in a real tmux on a
private socket (`test/tui-terminal.test.mjs`).

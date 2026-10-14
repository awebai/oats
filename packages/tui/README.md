# OATS TUI (preview)

`oats tui` is the OATS terminal client: one full-screen, keyboard-only program
for people who work in terminals and on machines with no display. It ships
inside `@awebai/oats` and is never published on its own.

**It is a preview.** This version shows a workspace's instances, on this
machine and on the other machines registered on it, in one list, follows
them, and opens an agent's terminal; it changes nothing in a deployment. While it is a preview its screens and its
configuration file may change without notice.

[`docs/tui.md`](../../docs/tui.md) is the reference: how to start it, what the
view shows, the keys and how to change them, what it reads and runs, the
complete list of what it changes in the terminal and restores, and what it
never does.

## For developers

| path | contents |
|---|---|
| `bin/tui.mjs` | the entry `bin/oats.mjs` loads: it imports the whole module graph, then runs `main()` |
| `lib/main.mjs` | the start (arguments, environment, terminal, `tui.json`, deployment, kernel) and the loop: events through `reduce`, effects out, the frame drawn |
| `lib/actions.mjs` | the action table and its default keys: the reducer, the footer and the help read the effective one |
| `lib/config.mjs` | `tui.json`: read once, checked, and the effective action table |
| `lib/client.mjs` | the one module that imports the shared readers (`packages/client/`), and the client's terms |
| `lib/open.mjs` | the viewer of an opened agent: `oats session attach` run by the same kernel on the user's terminal, and the end of its standard error kept |
| `lib/read.mjs` | the effects of reading: the deployment, the kernel record, the observer of every deployment opened in the run, the roster of other machines (`oats server roster --json`), the refresh loop, the liveness collector, ending every child, and the two looks at the file system the switcher needs (the entries of `~/Agents`, and whether a picked folder is a deployment) |
| `lib/store.mjs` | the state and `reduce(state, event)`: pure |
| `lib/model.mjs` | from the state to the rows and the detail to draw, and to the switcher's rows, by calling the shared readers: pure, no cell position |
| `lib/term/keys.mjs` | bytes to key events: a pure parser with an injected clock |
| `lib/term/width.mjs` | the cells a grapheme takes |
| `lib/term/text.mjs` | safe text, the only thing the screen draws: `lit()` and `shown()` |
| `lib/term/style.mjs` | style values: the sixteen ANSI colours and four attributes |
| `lib/term/screen.mjs` | the cell buffer and the bytes of a frame |
| `lib/term/tty.mjs` | the guard: enter, leave, signals, suspend, resize, the lend of the terminal to a viewer, one write per frame |
| `lib/views/` | pure functions from the model and a size to rows of spans: the frame, the list, the detail, the switcher, the help |

Rules the tests pin (`test/tui-boundary.test.mjs` reads the files):

- No dependency, and no import outside `node:` modules, this package and the
  one path in `lib/client.mjs`. No dynamic `import()`.
- Nothing in `lib/` or `bin/` of the kernel imports this package, except the
  one dynamic import where `bin/oats.mjs` dispatches the word.
- Only `term/screen.mjs` and `term/tty.mjs` produce an ESC byte. Views are
  pure: no IO, no clock, no escape bytes.
- No function of this package decodes a kernel answer, groups or orders
  instances, or decides what a failed read means: `lib/model.mjs` and
  `lib/read.mjs` call the shared readers and pass their answers on. A string
  the shared readers give reaches the screen through `shown()`.
- The store holds no size and no cell: a key event carries the height of the
  panes as the last frame drew them.
- Every read runs in a session of its own and is ended on every way out.
  The one child that is not a read is the viewer (`lib/open.mjs`): it shares
  the user's terminal, the guard lends it the terminal, and it is ended first
  on every way out while it has it.
- The screen takes safe text only. Text the TUI did not write goes through
  `shown()`; `lit()` is for the TUI's own words and refuses anything the
  display filter would change, a run of spaces included, so a row is spans
  placed by column, never one padded string.

Tests: `node --test packages/tui/test/*.test.mjs`, the root tests
`test/tui-*.test.mjs`, and the end-to-end tests in a real tmux on a private
socket (`test/tui-terminal.test.mjs`). All of them need the root's install
(`npm ci` at the repository root). The package has no dependency of its own,
but one of its tests runs the real kernel, which has: "KERNEL_BIN is this
install's own bin/oats.mjs, and its `version --json` is a record the probe
accepts" (`packages/tui/test/read.test.mjs`).

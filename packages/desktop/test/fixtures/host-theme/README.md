# Host theme fixtures

Omarchy `colors.toml` files for the "This computer" theme tests
(`test/host-theme-main.test.mjs`, `test/host-theme.test.mjs`), and one script.
The `.toml` files hold colour values only.

| File | What it is |
|---|---|
| `tokyo-night.toml` | Omarchy 4.0.4's stock Tokyo Night, verbatim: a dark theme. |
| `rose-pine.toml` | Omarchy 4.0.4's stock Rosé Pine, verbatim: a light theme whose accent is under 4.5:1 on its background, so the derivation has to move it. |
| `hackerman.toml` | Omarchy 4.0.4's stock Hackerman, verbatim: upper-case hex values and a key that is not a colour (`hyprland_active_border`). |
| `legacy.toml` | Hand-made, in the shape Omarchy 4.0.4's `omarchy-theme-colors-from-alacritty` writes for a theme that predates `colors.toml`: `accent`, `selection` (equal to the foreground), `background`, `foreground` and `color0`…`color15`, with no `mode`. |
| `impossible.toml` | Hand-made: resolves in the main process, but no text colour can pass on its surfaces. |
| `missing-colour.toml` | Hand-made: one of the six normal colours is missing. |
| `malformed-colour.toml` | Hand-made: the foreground is not a `#rrggbb` value. |
| `read-real-fs.mjs` | Not a palette: a script that runs the shipped reader with the real `node:fs` on a directory it is given (a regular file, a symlink, a file replaced by a FIFO just before the open, a FIFO, a directory, a dangling symlink) and prints one JSON line per step. `test/host-theme-main.test.mjs` runs it as a child with a deadline, on a temporary directory. |

# Bundled fonts

## Inconsolata (the default monospace face)

`Inconsolata-VF.ttf` is the Inconsolata variable font (axes `wght` 200–900 and
`wdth` 50–200), version 3.001, copied unchanged from Google Fonts. It is
licensed under the SIL Open Font License 1.1 ([`OFL.txt`](OFL.txt), copied beside it).

- Source: `https://github.com/google/fonts/raw/main/ofl/inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf`
  (upstream file name `Inconsolata[wdth,wght].ttf`, google/fonts commit
  `0f203e3740b5eb77e0b179dff1e5869482676782`, built from googlefonts/Inconsolata
  `fc1fc21081558b39a2db43bfd9b65bf9acb50701`)
- SHA-256: `23ded25b447074d00659392bf9b1123d89df55cb07b0ad9bfef3366d199b5fcb`
- Copyright 2006 The Inconsolata Project Authors (https://github.com/cyrealtype/Inconsolata)

`theme.css` declares it with `@font-face` (`font-display: block`), and the
`--term-font-family` (the terminal) and `--mono` (UI code and paths) tokens start
with it, ahead of the operating system's monospace stack. Until the face has
loaded, `theme.mjs` hands terminals the rest of the stack, so a terminal opened
that early measures the fallback; once it loads, the family changes and xterm
re-measures, so no terminal keeps fallback cell metrics. The file
ships through electron-builder's `renderer/**/*`, and the CSP's `default-src
'self'` covers it.

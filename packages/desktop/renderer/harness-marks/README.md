# Harness marks

The harness badge (`createRuntimeBadge` in [`../identity-marks.mjs`](../identity-marks.mjs))
draws one mark per known harness as inline SVG. `identity-marks.mjs` builds each one from
static constants with `createElementNS`. No file in this directory is fetched at runtime,
and nothing from data reaches the geometry, styles or URLs. Every mark paints with
`currentColor`, so the theme's `--runtime-<key>-fg` token (and the roster's idle-row
override) picks its colour. Its tile is `--runtime-<key>-bg`. An unknown or unreported
harness shows a "?" text instead.

## Pi: the official pi.dev badge

- Source: the "Badge SVG — Square mark for favicons and compact badges" from the Pi press
  kit, https://pi.dev/press-kit, served as https://pi.dev/favicon.svg
  (read 2026-10-07; SHA-256 `d266b2c1d2c7bf169ca30d438963b176fba16fea6263b9ac30c8302f34ad7ce7`).
- Its three paths and its `0 0 560 560` viewBox ship unmodified. The file's embedded
  `<style>` is not shipped: it picks `#111111` or `#f6f6f6` by `prefers-color-scheme`.
  The app theme picks between those same two colours instead (`#111111` in White and
  Solarized, `#f6f6f6` in Dark), on a quiet tile.
- Licence: MIT, "Copyright (c) 2026 Earendil Inc. and contributors". That is the pi.dev
  website's licence (the site's footer, and https://github.com/earendil-works/pi-website).
  The full text is [`PI-LICENSE.txt`](PI-LICENSE.txt). Pi publishes no trademark or
  logo-usage terms.

## Claude Code: Anthropic's Claude spark

- Source: the Claude mark as published by Simple Icons (slug `claude`, version 16.34.0,
  https://unpkg.com/simple-icons@16.34.0/icons/claude.svg, whose own source is
  https://claude.ai; read 2026-10-07; SHA-256
  `2d6fda79eb18ddccca35b799eeb3cece0dfabc22520ce3b10abd25668df9fa93`). Its single path and
  its `0 0 24 24` viewBox ship unmodified.
- It is painted in the theme's `--runtime-claude-fg` (ivory) on the terracotta
  `--runtime-claude-bg` tile, not in Anthropic's `#D97757`, so it holds 4.5:1 in every theme.
- Terms: the mark is Anthropic's trademark. Anthropic's trademark guidelines
  (https://www.anthropic.com/legal/trademark-guidelines) require prior approval to use its
  marks and forbid recolouring. The workspace owner chose on 2026-10-07 to ship it without
  that approval and to accept the risk. If Anthropic asks, replace it with a text monogram.
  OATS is not affiliated with or endorsed by Anthropic.

## Codex: OATS's own drawing

The Codex mark (a `>_` prompt, round-capped strokes on an inverse monochrome tile) is
OATS's own original drawing, hand-authored in a `0 0 24 24` viewBox. It is **not** the
official OpenAI logo. It is not traced, copied or derived from that logo, and it uses
none of its colours. OATS is not affiliated with or endorsed by OpenAI. "Codex" names the
harness the instance reports, and nothing more.

OpenAI's terms forbid designing a similar logo, so this drawing must stay clearly distinct
from the official mark: nothing knot-like, hexagonal or interlaced. A change to it keeps it
that way.

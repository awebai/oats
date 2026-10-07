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

## Claude Code and Codex: OATS's own drawings

The Claude Code mark (an ivory four-pointed concave sparkle on a terracotta tile) and the
Codex mark (a `>_` prompt, round-capped strokes on an inverse monochrome tile) are OATS's
own original drawings, hand-authored in a `0 0 24 24` viewBox. They are **not** the
official Anthropic or OpenAI logos. They are not traced, copied or derived from those
logos, and they use none of their colours. OATS is not affiliated with or endorsed by
Anthropic or OpenAI. "Claude Code" and "Codex" name the harness the instance reports, and
nothing more.

Anthropic's terms require prior approval to use its marks, and OpenAI's forbid designing a
similar logo, so these drawings must stay clearly distinct from the official marks: no
many-rayed or irregular asterisk, and nothing knot-like, hexagonal or interlaced. A change
to either mark keeps it that way.

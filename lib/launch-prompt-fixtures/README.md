# Development-channel confirmation tolerance list

`dev-channel-confirmation.json` is the list of Claude development-channel
confirmation wordings the launcher may confirm. `launch-prompt-fixtures.mjs`
loads and validates it; the controller (`launch-prompts.mjs`) sends its one
Enter only while the normalized screen EQUALS one entry's `text`.

## Normalization, and only this

1. Split the captured screen into rows.
2. Drop rows made only of box-drawing characters (U+2500–U+257F) and whitespace.
3. Join the rest with single spaces, collapsing every whitespace run.
4. Trim.

This absorbs wrapping at any pane width, indentation and padding. Nothing else
is normalized: no case folding, no character removal, no pattern. Equality is
not a contains test, so anything else on the screen, a second prompt stacked
with it, another or a second channel, or the options in another order, is no
match. A pane too narrow for Claude to wrap at word boundaries (about 40
columns for this prompt) breaks words and is no match either.

## Entries

Each entry has `id`, `text` (the normalized confirmation), `selected` (the
option line that carries `❯`) and `provenance` (one row per capture:
`claudeVersion`, `platform`, `capturedAt`, `source`). Loading refuses an entry
whose `❯` does not occur exactly once immediately before `1. `, whose
`selected` is not that line, or whose text does not name exactly one channel,
`plugin:aweb-channel@awebai-marketplace`. A hand edit that moves the selection
fails the tests.

One entry today, `aweb-dev-channel-confirmation-1`: Claude 2.1.289 and 2.1.296
on darwin-arm64 and 2.1.296 on linux-arm64 render the same text. The raw
captures and their provenance are in `test/fixtures/launch-prompts/`
(`dev-channel-provenance.json`).

## Adding a wording

A new Claude wording is a new entry, in a reviewed change, with the raw
capture (unedited `tmux capture-pane -p`, before any key) and its provenance
committed under `test/fixtures/launch-prompts/` and a test that it matches.
Capture it the way the existing ones were: a private tmux socket, a throwaway
`CLAUDE_CONFIG_DIR` seeded only with completed onboarding, a dummy-key
approval, the offline channel gate (`cachedGrowthBookFeatures.tengu_harbor`)
and trust for an empty throwaway directory; a dummy key, no network after the
install, no key sent. The version string is the only kind of variation entries
may carry, and only where a captured wording contains one. Never widen an entry
into a pattern.

Folder-trust prompts are never confirmed. The captured trust screens in
`test/fixtures/launch-prompts/` are negative test evidence.

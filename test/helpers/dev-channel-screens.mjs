// Real development-channel confirmation captures for launch-prompt tests; their
// provenance is test/fixtures/launch-prompts/dev-channel-provenance.json.
import { readFileSync } from "node:fs";

const fixture = name => readFileSync(new URL(`../fixtures/launch-prompts/${name}`, import.meta.url), "utf8");
export const raw296 = fixture("claude-2.1.296-darwin-arm64-194.txt");
export const raw289 = fixture("claude-2.1.289-darwin-arm64-110.txt");
/** Claude 2.1.296 on linux-arm64 at each captured geometry, keyed `<width>x<height>`. */
export const linux296 = Object.fromEntries(["194x50", "110x35", "80x35", "60x35", "40x35"]
  .map(g => [g, fixture(`claude-2.1.296-linux-arm64-${g}.txt`)]));

/** Real Claude 2.1.289 folder-trust prompts: negative evidence, never answered. */
export const trustPrompts = Object.fromEntries(["frame-01.txt", "frame-02-trust-selected.txt", "seq-02-trust-resized-110x35.txt", "seq-03-trust-confirm-selected.txt"]
  .map(name => [name, fixture(name)]));
/** Real Claude 2.1.289 session screens after the confirmation was answered. */
export const sessions = { "seq-06-session-after-channel.txt": fixture("seq-06-session-after-channel.txt"),
  "claude-max-started-home-sanitized.txt": fixture("claude-max-started-home-sanitized.txt") };

/** Replace exactly one occurrence of `from` in `screen`; throws when absent so a
 *  near-miss test cannot silently test the unchanged prompt. */
export function edit(screen, from, to) {
  const at = screen.indexOf(from);
  if (at < 0 || screen.indexOf(from, at + 1) >= 0) throw new Error(`edit: ${JSON.stringify(from)} must occur exactly once`);
  return screen.slice(0, at) + to + screen.slice(at + from.length);
}

/** Real Claude 2.1.296 screens where Claude ignored the development-channel flag
 *  and started with no confirmation: the notice visible, and behind another notice. */
export const flagIgnored = fixture("claude-2.1.296-darwin-arm64-flag-ignored-80x24.txt");
export const flagIgnoredHidden = fixture("claude-2.1.296-darwin-arm64-flag-ignored-hidden-80x24.txt");
/** A real Claude 2.1.296 running session caught with its logo mid-animation, the notice hidden. */
export const logoAnimating = fixture("claude-2.1.296-darwin-arm64-logo-animating-80x24.txt");

// The house fuzzy matcher, one copy for every client (the Desktop's palette and Quick Open, the TUI's
// palette and switcher): simple subsequence scoring — lower is better, null means no match, a prefix
// match gets a strong (negative) bonus. (No-match is null, NOT -1: the prefix bonus makes real scores
// negative, and the palette's legacy `sc < 0` no-match filter silently dropped exact prefix matches.)
export function subsequenceScore(text, query) {
  const t = String(text).toLowerCase();
  const s = String(query).toLowerCase();
  let ti = 0, gaps = 0;
  for (const ch of s) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    gaps += found - ti; ti = found + 1;
  }
  return gaps + (t.startsWith(s) ? -100 : 0);
}

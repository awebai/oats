/** A reported timestamp as a relative age ("3 h ago"); anything unparseable as sent.
 * Callers keep the exact reported value in the element's title. */
export function ageText(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

import { colorForIdentity, soulColor } from './soul-colors.mjs';

// Theme branches own all colors, including AA foreground/background pairs.
// No data is ever interpolated into styles, SVG, HTML, or resource URLs.
export const identityCSS = `
.identity-mark { display:inline-grid; place-items:center; flex:none; width:36px; height:36px; border-radius:9px; font-size:15px; font-weight:650; }
.runtime-badge { display:inline-grid; place-items:center; flex:none; width:18px; height:18px; border-radius:5px; font-size:9.5px; font-weight:700; }
.runtime-badge > .runtime-mark { display:block; width:100%; height:100%; overflow:visible; }
.runtime-badge[data-runtime="pi"] > .runtime-mark { width:66%; height:66%; }
`;

// The harness marks: static geometry only, painted with currentColor so the
// theme's --runtime-<key>-fg (and the roster's idle override) colours them.
// Pi's is the official pi.dev press-kit badge, unmodified (MIT); Claude's and
// Codex's are OATS's own original drawings, not those products' logos. Sources
// and licence: harness-marks/README.md.
const SVG_NS = 'http://www.w3.org/2000/svg';
const runtimeMarks = new Map([
  // A four-pointed concave sparkle, centred on the tile.
  ['claude', { name: 'Claude', viewBox: '0 0 24 24', paint: 'fill',
    paths: ['M12 4Q13 11 20 12Q13 13 12 20Q11 13 4 12Q11 11 12 4Z'] }],
  // pi.dev "Badge SVG" (https://pi.dev/favicon.svg), its three paths verbatim.
  ['pi', { name: 'Pi', viewBox: '0 0 560 560', paint: 'fill',
    paths: ['M420 280H280V140H0V0H420V280Z', 'M560 560H420V280H560V560Z', 'M140 560H0V140H140V280H280V420H140V560Z'] }],
  // A prompt: a chevron and an underscore, round-capped strokes.
  ['codex', { name: 'Codex', viewBox: '0 0 24 24', paint: 'stroke',
    paths: ['M6.5 8L10.5 12L6.5 16', 'M12.5 16H17.5'] }],
]);
function runtimeMark(doc, { viewBox, paint, paths }) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'runtime-mark'); svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  if (paint === 'fill') svg.setAttribute('fill', 'currentColor');
  else for (const [name, value] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2.25'],
    ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) svg.setAttribute(name, value);
  for (const d of paths) { const path = doc.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
/** A reported harness's display name (Claude, Pi, Codex), else the value verbatim. */
export function harnessName(value) {
  const reported = typeof value === 'string' ? value.trim() : '';
  return runtimeMarks.get(reported.toLowerCase())?.name || reported;
}
const monogram = value => (typeof value === 'string' ? value.match(/[\p{L}\p{N}]/u)?.[0] : null)?.toUpperCase() || '?';
function identityMark(doc, name, color, kind) {
  const el = doc.createElement('span');
  el.className = `identity-mark ${kind}`;
  el.dataset.avatarColor = color;
  el.setAttribute('aria-hidden', 'true'); // the adjacent name is authoritative
  el.textContent = monogram(name);
  return el;
}
export function createWorkspaceMark(doc, workspace) {
  return identityMark(doc, workspace?.name || String(workspace?.id || '').split('/').filter(Boolean).at(-1),
    colorForIdentity({ root: workspace?.id, host: workspace?.server }), 'workspace-avatar');
}
export function createSoulMark(doc, soul) {
  return identityMark(doc, soul?.name, soulColor(soul), 'soul-avatar');
}

/** Decorative capability identity ONLY: never used-by souls or memberships.
 * Root/host are the reported inspection scope, id is the reported capability. */
export function createCapabilityMark(doc, capability, { root, host } = {}) {
  return identityMark(doc, capability?.id, colorForIdentity({ root, name: capability?.id, host }), 'capability-avatar');
}

/** The badge describes the REPORTED runtime, not installed providers,
 * executable health, credentials, or authentication. A known harness draws its
 * mark (decorative inside the labelled img); anything else is a "?" text. */
export function createRuntimeBadge(doc, value) {
  const reported = typeof value === 'string' ? value.trim() : '';
  const key = reported.toLowerCase(), known = runtimeMarks.get(key);
  const el = doc.createElement('span'); el.className = 'runtime-badge';
  if (known) el.dataset.runtime = key; // closed set, even for hostile metadata
  const label = `Harness: ${known?.name || reported || 'Not reported'}`;
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); el.title = label;
  if (known) el.append(runtimeMark(doc, known)); else el.textContent = '?';
  return el;
}

import { colorForIdentity, soulColor } from './soul-colors.mjs';

// Theme branches own all colors, including AA foreground/background pairs.
// No data is ever interpolated into styles, SVG, HTML, or resource URLs.
export const identityCSS = `
.identity-mark { display:inline-grid; place-items:center; flex:none; width:36px; height:36px; border-radius:9px; font-size:15px; font-weight:650; }
.runtime-badge { display:inline-grid; place-items:center; flex:none; width:18px; height:18px; border-radius:5px; font-size:9.5px; font-weight:700; }
`;

const runtimeMarks = new Map([
  ['claude', { name: 'Claude', mark: 'C' }],
  ['pi', { name: 'Pi', mark: 'π' }],
  ['codex', { name: 'Codex', mark: 'Cx' }],
]);
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

/** These supplied-design placeholders describe the REPORTED runtime, not
 * installed providers, executable health, credentials, or authentication. */
export function createRuntimeBadge(doc, value) {
  const reported = typeof value === 'string' ? value.trim() : '';
  const key = reported.toLowerCase(), known = runtimeMarks.get(key);
  const el = doc.createElement('span'); el.className = 'runtime-badge';
  if (known) el.dataset.runtime = key; // closed set, even for hostile metadata
  const label = `Harness: ${known?.name || reported || 'Not reported'}`;
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); el.title = label;
  el.textContent = known?.mark || '?';
  return el;
}

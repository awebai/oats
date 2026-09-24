/** `oats inspect --json` on the workspace model (`operationsApi: 2`; each soul
 * row `soulsApi: 2`). The subject is an instance (`--home`) or a soul
 * (`--soul`), never a scope. Everything shown is the kernel's record: a
 * capability's origin is its module's `from`, its settings the merged payload.
 * Presentation-only; no classic field (scope chain, activation, trust,
 * snapshot drift, sources provenance) is read. */
import { memberLabel } from './deployment-facts.mjs';

export const OPERATIONS_API = 2;
export const SOULS_API = 2;
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string';
const short = v => str(v) && /^[0-9a-f]{7,64}$/.test(v) ? v.slice(0, 7) : null;

/** The probe integer is the gate (no feature string). */
export const inspectSupported = cli => cli?.ok === true && cli.operationsApi === OPERATIONS_API;

/** The inspection for this selection, or null when it is not the operationsApi 2
 * document for exactly this subject. */
export function inspectData(v, selection) {
  if (!record(v) || v.operationsApi !== OPERATIONS_API || !record(v.subject) || !Array.isArray(v.souls) || v.souls.length > 1
    || !Array.isArray(v.capabilities) || !record(v.layers) || !Array.isArray(v.problems)) return null;
  const s = v.subject;
  if (selection?.instance) {
    if (s.kind !== 'instance' || s.home !== selection.selector?.home || !record(v.instance)) return null;
  } else if (selection?.agent) {
    if (s.kind !== 'soul' || s.soul !== selection.agent.name || v.instance !== null) return null;
  } else return null;
  if (v.souls.some(row => !record(row) || row.soulsApi !== SOULS_API)) return null;
  if (v.capabilities.some(cap => !record(cap) || !str(cap.id) || !Array.isArray(cap.operations ?? []))) return null;
  return v;
}

const text = (v, fallback = '—') => v === undefined || v === null || v === '' ? fallback : String(v);
/** A module's `from`: member commit, or package version + commit. */
export function originText(from) {
  if (!record(from)) return 'Not reported';
  if (from.kind === 'package') return `package ${text(from.package, '?')} ${text(from.version, '')}`.trimEnd() + (short(from.commit) ? ` @ ${short(from.commit)}` : '');
  if (from.kind === 'member') return `member ${memberLabel(from.repoKey)}${short(from.commit) ? ` @ ${short(from.commit)}` : ''}`;
  return text(from.kind);
}
export const inspectFacts = {
  soul: soul => [
    ['Source', soul.kind === 'external' ? `external ${text(soul.repoKey, '')}`.trimEnd() : `member ${memberLabel(soul.repoKey)}${short(soul.commit) ? ` @ ${short(soul.commit)}` : ''}`],
    ['Team', text(soul.team)], ['Path', text(soul.path)], ['Work', text(soul.work)],
    ['Runtime', text(soul.runtime, 'Chosen at spawn')], ['Model', text(soul.model, 'Runtime default')],
  ],
  instance: i => [
    ['Runtime', text(i.runtime)], ['Model', text(i.model, 'Runtime default')],
    ['Permissions', i.yolo === true ? 'Unrestricted (yolo)' : i.yolo === false ? 'Restricted' : 'Runtime default'],
    ['Launched', i.launched === true ? 'Yes' : i.launched === false ? 'No' : '—'], ['Created', text(i.createdAt)],
    ['Resolution', str(i.resolution) ? i.resolution.slice(0, 12) : '—'],
  ],
  capability: cap => [
    ['Version', text(cap.version)], ['Layer', text(cap.layer, 'None')], ['Origin', originText(cap.from)],
    ['Missing requirements', Array.isArray(cap.missingRequires) && cap.missingRequires.length ? cap.missingRequires.join(', ') : 'None'],
  ],
  layers: layers => ['knowledge', 'messaging', 'tasks'].map(layer => [layer[0].toUpperCase() + layer.slice(1),
    !record(layers[layer]) ? 'Not reported' : layers[layer].id || 'None']),
};

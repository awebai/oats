// The harvest switch (okf 4.0.0; plan §2.4). `harvest: on|off` is a host
// fact, default off. A soul may only opt OUT (`knowledge: { harvest: off }` in
// soul.yaml), and that opt-out is absolute. The kernel merges soul ⊕ host ⊕
// spawn with later-wins, so a host `on` would hide a soul `off` in the merged
// settings. The soul's own value is therefore read from its soul.yaml
// ($OATS_SOUL), with a deliberately small reader. Anything it cannot read with
// certainty counts as off (fail closed): a private transcript is never kept
// because a file was ambiguous.
import { fs, join } from './io.mjs';

const VALUES = ['on', 'off'];
const scalar = (raw) => {
  const v = raw.replace(/\s+#.*$/, '').trim();
  const q = /^(['"])(.*)\1$/.exec(v);
  return q ? q[2] : v;
};
/** The soul's own `knowledge.harvest` → { value: 'on'|'off'|null, readable, why }. */
export function soulHarvest(soulDir) {
  if (!soulDir) return { value: null, readable: false, why: 'the soul directory is not known to this command (OATS_SOUL unset)' };
  let text;
  try { text = fs.readFileSync(join(soulDir, 'soul.yaml'), 'utf8'); } catch (e) { return { value: null, readable: false, why: `soul.yaml unreadable (${e.code || e.message})` }; }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^knowledge\s*:/.test(l));
  if (at < 0) return { value: null, readable: true, why: 'no knowledge: payload' };
  const rest = lines[at].replace(/^knowledge\s*:/, '').replace(/\s+#.*$/, '').trim();
  if (rest === 'none' || rest === "'none'" || rest === '"none"') return { value: null, readable: true, why: 'knowledge: none' };
  if (rest.startsWith('{')) {
    if (!rest.endsWith('}') || /[{}]/.test(rest.slice(1, -1))) return { value: null, readable: false, why: 'knowledge: flow mapping is not a single flat line' };
    const pairs = rest.slice(1, -1).split(',').map((p) => p.trim()).filter(Boolean);
    let value = null;
    for (const pair of pairs) {
      const m = /^(['"]?)([A-Za-z0-9._-]+)\1\s*:\s*(.*)$/.exec(pair);
      if (!m) return { value: null, readable: false, why: 'knowledge: flow mapping entry is not key: value' };
      if (m[2] === 'harvest') value = scalar(m[3]);
    }
    return shaped(value);
  }
  if (rest !== '') return { value: null, readable: false, why: 'knowledge: is neither none, a flow mapping nor a block mapping' };
  let value = null, indent = null;
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const lead = /^(\s*)/.exec(line)[1].length;
    if (lead === 0) break;
    if (/\t/.test(line.slice(0, lead))) return { value: null, readable: false, why: 'tab indentation under knowledge:' };
    if (indent === null) indent = lead;
    if (lead < indent) return { value: null, readable: false, why: 'inconsistent indentation under knowledge:' };
    if (lead > indent) continue; // a nested value of another key
    const m = /^\s*(['"]?)([A-Za-z0-9._-]+)\1\s*:(.*)$/.exec(line);
    if (!m) return { value: null, readable: false, why: 'a knowledge: entry is not key: value' };
    if (m[2] === 'harvest') value = scalar(m[3]);
  }
  return shaped(value);
}
function shaped(value) {
  if (value === null) return { value: null, readable: true, why: 'the soul does not set harvest' };
  if (!VALUES.includes(value)) return { value: null, readable: false, why: `the soul's harvest is ${JSON.stringify(value)}, not on or off` };
  return { value, readable: true, why: `soul.yaml knowledge.harvest: ${value}` };
}
/** Effective = on only if the deployment says on AND the soul does not say off.
 *  A soul `on` is ignored and reported: a soul cannot switch a host on. It also
 *  hides the host's value (the kernel's merged `harvest` is then the soul's),
 *  so with a soul `on` the switch stays off until the soul drops the line. */
export function harvestSwitch({ settings = {}, soulDir = process.env.OATS_SOUL } = {}) {
  const deployment = VALUES.includes(settings.harvest) ? settings.harvest : 'off';
  const soul = soulHarvest(soulDir);
  const rows = [
    { layer: 'deployment', value: deployment, why: settings.harvest === undefined ? 'harvest is not set (default off)' : `settings.oats.okf.harvest: ${settings.harvest}` },
    { layer: 'soul', value: soul.value, readable: soul.readable, why: soul.why },
  ];
  const warnings = [];
  if (soul.value === 'on') warnings.push('the soul says harvest: on, which is ignored: only the deployment can switch harvest on; a soul may only opt out with harvest: off');
  let effective = 'off', reason;
  if (soul.value === 'on') reason = "the soul's harvest: on is ignored and hides the deployment's own value; remove it from soul.yaml (a soul may only opt out)";
  else if (deployment !== 'on') reason = 'the deployment does not switch harvest on (oats-local.yaml settings.oats.okf.harvest)';
  else if (!soul.readable) reason = `the soul's opt-out could not be read (${soul.why}); unreadable counts as off`;
  else if (soul.value === 'off') reason = 'the soul opts out (knowledge: { harvest: off }), which the deployment cannot override';
  else { effective = 'on'; reason = 'the deployment switches harvest on and the soul does not opt out'; }
  return { effective, reason, rows, warnings };
}
/** The home's record that it was spawned with harvest off (no source registered). */
export const instanceRecordPath = (home) => join(home, '.okf-instance.json');

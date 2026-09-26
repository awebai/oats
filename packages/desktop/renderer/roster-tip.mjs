/** Workspace v4 sidebar: hovering (or keyboard-focusing) an instance row
 * shows a card beside the sidebar with what the roster reports about it —
 * Soul, Repo, Branch, Harness, Status. One card per document; presentation
 * only, never a control. */
import { createRuntimeBadge, harnessName } from './identity-marks.mjs';
import { runtimeState } from './instance-presentation.mjs';
import { instanceRepoLabel } from './instance-tree.mjs';

export const rosterTipCSS = `
.ctx-tip { position:fixed; z-index:60; width:320px; max-width:calc(100vw - 24px); box-sizing:border-box; display:flex; flex-direction:column; gap:8px;
  padding:12px 14px; background:var(--surface); border:1px solid var(--border); border-radius:9px; box-shadow:var(--shadow-popover);
  color:var(--fg); font-size:12px; pointer-events:none; }
.ctx-tip[hidden] { display:none; }
.ctx-tip-name { color:var(--fg); font-size:13px; font-weight:650; line-height:1.3; overflow-wrap:anywhere; }
.ctx-tip-facts { display:flex; flex-direction:column; gap:5px; margin:0; }
.ctx-tip-fact { display:flex; align-items:center; gap:10px; min-width:0; }
.ctx-tip-fact dt { width:52px; flex:none; color:var(--muted); }
.ctx-tip-fact dd { display:flex; align-items:center; gap:6px; min-width:0; margin:0; color:var(--fg); overflow-wrap:anywhere; }
.ctx-tip-fact dd.mono { font-family:var(--mono, ui-monospace, Menlo, monospace); }
.ctx-tip-fact .runtime-badge { width:16px; height:16px; border-radius:4px; font-size:9px; }
`;

/** The facts the card shows, from the roster row only (absent facts stay absent). */
export function rosterTipFacts(instance, why = '') {
  const text = v => typeof v === 'string' && v ? v : null;
  const state = runtimeState(instance);
  return {
    name: instance.instance,
    rows: [
      ['Soul', text(instance.agent)],
      ['Repo', text(instanceRepoLabel(instance)), 'mono'],
      ['Branch', text(instance.branch), 'mono'],
      ['Harness', text(instance.harness) ? { harness: instance.harness, model: text(instance.model) } : null],
      ['Status', [state === 'unknown' ? 'status unknown' : state, text(instance.runtimeError)].filter(Boolean).join(' · ')],
    ].filter(([, value]) => value),
    why,
  };
}

export function createRosterTip(doc) {
  let tip = null, timer = null, owner = null;
  const tipFacts = new WeakMap();
  const ensure = () => {
    if (tip?.isConnected) return tip;
    tip = doc.createElement('div'); tip.className = 'ctx-tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
    tip.id = 'ctx-roster-tip'; doc.body.append(tip); return tip;
  };
  function show(row, facts) {
    const el = ensure(); el.replaceChildren();
    const name = doc.createElement('span'); name.className = 'ctx-tip-name'; name.textContent = facts.name;
    const list = doc.createElement('dl'); list.className = 'ctx-tip-facts';
    for (const [key, value, cls] of facts.rows) {
      const line = doc.createElement('div'); line.className = 'ctx-tip-fact';
      const dt = doc.createElement('dt'); dt.textContent = key;
      const dd = doc.createElement('dd'); if (cls) dd.className = cls;
      if (key === 'Harness') {
        const label = doc.createElement('span'); label.textContent = [harnessName(value.harness), value.model].filter(Boolean).join(' · ');
        dd.append(createRuntimeBadge(doc, value.harness), label);
      } else dd.textContent = value;
      line.append(dt, dd); list.append(line);
    }
    el.append(name, list);
    const rect = row.getBoundingClientRect(), view = doc.defaultView;
    el.hidden = false;
    const height = el.getBoundingClientRect().height || 0;
    el.style.left = `${Math.round(Math.min(rect.right + 14, (view?.innerWidth || 0) - 332))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(rect.top - 6, (view?.innerHeight || 0) - height - 8)))}px`;
    owner = row; row.setAttribute('aria-describedby', el.id);
  }
  function hide() {
    clearTimeout(timer); timer = null;
    if (owner) { owner.removeAttribute('aria-describedby'); owner = null; }
    if (tip) tip.hidden = true;
  }
  return {
    /** Wire one row: hover shows the card after a short delay; keyboard focus shows it at once. */
    bind(row, facts) {
      tipFacts.set(row, facts);
      row.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => { if (row.isConnected) show(row, facts()); }, 350); });
      row.addEventListener('mouseleave', hide);
      row.addEventListener('focus', () => { if (row.matches(':focus-visible')) show(row, facts()); });
      row.addEventListener('blur', hide);
      row.addEventListener('click', hide);
    },
    hide,
    /** After the roster is rebuilt (polling), keep the card on the same instance's new row while it is still hovered or focused. */
    sync(root) {
      if (!owner || owner.isConnected) return;
      const key = owner.dataset.treeInstance;
      const next = [...root.querySelectorAll('[data-tree-instance]')].find(el => el.dataset.treeInstance === key);
      const facts = next && tipFacts.get(next);
      if (facts && (next.matches(':hover') || next.matches(':focus-visible'))) { owner.removeAttribute('aria-describedby'); show(next, facts()); }
      else hide();
    },
  };
}

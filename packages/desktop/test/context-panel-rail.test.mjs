// Spec G item 2: the collapsed context panel's rail icons sit on the rail's centre line, in the side
// placement (a 44px column with a 1px left border) and in the stacked placement (a 34px row under the
// main surface, shell.css's max-width:1000px block). jsdom has no layout: the CSSOM carries the rule
// (rail centres its controls on the cross axis, no control has a cross-axis auto margin, each control
// centres its block icon), and a small model checks the arithmetic from the computed sizes. The live
// counterpart was measured on the rig over CDP: every button and icon centre 0.00px off the centre
// line in both placements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';

const shellCss = readFileSync(new URL('../renderer/shell.css', import.meta.url), 'utf8');
// The stacked placement is shell.css's narrow-workbench block; jsdom evaluates no media queries, so
// that block's rules are applied unwrapped to model a narrow window.
const stackedCss = shellCss.match(/@media \(max-width: 1000px\) \{([\s\S]*?)\n\}/)[1];

function fixture(t, { stacked }) {
  const dom = new JSDOM(`<!doctype html><body><div id="app"><div id="workbench"><main id="main"></main><aside id="context-panel"></aside></div></div></body>`);
  const document = dom.window.document;
  for (const text of [shellCss.replace(/@media \(max-width: 1000px\) \{[\s\S]*?\n\}/, ''), contextPanelCSS, stacked ? stackedCss : '']) {
    const style = document.createElement('style'); style.textContent = text; document.head.append(style);
  }
  const panel = createContextPanel({ document, root: document.getElementById('context-panel') });
  t.after(() => { panel.dispose(); dom.window.close(); });
  panel.setContext({ workspace: 'A', key: '/h/dev-1', instance: { instance: 'dev-1', agent: 'dev', home: '/h/dev-1', running: true } });
  document.querySelector('#context-panel .context-panel-collapse').click();
  const css = el => dom.window.getComputedStyle(el);
  const rail = document.querySelector('#context-panel .context-panel-rail');
  const controls = [...rail.children].filter(el => el.tagName === 'BUTTON' && !el.hidden);
  return { dom, document, css, root: document.getElementById('context-panel'), rail, controls };
}

for (const stacked of [false, true]) test(`${stacked ? 'stacked' : 'side'} rail: every icon is on the rail's centre line`, t => {
  const u = fixture(t, { stacked });
  assert.ok(u.root.classList.contains('is-collapsed'), 'the panel is collapsed to its rail');
  assert.equal(u.rail.hidden, false);
  assert.deepEqual(u.controls.map(b => b.getAttribute('aria-label')), ['Instance', 'Soul', 'Developer', 'Expand context panel']);
  const row = u.css(u.rail).flexDirection === 'row';
  assert.equal(u.css(u.rail).flexDirection, stacked ? 'row' : 'column');
  assert.equal(u.css(u.rail).display, 'flex');
  assert.equal(u.css(u.rail).alignItems, 'center', 'the rail centres its controls on the cross axis');
  const cross = row ? ['marginTop', 'marginBottom'] : ['marginLeft', 'marginRight'];
  for (const control of u.controls) {
    const style = u.css(control), label = control.getAttribute('aria-label');
    for (const side of cross) assert.notEqual(style[side], 'auto', `${label}: no cross-axis auto margin pulls it off the line (${side})`);
    // .shell-icon is display:block, which text-align cannot centre: the control centres it as a flex box.
    assert.equal(style.display, 'flex', label); assert.equal(style.justifyContent, 'center', label); assert.equal(style.alignItems, 'center', label);
    assert.equal(control.querySelector('svg.shell-icon')?.parentElement, control, `${label}: the icon is the control's own child`);
  }
  // The model: the rail fills the panel's content box (the border is outside it, box-sizing border-box)
  // with symmetric cross-axis padding, so a centred control's centre is the content box's centre, and
  // a centred icon's centre is the control's. Offsets are measured from the visible inner box.
  const px = value => parseFloat(value) || 0;
  const panel = u.css(u.root), railStyle = u.css(u.rail);
  const [startBorder, endBorder, startPad, endPad] = row
    ? [px(panel.borderTopWidth), px(panel.borderBottomWidth), px(railStyle.paddingTop), px(railStyle.paddingBottom)]
    : [px(panel.borderLeftWidth), px(panel.borderRightWidth), px(railStyle.paddingLeft), px(railStyle.paddingRight)];
  assert.equal(startPad, endPad, 'cross-axis padding is symmetric');
  const extent = px(row ? panel.minHeight : panel.width) || px(panel.flexBasis);
  assert.ok(extent > 0, 'the collapsed extent is declared');
  const inner = extent - startBorder - endBorder, centre = startBorder + inner / 2;
  for (const control of u.controls) {
    const size = px(row ? u.css(control).height || u.css(control).minHeight : u.css(control).width) || px(u.css(control).minHeight);
    const controlCentre = startBorder + startPad + (inner - startPad - endPad - size) / 2 + size / 2;
    assert.ok(Math.abs(controlCentre - centre) <= 0.5, `${control.getAttribute('aria-label')} centre ${controlCentre} vs ${centre}`);
  }
});

test('the rail keeps its keyboard roving (Up/Down wrap, Home/End) in both placements', t => {
  for (const stacked of [false, true]) {
    const u = fixture(t, { stacked });
    const labels = [];
    u.controls[0].focus();
    for (const key of ['ArrowDown', 'ArrowDown', 'End', 'ArrowDown', 'Home', 'ArrowUp']) {
      u.document.activeElement.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      labels.push(u.document.activeElement.getAttribute('aria-label'));
    }
    assert.deepEqual(labels, ['Soul', 'Developer', 'Expand context panel', 'Instance', 'Instance', 'Expand context panel'], stacked ? 'stacked' : 'side');
  }
});

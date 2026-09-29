/** Spawn dialog on workspace model v2.
 *
 * What the operator sees is what the kernel decided: the dialog reads a spawn
 * preview in the background whenever a choice changes (latest intent wins)
 * and shows the real defaults — instance name, harness, model and where it
 * came from, the work area, branch and base. Nothing here derives a name, a
 * path or a default.
 *
 * Spawn is one click: the server prepares a fresh confirmation, and only when
 * its decision is the one on screen does it apply it (`--expect-decision`,
 * idempotency key). If the world moved, the dialog shows the new values and
 * asks again. An unknown outcome is checked on the same intent, never retried
 * under a new one. */
import { harnessOf } from './harness-names.mjs';
import { createSoulMark, createRuntimeBadge } from './identity-marks.mjs';
import { distinguishingRootTags } from './instance-tree.mjs';
import { createChoicePopup } from './choice-popup.mjs';
import { postJson, workspaceGeneration, wsQuery } from './views/common.mjs';
import { previewSupported, previewChoices, previewData, previewTarget, previewFailure, INSTANCE_NAME_MAX } from './spawn-preview-contract.mjs';
import { spawnApplySupported, spawnPrepareInput, spawnApplyView, spawnApplyReason } from './spawn-apply-contract.mjs';
import { sameSpawnDecision } from './spawn-decision.mjs';
import { spawnProblem } from './spawn-messages.mjs';
import { wakeScheduleFields } from './wake-schedule-fields.mjs';
import { iconElement } from './shell-icons.mjs';
import { shownLaunch, launchHarnessName, launchModelText, launchFromText, preferenceText, declaredDiffers } from './launch-view.mjs';

export const PREVIEW_DEBOUNCE_MS = 250;
export const RUNTIME_NAMES = Object.freeze({ pi: 'Pi', claude: 'Claude Code', codex: 'Codex' });
const PURPOSE = /^[a-z0-9][a-z0-9-]*$/i;

export const spawnDialogCSS = `
/* The modal centres in a grid whose auto track grows to the dialog, so 100% would not cap it: the viewport does. */
.spawn-modal .spawn-dialog { width:880px; max-width:calc(100vw - 48px); box-sizing:border-box; max-height:calc(100vh - 48px); padding:0; gap:0; overflow:hidden; background:var(--surface); box-shadow:var(--shadow-modal); }
/* Two layouts, switched in place (design board 6): 'picker' = soul chooser + form; 'scoped' = the
   preview of what the kernel will create + form, for one soul. Hidden columns stay in the DOM under
   [hidden] so the host's focus trap skips them. */
.spawn-modal .spawn-dialog[data-layout=scoped] { width:1000px; }
.spawn-modal .spawn-dialog-head { min-height:52px; flex:none; align-items:center; gap:10px; padding:0 12px 0 20px; border-bottom:1px solid var(--border); }
.spawn-modal .spawn-dialog-head h2 { flex:none; font-size:15px; font-weight:700; }
.spawn-head-copy { flex:1; min-width:0; display:flex; align-items:center; gap:10px; }
.spawn-context { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:12px; }
.spawn-modal .spawn-dialog[data-layout=scoped] .spawn-dialog-head { min-height:0; padding:16px 12px 16px 20px; gap:12px; }
.spawn-dialog-head .spawn-head-mark { width:34px; height:34px; border-radius:9px; font-size:14px; }
.spawn-dialog[data-layout=scoped] .spawn-head-copy { flex-direction:column; align-items:stretch; gap:1px; }
.spawn-modal .spawn-dialog[data-layout=scoped] .spawn-dialog-head h2 { font-size:16px; }
/* A link, not a button: the soul is the dialog's subject, changing it is a side path. */
.spawn-change-soul { flex:none; border:0; background:none; padding:0; font:600 12px var(--sans,system-ui); color:var(--accent); cursor:pointer; }
.spawn-change-soul:hover { text-decoration:underline; text-underline-offset:2px; }
.spawn-dialog .close-act { flex:none; margin-left:auto; display:grid; place-items:center; }
.spawn-columns { display:grid; grid-template-columns:300px minmax(0,1fr); height:calc(100vh - 100px); max-height:700px; min-height:0; overflow:hidden; }
.spawn-dialog[data-layout=scoped] .spawn-columns { grid-template-columns:360px minmax(0,1fr); }
/* The preview column: what the kernel will create, re-drawn from every observation. */
.spawn-preview { display:flex; flex-direction:column; gap:16px; min-width:0; min-height:0; overflow:auto; padding:18px 20px; box-sizing:border-box; background:var(--surface-2); border-right:1px solid var(--border); }
.spawn-preview-section { display:flex; flex-direction:column; gap:6px; min-width:0; }
.spawn-preview-title { margin:0; font-size:10.5px; font-weight:650; letter-spacing:.065em; text-transform:uppercase; color:var(--muted); }
.spawn-preview-facts { display:grid; grid-template-columns:86px minmax(0,1fr); row-gap:8px; column-gap:10px; margin:0; font-size:12.5px; color:var(--fg); }
.spawn-preview-facts dt { margin:0; color:var(--muted); }
.spawn-preview-facts dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.spawn-preview-facts .mono, .spawn-core-row .mono, .spawn-cap-row .mono { font-family:var(--mono,monospace); }
.spawn-preview .muted { color:var(--muted); }
.spawn-preview-harness { display:flex; align-items:center; gap:6px; }
.spawn-preview-harness .runtime-badge { width:16px; height:16px; border-radius:4px; font-size:9px; }
/* Loading: the shape of the facts, no words (the sr-only text says it). */
.spawn-preview-skeleton { display:grid; grid-template-columns:86px minmax(0,1fr); row-gap:10px; column-gap:10px; align-items:center; }
.spawn-preview-skeleton span { display:block; height:12px; border-radius:6px; background:var(--tag-bg); }
.spawn-preview-skeleton span:nth-child(odd) { width:56px; }
.spawn-preview-skeleton span:nth-child(2) { width:72%; }
.spawn-preview-skeleton span:nth-child(4) { width:46%; }
.spawn-preview-skeleton span:nth-child(6) { width:60%; }
.spawn-preview-skeleton span:nth-child(8) { width:34%; }
.spawn-preview-failure { margin:0; font-size:12.5px; line-height:1.5; color:var(--warn); overflow-wrap:anywhere; }
.spawn-preview-empty { margin:0; font-size:12.5px; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
.spawn-core-box { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:8px; background:var(--surface); font-size:12px; color:var(--fg); }
.spawn-core-row { display:flex; padding:7px 10px; border-bottom:1px solid var(--border); min-width:0; }
.spawn-core-row:last-child { border-bottom:0; }
.spawn-core-row .spawn-core-layer { flex:none; width:84px; color:var(--muted); }
.spawn-core-row .mono, .spawn-core-row .muted { min-width:0; overflow-wrap:anywhere; }
.spawn-core-row .muted { color:var(--muted); }
.spawn-cap-list { display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--fg); }
.spawn-cap-row { display:flex; align-items:center; gap:8px; min-width:0; }
.spawn-cap-row .mono { flex:1; min-width:0; overflow-wrap:anywhere; }
.spawn-cap-source, .spawn-cap-why { flex:none; padding:1px 6px; border-radius:4px; background:var(--tag-bg); color:var(--muted); font-size:10.5px; font-weight:600; white-space:nowrap; }
.spawn-preview-note { margin:auto 0 0; font-size:11.5px; line-height:1.5; color:var(--muted); }
.spawn-chooser { border-right:1px solid var(--border); min-width:0; min-height:0; overflow:auto; padding:16px 10px 12px; }
.spawn-chooser-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin:0 6px 10px; }
.spawn-chooser-title { margin:0; font-size:13px; font-weight:650; color:var(--fg); }
.spawn-search-label { display:flex; align-items:center; gap:6px; margin:0 4px 10px; }
.spawn-search-label input { min-width:0; flex:1; }
.spawn-search-count { flex:none; color:var(--muted); font:10.5px var(--mono,monospace); }
.spawn-chooser h3 { margin:14px 8px var(--title-gap); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); overflow-wrap:anywhere; }
.spawn-choice { width:100%; min-height:56px; display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid transparent; border-radius:8px; text-align:left; background:var(--surface); color:var(--fg); font:inherit; cursor:pointer; }
.spawn-choice[aria-pressed=true] { background:var(--sel); border-color:var(--accent); }
.spawn-choice .spawn-choice-check { flex:none; color:var(--accent); visibility:hidden; }
.spawn-choice[aria-pressed=true] .spawn-choice-check { visibility:visible; }
.spawn-choice:disabled { color:var(--muted); cursor:default; }
.spawn-choice-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:1px; }
.spawn-choice strong { font-size:12.5px; overflow-wrap:anywhere; }
.spawn-choice small { font-size:11px; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
.spawn-choice .identity-mark { flex:none; width:30px; height:30px; border-radius:8px; }
.spawn-chooser-note { margin:6px 8px; color:var(--muted); font-size:11.5px; line-height:1.5; overflow-wrap:anywhere; }
.spawn-chooser-note:empty { display:none; }
.spawn-form { min-width:0; min-height:0; overflow:hidden; display:flex; flex-direction:column; }
.spawn-form-body { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:var(--section-gap); padding:20px 24px; box-sizing:border-box; }
.spawn-field { display:flex; flex-direction:column; gap:var(--title-gap); min-width:0; margin:0; padding:0; border:0; }
/* a legend is not a flex item: the title gap is its own margin */
.spawn-field > legend { margin-bottom:var(--title-gap); }
.spawn-label, .spawn-field > label, .spawn-name-head > label, .spawn-row > label > .spawn-label-text, .spawn-field > legend { display:flex; align-items:center; gap:6px; padding:0; font-size:11.5px; font-weight:650; color:var(--muted); }
.spawn-label .shell-icon { color:var(--muted); }
.spawn-label small { font-weight:500; }
.spawn-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.spawn-row > label { display:flex; flex-direction:column; gap:var(--title-gap); min-width:0; }
.spawn-form .field { min-width:0; width:100%; box-sizing:border-box; }
/* Focus is the shell's (rule 2/3: fields turn their border accent); a joined wrapper is the one frame of its inputs. */
.spawn-joined:focus-within { border-color:var(--accent); }
/* Name: the hero field. One frame (the wrapper's border) that turns to the accent on focus; no ring. */
.spawn-name-input { display:flex; align-items:stretch; min-width:0; height:36px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.spawn-name-input:focus-within { border-color:var(--accent); box-shadow:none; outline:none; }
.spawn-name-prefix { flex:none; display:flex; align-items:center; max-width:55%; padding:0 0 0 12px; color:var(--muted); font:13px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.spawn-name-input input.field { flex:1; height:100%; border:0; border-radius:8px; background:transparent; padding:0 12px 0 1px; font:600 13px var(--mono,monospace); color:var(--fg); }
.spawn-dialog .spawn-name-input input.field, .spawn-dialog .spawn-name-input input.field:focus, .spawn-dialog .spawn-name-input input.field:focus-visible { outline:none; border:0; box-shadow:none; }
.spawn-name-result { display:flex; align-items:center; gap:6px; }
.spawn-name-head { display:flex; align-items:center; gap:12px; }
.spawn-name-head .spawn-switch { margin-left:auto; font-size:11.5px; color:var(--muted); }
.spawn-name-input.unprefixed .spawn-name-prefix { display:none; }
.spawn-name-input.unprefixed input.field { padding-left:12px; }
.spawn-name-result strong { font:600 11.5px var(--mono,monospace); color:var(--fg); }
.spawn-hint { margin:0; color:var(--muted); font-size:11.5px; line-height:1.5; overflow-wrap:anywhere; }
.spawn-hint:empty { display:none; }
.spawn-hint code, .spawn-work-text code { font:11.5px var(--mono,monospace); color:var(--fg); }
.spawn-hint.err { color:var(--danger); }
/* Teams (teams contract): one line like Relationship — Default fixed on, mapped teams toggle, unmapped greyed. */
.spawn-teams-row { flex-wrap:wrap; align-self:flex-start; max-width:100%; box-sizing:border-box; }
.spawn-seg input:disabled { cursor:default; }
/* A shared team with no provider id yet: shown, not choosable (muted text, still AA; no opacity). */
.spawn-seg .spawn-team-off .spawn-team-name { color:var(--muted); cursor:default; }
/* Default is fixed, not a choice: a quiet neutral chip (its own hairline, not the accent tint). */
.spawn-seg .spawn-team-fixed input:checked + span { background:var(--surface); color:var(--fg); font-weight:500; box-shadow:inset 0 0 0 1px var(--border); cursor:default; }
/* Runtime picker and model field */
.spawn-run .spawn-choice-trigger { height:38px; min-height:38px; border-radius:8px; }
.spawn-run .spawn-choice-trigger .runtime-badge, .spawn-choice-menu .runtime-badge { flex:none; width:20px; height:20px; border-radius:5px; display:grid; place-items:center; font-size:9.5px; font-weight:700; }
.spawn-choice-menu button.has-mark { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.spawn-choice-menu button.has-mark small { flex-basis:100%; margin-left:30px; margin-top:-2px; }
.spawn-trigger-tag, .spawn-input-tag { flex:none; padding:1px 7px; border-radius:999px; background:var(--chip-bg); color:var(--muted); font:600 10.5px var(--sans,system-ui); }
.spawn-trigger-tag { margin-left:2px; }
.spawn-input-tag:empty { display:none; }
.spawn-model-default { position:absolute; left:11px; right:80px; top:50%; transform:translateY(-50%); pointer-events:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 12.5px var(--sans,system-ui); color:var(--fg); }
.spawn-model-default:empty, .spawn-model-field input.field:not(:placeholder-shown) ~ .spawn-model-default { display:none; }
.spawn-model-controls { display:flex; gap:4px; min-width:0; }
.spawn-model-field { position:relative; flex:1; min-width:0; display:flex; }
.spawn-model-field input.field { height:38px; border-radius:8px; padding-right:80px; }
.spawn-input-tag { position:absolute; right:10px; top:50%; transform:translateY(-50%); pointer-events:none; max-width:84px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spawn-run .spawn-choice-trigger::after { margin-left:auto; }
.spawn-model-controls .spawn-choice-popover { flex:none; }
.spawn-model-controls .spawn-choice-trigger { width:38px; height:38px; min-height:38px; padding:0 10px; border-radius:8px; }
.spawn-model-controls .spawn-choice-trigger::after { margin-left:0; }
.spawn-model-controls .spawn-choice-menu { left:auto; right:0; }
/* Work */
.spawn-joined { display:flex; align-items:stretch; min-width:0; height:38px; border:1px solid var(--border); border-radius:8px; background:var(--surface); overflow:hidden; }
.spawn-joined-from { flex:none; display:flex; align-items:center; gap:6px; padding:0 4px 0 10px; background:var(--surface-2); border-right:1px solid var(--border); color:var(--muted); font-size:11.5px; }
.spawn-joined-from input.field { width:112px; height:100%; border:0; background:transparent; padding:0 6px; font:700 12px var(--mono,monospace); color:var(--fg); }
.spawn-joined > input.field { flex:1; height:100%; border:0; border-radius:0; background:transparent; padding:0 10px; font:12.5px var(--mono,monospace); }
.spawn-joined input.field:focus-visible { box-shadow:none; }
.spawn-work-text { margin:0; font-size:12.5px; line-height:1.5; color:var(--fg); overflow-wrap:anywhere; }
.spawn-work-text:empty { display:none; }
.spawn-switch { display:flex; align-items:center; gap:9px; font-size:12px; color:var(--fg); cursor:pointer; width:max-content; }
.spawn-switch[hidden] { display:none; }
.spawn-switch input { appearance:none; -webkit-appearance:none; flex:none; width:30px; height:18px; margin:0; border-radius:999px; background:var(--muted); position:relative; cursor:pointer; transition:background .15s; }
.spawn-switch input::before { content:''; position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:var(--surface); transition:left .15s; }
.spawn-switch input:checked { background:var(--primary-bg); }
.spawn-switch input:checked::before { left:15px; }
/* Relationship: a segmented control per the shared control rules — one outer frame, tinted
   selection (never white-vs-grey), keyboard focus as tint + a 1px accent edge, no ring on click. */
.spawn-relationship-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0; }
.spawn-seg { display:inline-flex; flex:none; gap:2px; padding:2px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.spawn-seg label { position:relative; display:block; cursor:pointer; }
.spawn-seg input { position:absolute; inset:0; appearance:none; -webkit-appearance:none; margin:0; border:0; background:transparent; cursor:pointer; }
.spawn-seg span { display:flex; align-items:center; height:28px; padding:0 12px; border-radius:6px; font-size:12px; font-weight:500; color:var(--muted); white-space:nowrap; }
.spawn-seg input:checked + span { background:var(--sel); color:var(--accent); font-weight:650; }
.spawn-seg input:focus-visible + span { background:var(--sel); box-shadow:inset 0 0 0 1px var(--accent); }
.spawn-relationship-row .frelto { flex:1 1 200px; width:auto; min-width:0; height:34px; }
.spawn-relationship-row .frelto[hidden] { display:none; }
.spawn-form .ftask { min-height:88px; resize:vertical; border-radius:8px; line-height:1.5; }
/* Developer settings */
.spawn-advanced { border:1px solid var(--border); border-radius:10px; background:var(--surface-2); }
.spawn-advanced > summary { display:flex; align-items:center; gap:8px; padding:11px 14px; cursor:pointer; list-style:none; font-size:12px; font-weight:650; color:var(--fg); }
.spawn-advanced > summary::-webkit-details-marker { display:none; }
.spawn-advanced > summary::before { content:''; flex:none; width:6px; height:6px; margin:0 2px; border-right:1.5px solid var(--muted); border-bottom:1.5px solid var(--muted); transform:rotate(-45deg); transition:transform .15s; }
.spawn-advanced[open] > summary::before { transform:rotate(45deg); }
.spawn-advanced > summary small { margin-left:auto; font-weight:400; color:var(--muted); font-size:11px; }
.spawn-advanced-body { display:flex; flex-direction:column; gap:14px; padding:4px 14px 14px; }
.spawn-advanced-body [hidden] { display:none; }
.spawn-dialog fieldset.frelgroup { border:1px solid var(--border); border-radius:8px; margin:0; padding:8px 10px 10px; display:flex; flex-direction:column; gap:8px; background:var(--surface); }
.spawn-dialog fieldset.frelgroup legend { font-size:11.5px; font-weight:650; color:var(--muted); padding:0 4px; }
.spawn-dialog fieldset.frelgroup label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted); }
.spawn-dialog .freldesc { font-size:11.5px; color:var(--muted); }
.spawn-dialog .freldesc:empty { display:none; }
.spawn-footer { flex:none; display:flex; align-items:center; gap:8px; flex-wrap:wrap; border-top:1px solid var(--border); padding:12px 24px; background:var(--surface); }
.spawn-status { flex:1 1 240px; min-width:0; display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 10px; }
.spawn-footer .fstatus { flex:0 1 auto; margin:0; min-width:0; font-size:12.5px; line-height:1.5; color:var(--muted); overflow-wrap:break-word; white-space:pre-line; }
.spawn-footer .fstatus.err { color:var(--danger); }
/* Board 6: a settled preview says so; the check is decoration (empty alt), the words are the status. */
.spawn-footer .fstatus.ok::before { content:"\\2713" / ""; margin-right:5px; color:var(--ok); font-weight:700; }
.spawn-details-toggle { flex:none; border:0; background:none; padding:0; font:inherit; font-size:12px; color:var(--muted); text-decoration:underline; text-underline-offset:2px; cursor:pointer; }
.spawn-details-toggle:hover { color:var(--fg); }
.spawn-details-toggle[hidden], .spawn-problem-detail[hidden] { display:none; }
.spawn-problem-detail { order:9; flex:1 0 100%; margin:0; padding:8px 10px; border-radius:6px; background:var(--surface-2); color:var(--muted); font-size:11.5px; line-height:1.5; overflow-wrap:anywhere; max-height:96px; overflow:auto; }
.spawn-footer .act { min-height:34px; padding:0 16px; border-radius:8px; font-weight:600; }
/* data-chord, not data-shortcut: the shell rewrites [data-shortcut] elements as action-id hints. */
.spawn-footer .fspawn::after { content:attr(data-chord); margin-left:8px; font:10.5px var(--mono,monospace); }
.oats-view .spawn-footer button.fspawn:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.spawn-choice-popover { position:relative; min-width:0; }
.spawn-choice-trigger { width:100%; min-height:36px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:600 12.5px var(--sans,system-ui); text-align:left; padding:0 10px; display:flex; align-items:center; gap:8px; cursor:pointer; }
.spawn-choice-trigger::after { content:''; flex:none; width:6px; height:6px; margin:-3px 3px 0 auto; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(45deg); color:var(--muted); }
.spawn-choice-menu { position:absolute; left:0; top:calc(100% + 4px); width:min(300px,calc(100vw - 60px)); max-height:260px; overflow:auto; z-index:2; border:1px solid var(--border); border-radius:9px; padding:6px; box-shadow:var(--shadow-popover); background:var(--surface); }
.spawn-dialog .spawn-popup-search input.field { min-height:30px; height:30px; padding:0 8px; font-size:12px; }
.spawn-popup-search { position:sticky; top:0; z-index:1; background:var(--surface); padding:0 2px 6px; border-bottom:1px solid var(--border); margin-bottom:4px; }
.spawn-popup-group { padding:6px 8px 3px; font-size:10px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.spawn-popup-status { padding:6px 8px; margin:0; color:var(--muted); font-size:11.5px; }
.spawn-popup-status:empty { display:none; }
.spawn-choice-menu button { width:100%; min-height:36px; border:0; border-radius:6px; background:var(--surface); color:var(--fg); text-align:left; padding:8px 9px; font:12.5px var(--sans,system-ui); cursor:pointer; }
.spawn-choice-menu button[aria-selected=true] { background:var(--sel); }
.spawn-choice-menu button:disabled { color:var(--muted); cursor:default; }
.spawn-choice-menu small { display:block; font-size:10.5px; color:var(--muted); }
/* The segmented inputs are invisible hit areas: their keyboard focus is drawn on the span (above), not on the input. */
.spawn-dialog .spawn-seg input:focus-visible { outline:none; box-shadow:none; }
.spawn-dialog [hidden] { display:none; }
@media(max-width:760px) {
 .spawn-columns, .spawn-dialog[data-layout=scoped] .spawn-columns { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
 .spawn-chooser { max-height:200px; border-right:0; border-bottom:1px solid var(--border); }
 .spawn-preview { max-height:220px; border-right:0; border-bottom:1px solid var(--border); }
 .spawn-row { grid-template-columns:minmax(0,1fr); }
 .spawn-form-body { padding:14px; }
 .spawn-footer { padding:10px 14px; }
 .spawn-relationship-row .frelto { flex-basis:100%; }
}
`;

const node = (doc, tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
const identity = soul => JSON.stringify([soul?.agentsRoot || '', soul?.name || '', soul?.server || '']);
const short = oid => typeof oid === 'string' ? oid.slice(0, 7) : '';
export const runtimeName = value => Object.hasOwn(RUNTIME_NAMES, value) ? RUNTIME_NAMES[value] : value;

/** Human text for the kernel's model decision. */
// Where the bound identity's mode came from (settingsOrigins, feature settings-origins).
const ORIGIN_NAMES = { workspace: 'the workspace', soul: 'the soul', host: 'this host', spawn: 'this spawn' };
const originName = kind => ORIGIN_NAMES[kind] ?? kind;
/** The identity select's Default option: the mode only when the kernel reported
 * it — a manifest default, or another origin it names. Never a mode it did not report. */
function identityDefaultLabel(data, chosen, origins) {
  const m = data?.messaging, bound = m?.identity;
  if (!data || chosen || !bound) return 'Default';
  const shown = bound.mode === 'global' ? `global as ${bound.resident}` : bound.mode;
  // A global resident is the bound identity itself (reported by value).
  if (!origins || !m.origin) return bound.mode === 'global' ? `Default · ${shown}` : 'Default';
  return m.origin.kind === 'manifest-default' ? `Default · ${shown}` : `Default · ${shown} — from ${originName(m.origin.kind)}`;
}
function identityHintText(m, origins) {
  const said = !m.identity ? `Messaging through ${m.provider}: the provider's own default identity.`
    : m.identity.mode === 'global' ? `Messaging through ${m.provider}: acts as the resident ${m.identity.resident} through a session grant.`
      : `Messaging through ${m.provider}: gets its own team identity.`;
  if (!origins || !m.origin || m.origin.kind === 'spawn') return said;
  return `${said} ${m.origin.kind === 'manifest-default' ? "This is the provider's default" : `Set by ${originName(m.origin.kind)}`} (${m.origin.at}).`;
}
/** 0.30 launch preferences: what this spawn runs and where that choice came from (the preview's
 * Launch, flags applied), plus the soul's own preference when this spawn runs something else. */
export function launchHint(data, cli) {
  const launch = shownLaunch(data?.launch, cli);
  if (!launch) return null;
  const said = `Launches ${launchHarnessName(launch.effective.harness)} with ${launchModelText(launch.effective)} · ${launchFromText(launch.from)}.`;
  return declaredDiffers(launch) ? `${said} The soul prefers ${preferenceText(launch.declared)}.` : said;
}
export function modelText(data) {
  if (!data) return '';
  if (data.model === null) return data.modelSource === 'native default (explicit)' ? 'its own default model (chosen)' : 'its own default model';
  return data.modelSource === 'explicit' ? `${data.model} (chosen)` : `${data.model} (${data.modelSource})`;
}
/** Human text for the work area the kernel decided. */
export function workText(data, soulWork) {
  const work = data?.work ?? soulWork;
  if (work === 'worktree') return data?.branch && data.base
    ? { lead: 'Worktree on a new branch ', code: data.branch, tail: ` from ${data.base.ref} · ${short(data.base.oid)}` }
    : { lead: 'Worktree on a new branch', code: '', tail: '' };
  if (work === 'checkout') return data?.repo ? { lead: 'Works directly in the checkout at ', code: data.repo, tail: '' } : { lead: 'Works directly in the member checkout', code: '', tail: '' };
  if (work === 'directory') return { lead: 'Works in its own directory in the instance home', code: '', tail: '' };
  if (work === 'workspace') return { lead: 'Works in the deployment workspace', code: '', tail: '' };
  return { lead: work ? `Work mode: ${work}` : '', code: '', tail: '' };
}
export function permissionText(yolo) {
  return yolo === true ? 'skips prompts' : "harness's policy";
}
/** Where a catalog soul comes from, for the scoped header (soul rows carry soulKind/package/version/repoName/origin). */
export function soulOriginText(soul) {
  if (soul?.soulKind === 'package' && soul.package) return `from package ${soul.package}${soul.version ? ` ${soul.version}` : ''}`;
  if (soul?.soulKind === 'member') return soul.repoName ? `from ${soul.repoName}` : '';
  const from = soul?.origin || soul?.repoName;
  return from ? `from ${from}` : '';
}
/** The preview's work mode in words (board 6, "Works in"); an unknown mode verbatim. */
const WORK_PHRASES = Object.freeze({ __proto__: null, worktree: 'own worktree', checkout: 'shared checkout', attached: "a parent's worktree", directory: 'a folder', workspace: 'all member repos' });
export const worksInText = work => WORK_PHRASES[work] ?? work;
/** A preview module's source, as the Capabilities tag says it: the package and version, the member
 * repository, or the kind verbatim. Never a reason: that is moduleWhyText's, beside it. */
export function moduleSourceText(from) {
  if (from?.kind === 'package') return `package ${from.package ?? ''}${from.version ? ` ${from.version}` : ''}`.trimEnd();
  if (from?.kind === 'member') return `${String(from.repoKey ?? '').split('/').pop().replace(/\.git$/, '') || 'member'} · latest`;
  return typeof from?.kind === 'string' ? from.kind : '';
}
/** Why a preview module is there, as the reason tag beside its source says it: the projection's
 * `composedFrom` (feature preview-composed-from) — "Soul", or "Workspace default" with the core slot
 * a workspace default fills ("Workspace default · messaging"). '' (no tag) when the preview does not
 * say: an older CLI, or a value the projection dropped. Never guessed from the soul. */
const CORE_LAYERS = ['knowledge', 'messaging', 'tasks'];
export function moduleWhyText(m) {
  if (m?.composedFrom === 'soul') return 'Soul';
  if (m?.composedFrom === 'workspace') return CORE_LAYERS.includes(m.layer) ? `Workspace default · ${m.layer}` : 'Workspace default';
  return '';
}
/** The preview column's Core capabilities and Capabilities sections (their children), from the
 * preview's `modules` rows [{name, layer, from, composedFrom?}]; null when the preview carries none
 * (no placeholder). */
export function composePreviewModules(doc, modules) {
  if (!Array.isArray(modules)) return null;
  const el = (tag, text, cls) => node(doc, tag, text, cls);
  const rows = modules.filter(m => m && typeof m === 'object' && typeof m.name === 'string' && m.name);
  const coreBox = el('div', undefined, 'spawn-core-box');
  for (const [layer, label] of [['knowledge', 'Knowledge'], ['messaging', 'Messaging'], ['tasks', 'Tasks']]) {
    const row = el('span', undefined, 'spawn-core-row'), m = rows.find(x => x.layer === layer);
    row.append(el('span', label, 'spawn-core-layer'), m ? el('span', `${m.name}${m.from?.version ? ` ${m.from.version}` : ''}`, 'mono') : el('span', 'None', 'muted')); // an empty slot, not a provider named "none"
    coreBox.append(row);
  }
  const capsList = el('div', undefined, 'spawn-cap-list');
  for (const m of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = el('span', undefined, 'spawn-cap-row'); row.dataset.module = m.name;
    row.append(el('span', m.name, 'mono'), el('span', moduleSourceText(m.from), 'spawn-cap-source'));
    // The reason is plain text in the row: part of what a screen reader reads for it.
    const why = moduleWhyText(m); if (why) row.append(el('span', why, 'spawn-cap-why'));
    capsList.append(row);
  }
  return { core: [el('h3', 'Core capabilities', 'spawn-preview-title'), coreBox], caps: [el('h3', `Capabilities · ${rows.length}`, 'spawn-preview-title'), capsList] };
}

/** The soul chooser (left column). */
function composeChooser(doc, { soul, agents, canChoose, choose, query, note }) {
  const el = (tag, text, cls) => node(doc, tag, text, cls);
  const chooser = el('section', undefined, 'spawn-chooser'); chooser.setAttribute('aria-label', 'Choose a soul');
  const searchLabel = el('label', undefined, 'spawn-search-label'), search = el('input', undefined, 'field spawn-soul-search'), count = el('span', '', 'spawn-search-count');
  search.type = 'search'; search.autocomplete = 'off'; search.placeholder = 'Search souls…'; search.setAttribute('aria-label', 'Search souls to spawn'); search.value = query;
  searchLabel.append(search);
  const head = el('div', undefined, 'spawn-chooser-head'), title = el('h2', 'Souls', 'spawn-chooser-title');
  title.id = 'spawn-chooser-title'; chooser.setAttribute('aria-labelledby', title.id); head.append(title, count);
  const list = el('div', undefined, 'spawn-soul-choices'), empty = el('p', '', 'spawn-chooser-note spawn-chooser-empty'); empty.setAttribute('role', 'status');
  const catalogNote = el('p', note || '', 'spawn-chooser-note spawn-catalog-note');
  chooser.append(head, searchLabel, list, empty, catalogNote);
  const rows = [], groups = new Map();
  for (const candidate of agents) {
    // Grouped by the repository that declares the soul (design frame 02).
    const key = JSON.stringify([candidate.agentsRoot || '', candidate.server || '', candidate.repoName || '']);
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(candidate);
  }
  const groupLabel = first => `${first.repoName || first.server || 'Souls'}${first.server ? ` · ${first.server}` : ''}`;
  const labels = [...groups.values()].map(group => groupLabel(group[0]));
  const rootTags = distinguishingRootTags([...groups.values()].map(group => group[0].agentsRoot).filter(Boolean));
  // Repositories alphabetically; external souls last.
  const ordered = [...groups.values()].sort((a, b) => (a[0].soulKind === 'external') - (b[0].soulKind === 'external') || groupLabel(a[0]).localeCompare(groupLabel(b[0])));
  for (const group of ordered) {
    const first = group[0], groupEl = el('div'), label = groupLabel(first);
    const suffix = labels.filter(value => value === label).length > 1 ? ` · ${rootTags.get(first.agentsRoot) || first.agentsRoot || ''}` : '';
    const heading = el('h3', label + suffix); heading.title = first.agentsRoot || ''; groupEl.append(heading);
    for (const candidate of group) {
      const row = el('button', undefined, 'spawn-choice'); row.type = 'button';
      row.dataset.agent = candidate.name; row.dataset.root = candidate.agentsRoot || ''; row.dataset.server = candidate.server || '';
      row.disabled = !canChoose(candidate); row.tabIndex = -1; row.setAttribute('aria-pressed', String(identity(candidate) === identity(soul)));
      const copy = el('span', undefined, 'spawn-choice-copy');
      copy.append(el('strong', candidate.name), el('small', candidate.work === 'attached' ? 'Attached only — cannot launch standalone' : candidate.description || candidate.repoName || ''));
      const check = iconElement(doc, 'check', { size: 15, className: 'shell-icon spawn-choice-check' }); check.setAttribute('aria-hidden', 'true');
      row.append(createSoulMark(doc, candidate), copy, check);
      row.addEventListener('click', () => { if (!row.disabled && row.isConnected) choose(candidate, search.value); });
      groupEl.append(row);
      rows.push({ row, group: groupEl, text: [candidate.name, candidate.description, candidate.repoName, candidate.team, candidate.server].join('\n').toLowerCase() });
    }
    list.append(groupEl);
  }
  const filter = () => {
    let shown = 0;
    for (const entry of rows) { entry.row.hidden = !entry.text.includes(search.value.toLowerCase()); if (!entry.row.hidden) shown++; }
    for (const group of list.children) group.hidden = !rows.some(entry => entry.group === group && !entry.row.hidden);
    count.textContent = `${shown} of ${rows.length}`;
    empty.textContent = shown ? '' : rows.length ? 'No souls match this filter.' : 'No souls to spawn in this workspace.';
    const visible = rows.filter(entry => !entry.row.hidden && !entry.row.disabled);
    const tabStop = visible.find(entry => entry.row === doc.activeElement) || visible.find(entry => entry.row.getAttribute('aria-pressed') === 'true') || visible[0];
    for (const entry of rows) entry.row.tabIndex = entry === tabStop ? 0 : -1;
  };
  search.addEventListener('input', filter); filter();
  /** The row to land on when the chooser opens: the selected soul if the filter shows it, else the search. */
  const focusTarget = () => rows.find(entry => !entry.row.hidden && !entry.row.disabled && entry.row.getAttribute('aria-pressed') === 'true')?.row || search;
  search.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || event.isComposing || event.keyCode === 229) return;
    const entry = rows.find(item => !item.row.hidden && !item.row.disabled && item.row.tabIndex === 0);
    if (entry) { event.preventDefault(); event.stopPropagation(); entry.row.focus(); }
  });
  list.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.isComposing) return;
    const visible = rows.filter(entry => !entry.row.hidden && !entry.row.disabled).map(entry => entry.row), at = visible.indexOf(doc.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    event.preventDefault(); event.stopPropagation();
    for (const row of visible) row.tabIndex = row === visible[next] ? 0 : -1;
    visible[next]?.focus();
  });
  return { chooser, search, focusTarget };
}

/**
 * @param modal  the .spawn-modal element (backdrop); the dialog is built inside it.
 * @param opts   ctx, soul, agents, workspace(), cli(), instances(), servers (Promise|array),
 *               canChoose(soul), choose(soul, draft), close(), owns(), draft,
 *               layout 'picker' (chooser + form; the default) | 'scoped' (preview + form, one soul),
 *               onCreated(view, isCurrent) — local creation handoff,
 *               remoteSpawn(fields) — execution-server spawn (unguarded route).
 */
export function createSpawnDialog(modal, { ctx, soul, agents, workspace, cli, instances, canChoose, choose, close, owns,
  draft = {}, catalogNote = '', onCreated = async () => {}, remoteSpawn = async () => {}, servers = [], delay: debounce = PREVIEW_DEBOUNCE_MS, layout = 'picker' }) {
  const doc = modal.ownerDocument, el = (tag, text, cls) => node(doc, tag, text, cls);
  const titleId = 'spawn-dialog-title';
  const dialog = el('section', undefined, 'spawn-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', titleId);
  // ── header: one h2 (the dialog's name) whose words follow the layout
  const header = el('div', undefined, 'spawn-dialog-head');
  const mark = createSoulMark(doc, soul); mark.classList.add('spawn-head-mark');
  const headCopy = el('div', undefined, 'spawn-head-copy');
  const title = el('h2'); title.id = titleId;
  const workspaceName = () => workspace()?.name || workspace()?.id || soul.repoName || 'this workspace';
  const context = el('span', '', 'spawn-context');
  headCopy.append(title, context);
  const changeSoul = el('button', 'Change soul', 'spawn-change-soul'); changeSoul.type = 'button';
  const closeButton = el('button', undefined, 'close-act fcancel-x'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close spawn dialog');
  closeButton.append(iconElement(doc, 'close', { size: 14 }));
  header.append(mark, headCopy, changeSoul, closeButton);
  // ── chooser (picker layout)
  const { chooser, search, focusTarget } = composeChooser(doc, { soul, agents, canChoose, query: draft.query || '', note: catalogNote,
    choose: (candidate, query) => { if (!busy()) choose(candidate, { query, purpose: purpose.value, task: task.value, prefixed: prefixed.checked, layout: 'picker' }); } });
  // ── preview (scoped layout): what the kernel will create, from the latest observation
  const preview = el('aside', undefined, 'spawn-preview'); preview.setAttribute('aria-label', 'Spawn preview');
  const factsSection = el('section', undefined, 'spawn-preview-section spawn-preview-created');
  const factsBody = el('div', undefined, 'spawn-preview-body');
  factsSection.append(el('h3', 'What will be created', 'spawn-preview-title'), factsBody);
  // Core capabilities / Capabilities: filled only when the preview carries `modules`; otherwise empty and hidden.
  const coreSection = el('section', undefined, 'spawn-preview-section spawn-preview-core'), capsSection = el('section', undefined, 'spawn-preview-section spawn-preview-caps');
  coreSection.hidden = capsSection.hidden = true;
  const previewNote = el('p', 'Resolved by the installed CLI. Spawn refuses if this changes before you confirm.', 'spawn-preview-note');
  preview.append(factsSection, coreSection, capsSection, previewNote);
  // ── form
  const form = el('div', undefined, 'spawn-form');
  const selectionSummary = el('span', `Selected soul ${soul.name}${soul.server ? ` on ${soul.server}` : ''}`, 'workspace-sr-only');
  selectionSummary.id = 'spawn-selection-summary'; dialog.setAttribute('aria-describedby', selectionSummary.id);
  // Name
  const nameField = el('div', undefined, 'spawn-field spawn-name');
  const nameLabel = el('label', 'Name'); nameLabel.htmlFor = 'spawn-purpose';
  // Prefix toggle: on = --purpose <typed> (named <soul>-<typed>); off = --name <typed>
  // (exact). Offered only where the CLI advertises spawn-name.
  const prefixLabel = el('label', undefined, 'spawn-switch spawn-prefix-toggle'), prefixed = el('input', undefined, 'fprefix');
  prefixed.type = 'checkbox'; prefixed.setAttribute('role', 'switch'); prefixed.checked = draft.prefixed !== false;
  prefixLabel.append(prefixed, doc.createTextNode('Prefix with the soul name'));
  prefixLabel.hidden = !cli()?.features?.includes('spawn-name');
  const nameHead = el('div', undefined, 'spawn-name-head'); nameHead.append(nameLabel, prefixLabel);
  const nameInput = el('div', undefined, 'spawn-name-input');
  const prefix = el('span', `${soul.name}-`, 'spawn-name-prefix'); prefix.setAttribute('aria-hidden', 'true'); prefix.title = `${soul.name}-`;
  const purpose = el('input', undefined, 'field fpurpose'); purpose.id = 'spawn-purpose'; purpose.autocomplete = 'off'; purpose.spellcheck = false;
  purpose.placeholder = 'purpose, e.g. api-v2'; purpose.value = draft.purpose || '';
  purpose.setAttribute('aria-describedby', 'spawn-name-result');
  nameInput.append(prefix, purpose);
  const nameResult = el('p', '', 'spawn-hint spawn-name-result'); nameResult.id = 'spawn-name-result'; nameResult.setAttribute('aria-live', 'polite');
  nameField.append(nameHead, nameInput, nameResult);
  // Harness · Model — the harness is a picker with its badge; the select holds the value.
  const runRow = el('div', undefined, 'spawn-row spawn-run');
  const runtimeLabel = el('label'); runtimeLabel.append(el('span', 'Harness', 'spawn-label-text'));
  const runtime = el('select', undefined, 'field fruntime'); runtime.hidden = true; runtime.tabIndex = -1; runtime.setAttribute('aria-hidden', 'true');
  runtimeLabel.append(runtime);
  const modelLabel = el('label'); modelLabel.append(el('span', 'Model', 'spawn-label-text'));
  const modelControls = el('div', undefined, 'spawn-model-controls'), modelField = el('span', undefined, 'spawn-model-field');
  const model = el('input', undefined, 'field fmodel'); model.autocomplete = 'off'; model.spellcheck = false; model.setAttribute('aria-label', 'Model — empty uses the default');
  const modelTag = el('span', '', 'spawn-input-tag'); modelTag.setAttribute('aria-hidden', 'true');
  // The default shows as a value (not placeholder grey) until the operator types a model.
  const modelDefault = el('span', '', 'spawn-model-default'); modelDefault.setAttribute('aria-hidden', 'true');
  modelField.append(model, modelDefault, modelTag); modelControls.append(modelField); modelLabel.append(modelControls);
  runRow.append(runtimeLabel, modelLabel);
  const runHint = el('p', '', 'spawn-hint spawn-run-hint'); runHint.setAttribute('aria-live', 'polite');
  const runField = el('div', undefined, 'spawn-field'); runField.append(runRow, runHint);
  // Work — read from the soul; a worktree gets the joined "from base | branch" control.
  const workField = el('div', undefined, 'spawn-field spawn-work');
  const workLabel = el('span', undefined, 'spawn-label'); workLabel.append(iconElement(doc, 'branch', { size: 13 }), doc.createTextNode('Work'));
  const workText_ = el('p', '', 'spawn-work-text'); workText_.setAttribute('aria-live', 'polite');
  const joined = el('div', undefined, 'spawn-joined');
  const from = el('span', 'from', 'spawn-joined-from');
  const base = el('input', undefined, 'field fbase'); base.autocomplete = 'off'; base.spellcheck = false; base.setAttribute('aria-label', 'Base the new branch starts from');
  from.append(base);
  const branch = el('input', undefined, 'field fbranch'); branch.autocomplete = 'off'; branch.spellcheck = false; branch.setAttribute('aria-label', 'New branch');
  joined.append(from, branch);
  const worktreePath = el('p', '', 'spawn-hint spawn-worktree-path');
  const worktreeLabel = el('label', undefined, 'spawn-switch spawn-use-worktree'), worktree = el('input', undefined, 'fworktree');
  worktree.type = 'checkbox'; worktree.setAttribute('role', 'switch');
  worktreeLabel.append(worktree, doc.createTextNode('Use a worktree instead'));
  worktreeLabel.hidden = soul.work !== 'checkout';
  workField.append(workLabel, workText_, joined, worktreePath, worktreeLabel);
  // Relationship — shown by default.
  const relation = el('fieldset', undefined, 'spawn-field spawn-relationship');
  relation.append(el('legend', 'Relationship'));
  const relRow = el('div', undefined, 'spawn-relationship-row'), seg = el('div', undefined, 'spawn-seg frelation'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Relationship');
  for (const [value, label] of [['unrelated', 'Independent'], ['child', 'Child of'], ['sibling', 'Sibling of'], ['parent', 'Parent of']]) {
    const option = el('label'), input = el('input'); input.type = 'radio'; input.name = `spawn-relation-${Math.floor(workspaceGeneration())}`; input.value = value; input.checked = value === 'unrelated';
    option.append(input, el('span', label)); seg.append(option);
  }
  const rel = { get value() { return seg.querySelector('input:checked')?.value || 'unrelated'; } };
  const relTo = el('select', undefined, 'field frelto'); relTo.setAttribute('aria-label', 'Which instance');
  relRow.append(seg, relTo);
  const relDesc = el('p', '', 'spawn-hint freldesc'); relDesc.setAttribute('aria-live', 'polite');
  relation.append(relRow, relDesc);
  // Opening instruction
  const taskLabel = el('label', undefined, 'spawn-field');
  const taskTitle = el('span', 'Opening instruction ', 'spawn-label'); taskTitle.append(el('small', '· optional')); taskLabel.append(taskTitle);
  const task = el('textarea', undefined, 'field ftask'); task.rows = 4; task.placeholder = 'What should this instance do? Empty starts it waiting for you.'; task.value = draft.task || '';
  taskLabel.append(task);
  // Developer settings (collapsed)
  const advanced = el('details', undefined, 'spawn-advanced');
  const advancedSummary = el('summary', 'Developer settings'), advancedTopics = el('small', 'Work area · permissions · launch · session · wake-up');
  advancedSummary.append(advancedTopics);
  advanced.append(advancedSummary);
  const advancedBody = el('div', undefined, 'spawn-advanced-body'); advanced.append(advancedBody);
  const permRow = el('div', undefined, 'spawn-row');
  const yoloLabel = el('label', 'Permissions'), yolo = el('select', undefined, 'field fyolo'); yoloLabel.append(yolo);
  const configLabel = el('label', 'Launch configuration'), config = el('select', undefined, 'field flaunch'); configLabel.append(config);
  permRow.append(yoloLabel, configLabel);
  // Messaging identity (decision 27): offered when the CLI takes provider
  // payloads and the preview reports the soul's messaging provider.
  const identityField = el('div', undefined, 'spawn-field spawn-identity'); identityField.hidden = true;
  const identityRow = el('div', undefined, 'spawn-row');
  const identityLabel = el('label', 'Messaging identity'), identity = el('select', undefined, 'field fidentity');
  for (const [value, label] of [['', 'Default'], ['local', 'Local — its own team identity'], ['global', 'Global — act as a resident']]) { const o = el('option', label); o.value = value; identity.append(o); }
  identityLabel.append(identity);
  const residentLabel = el('label', 'Resident'), resident = el('input', undefined, 'field fresident');
  resident.autocomplete = 'off'; resident.spellcheck = false; resident.placeholder = 'resident name, e.g. ops'; residentLabel.append(resident); residentLabel.hidden = true;
  identityRow.append(identityLabel, residentLabel);
  const identityHint = el('p', '', 'spawn-hint spawn-identity-hint'); identityHint.setAttribute('aria-live', 'polite');
  identityField.append(identityRow, identityHint);
  let messagingProvider = null; // the capability the latest preview reported on layer messaging
  // Teams: offered only when the provider declares the spawn setting `join`; the
  // list is the kernel's, never computed here. Team model v2 (0.30): the default
  // row (`default: true`) is fixed; every other mapped row is an unchecked box
  // (opt-in, sent as join=); a shared team with no provider id yet is shown, disabled.
  // 0.29 rows carry no `default`: a fixed "Default" chip, then the mapped rows.
  const teamsField = el('fieldset', undefined, 'spawn-field spawn-teams'); teamsField.hidden = true;
  const teamsList = el('div', undefined, 'spawn-seg spawn-teams-row spawn-team-list'); teamsList.setAttribute('role', 'group'); teamsList.setAttribute('aria-label', 'Teams');
  const teamsHint = el('p', '', 'spawn-hint spawn-teams-hint'); teamsHint.setAttribute('aria-live', 'polite');
  const teamsError = el('p', '', 'spawn-hint spawn-teams-error err'); teamsError.setAttribute('aria-live', 'polite');
  teamsField.append(el('legend', 'Teams'), teamsList, teamsHint, teamsError);
  let teamsNow = null, joinDeclaredNow = false, teamsDrawn = '', defaultFromNow = null;
  const joinPicked = new Set();
  // A team the operator may opt into: mapped, and not the soul's default (v2 rows say `default`).
  const joinable = t => t.mapped && t.default !== true;
  teamsList.addEventListener('change', event => {
    const box = event.target;
    if (box?.type !== 'checkbox' || !box.value || box.disabled) return;
    if (box.checked) joinPicked.add(box.value); else joinPicked.delete(box.value);
  }); // before the form's own change listener: the choice is current when it re-reads
  function drawTeams() {
    const key = JSON.stringify([teamsNow, defaultFromNow]);
    if (key === teamsDrawn) return;
    teamsDrawn = key; teamsList.replaceChildren();
    const chip = (cls, name, box, title) => { const c = el('label', undefined, cls); c.append(box, el('span', name, 'spawn-team-name')); c.title = title; teamsList.append(c); return c; };
    const rows = teamsNow || [], home = rows.find(t => t.default === true);
    const fixed = el('input'); fixed.type = 'checkbox'; fixed.checked = true; fixed.disabled = true;
    if (home) {
      const c = chip('spawn-team spawn-team-fixed', `${home.label} · default`, fixed, home.team
        ? `The default team (${home.team}): every instance of ${soul.name} is in it and can't leave it.`
        : `The default team ${home.label} has no provider id yet.`);
      c.dataset.team = home.label; if (!home.team) c.classList.add('spawn-team-blocked');
    } else chip('spawn-team spawn-team-fixed', 'Default', fixed, "The workspace's default team — always. Every instance is in it.");
    // Blocked: nothing to join into, so no opt-ins.
    for (const t of home && !home.team ? [] : rows.filter(t => t.default !== true && (t.mapped || t.default === false))) {
      const box = el('input'); box.type = 'checkbox'; box.value = t.label; box.className = 'fteam';
      box.checked = t.mapped && joinPicked.has(t.label); box.disabled = !t.mapped;
      const c = chip(`spawn-team${t.mapped ? '' : ' spawn-team-off'}`, t.label, box, t.mapped ? `Join ${t.label} (${t.team})` : `${t.label} has no provider id yet: its owner runs oats aweb setup, then commits the id.`);
      c.dataset.team = t.label;
    }
    const open = rows.filter(joinable).length;
    // An unmapped default blocks the spawn (the kernel refuses it): say so and what to do, not the opt-ins.
    teamsHint.classList.toggle('err', !!home && !home.team);
    teamsHint.textContent = home && !home.team
      ? `The default team ${home.label} has no provider id yet, so ${soul.name} can't be spawned here. Its owner runs oats aweb setup, then commits the id; or choose another default ${defaultFromNow === 'soul' ? `for ${soul.name} on its page (Teams here)` : 'in Workspace › Teams'}.`
      : home
      ? (open ? `It joins its default team, ${home.label}. Tick any other team it should also join.` : `It joins its default team, ${home.label}. No other team is open to ${soul.name} on this computer.`)
      : `By default it's only in the workspace's default team. These are the teams ${soul.name} has access to — tick the ones it should also join.`;
  }
  const hostRow = el('div', undefined, 'spawn-row');
  const backendLabel = el('label', 'Session backend'), backend = el('select', undefined, 'field fbackend'); backendLabel.append(backend);
  const serverLabel = el('label', 'Run on'), server = el('select', undefined, 'field fserver'); server.setAttribute('aria-label', 'Execution server'); serverLabel.append(server);
  hostRow.append(backendLabel, serverLabel);
  const wake = wakeScheduleFields(doc);
  advancedBody.append(workField, permRow, identityField, hostRow, wake.el);
  // Footer
  const footer = el('div', undefined, 'spawn-footer');
  const statusRow = el('div', undefined, 'spawn-status');
  const status = el('p', '', 'fstatus'); status.setAttribute('role', 'status');
  const detailsToggle = el('button', 'Details', 'spawn-details-toggle'); detailsToggle.type = 'button'; detailsToggle.hidden = true;
  const details = el('p', '', 'spawn-problem-detail'); details.id = 'spawn-problem-detail'; details.hidden = true;
  detailsToggle.setAttribute('aria-controls', details.id); detailsToggle.setAttribute('aria-expanded', 'false');
  detailsToggle.addEventListener('click', () => {
    details.hidden = !details.hidden; detailsToggle.setAttribute('aria-expanded', String(!details.hidden));
    detailsToggle.textContent = details.hidden ? 'Details' : 'Hide details';
  });
  statusRow.append(status, detailsToggle);
  const cancel = el('button', 'Cancel', 'act fcancel'); cancel.type = 'button';
  const spawn = el('button', 'Spawn', 'act fspawn primary'); spawn.type = 'button';
  footer.append(statusRow, cancel, spawn, details);
  const body = el('div', undefined, 'spawn-form-body');
  body.append(selectionSummary, nameField, runField, relation, teamsField, taskLabel, advanced);
  form.append(body, footer); // the footer stays in view while the body scrolls
  const columns = el('div', undefined, 'spawn-columns'); columns.append(preview, chooser, form);
  dialog.append(header, columns); modal.append(dialog);
  let layoutNow = 'picker';
  /** Switch layout in place: the other column goes under [hidden]; every typed value stays. */
  function setLayout(name) {
    layoutNow = name === 'scoped' ? 'scoped' : 'picker';
    const scoped = layoutNow === 'scoped';
    dialog.dataset.layout = layoutNow;
    chooser.hidden = scoped; preview.hidden = !scoped; mark.hidden = !scoped; changeSoul.hidden = !scoped;
    title.textContent = scoped ? `Spawn ${soul.name}` : 'Spawn instance';
    context.textContent = scoped ? [soulOriginText(soul), `in ${workspaceName()}`].filter(Boolean).join(' · ') : `in ${workspaceName()}`;
    context.title = context.textContent;
    if (scoped) renderPreview();
  }

  // ── static options
  const c0 = cli();
  const runtimes = Array.isArray(c0?.harnesses) ? c0.harnesses.filter(v => Object.hasOwn(RUNTIME_NAMES, v)) : [];
  const fillSelect = (select, rows) => { select.replaceChildren(); for (const [value, label, disabled] of rows) { const o = el('option', label); o.value = value; o.disabled = !!disabled; select.append(o); } };
  fillSelect(runtime, [['', 'Default'], ...runtimes.map(v => [v, RUNTIME_NAMES[v]])]);
  const yoloSupported = Array.isArray(c0?.launchOptions) && c0.launchOptions.includes('yolo');
  fillSelect(yolo, [['', 'Default'], ['false', "Ask — harness's policy", !yoloSupported], ['true', 'Skip prompts (YOLO)', !yoloSupported]]);
  const backends = Array.isArray(c0?.sessionBackends) ? c0.sessionBackends.filter(v => ['tmux', 'herdr'].includes(v)) : [];
  fillSelect(backend, [['', 'Default'], ...backends.map(v => [v, v === 'herdr' ? 'Herdr' : 'tmux'])]);
  fillSelect(config, [['', 'Default']]);
  fillSelect(server, [['', 'This machine']]);
  if (soul.server) { fillSelect(server, [[soul.server, soul.repoName || soul.server]]); server.value = soul.server; server.disabled = true; }
  const rows = instances() || [];
  const counts = new Map(); for (const i of rows) counts.set(i.instance, (counts.get(i.instance) || 0) + 1);
  const tags = distinguishingRootTags(rows.filter(i => counts.get(i.instance) > 1).map(i => i.agentsRoot));
  fillSelect(relTo, [['', '— which instance? —']]);
  for (const i of rows) {
    const o = el('option', `${i.instance}${counts.get(i.instance) > 1 && i.agentsRoot ? ` [${tags.get(String(i.agentsRoot)) || i.agentsRoot}]` : ''}${i.running === true ? '' : ' (stopped)'}`);
    o.value = i.instance; o.dataset.root = i.agentsRoot || ''; relTo.append(o);
  }

  // ── state
  let alive = true, mount = workspaceGeneration(), serial = 0, timer = null, reading = null, shown = null, nativeModel = false;
  let flight = null, phase = 'idle', intent = null, submitted = false, delivered = false, modelsReq = 0, configsReq = 0, remoteBusy = false, modelsFor = null;
  let notice = null; // a refusal from the last Spawn stays visible until the operator edits
  const current = () => alive && owns() && mount === workspaceGeneration();
  const remoteTarget = () => soul.server || server.value || '';
  const local = () => !remoteTarget() && !workspace()?.remote && !workspace()?.server;
  // The server admits the workspace against its own registry (absolute scope, local); /api/panel carries only the id.
  const previewable = () => local() && previewSupported(cli()) && !!workspace()?.id && soul.work !== 'attached';
  const applicable = () => previewable() && spawnApplySupported(cli()) && !soul.captured;
  const busy = () => !!flight || remoteBusy;
  const effectiveWork = () => worktree.checked && soul.work === 'checkout' ? 'worktree' : soul.work;
  const identityOffered = () => local() && !!messagingProvider && !!cli()?.features?.includes('spawn-provider-payload');
  // The row shows the teams the soul has access to: a joinable one, or (v2) its default; with neither, no row.
  // Gate (teams contract bdd7e55e): feature settings-declared, and the messaging row declares `join`.
  const teamsOffered = () => identityOffered() && !!cli()?.features?.includes('settings-declared') && joinDeclaredNow && Array.isArray(teamsNow) && teamsNow.some(t => joinable(t) || t.default === true);
  // What the operator ticked, in the kernel's order, joinable labels only (never the default).
  const joinLabels = () => teamsOffered() ? teamsNow.filter(t => joinable(t) && joinPicked.has(t.label)).map(t => t.label) : [];
  // The preview for these choices must bind exactly the ticked teams (settings echo).
  const joinBound = data => { const labels = joinLabels(); return !labels.length || data?.messaging?.join === labels.join(','); };
  const selector = { soul: soul.name, agentsRoot: soul.agentsRoot };
  /** The facts a preview depends on from outside the form: the CLI (identity and features), the
   * workspace and the relation anchor's roster rows. sync() re-reads only when one changed: the
   * roster polls every few seconds, and a routine poll must never supersede a read in flight
   * (a preview slower than the poll would otherwise never settle). */
  const factsKey = () => {
    const c = cli(), w = workspace(), anchor = rel.value === 'unrelated' ? null : relTo.value;
    return JSON.stringify([c?.ok ?? null, c?.bin ?? null, c?.version ?? null, c?.spawnPreviewApi ?? null, c?.spawnApplyApi ?? null, c?.features ?? null,
      w?.id ?? null, w?.remote ?? null, w?.server ?? null,
      anchor === null ? null : (instances() || []).filter(i => i.instance === anchor).map(i => [i.instance, i.agent, i.agentsRoot, i.home ?? null, i.remote ?? null, i.server ?? null])]);
  };
  let factsSeen = factsKey();

  function relationChoice() {
    if (rel.value === 'unrelated') return { kind: 'unrelated' };
    const name = relTo.value, root = relTo.selectedOptions[0]?.dataset.root;
    const matches = (instances() || []).filter(i => i.instance === name && i.agentsRoot === root && !i.remote && !i.server);
    if (matches.length !== 1) return null;
    const a = matches[0];
    return { kind: rel.value, anchor: { instance: a.instance, agent: a.agent, agentsRoot: a.agentsRoot, server: null } };
  }
  /** The choices the fields express, or { error } for one the operator must fix. */
  function choices() {
    const p = purpose.value.trim();
    if (p && !PURPOSE.test(p)) return { error: 'Use letters, digits and dashes in the name (start with a letter or digit).', field: 'name' };
    const exact = !prefixLabel.hidden && !prefixed.checked;
    // The final name is what the kernel caps (#159): the exact name, or <soul>-<purpose>.
    if (p && (exact ? p.length : soul.name.length + 1 + p.length) > INSTANCE_NAME_MAX) {
      return { error: `Instance names are at most ${INSTANCE_NAME_MAX} characters. Shorten the name.`, field: 'name' };
    }
    const relationValue = relationChoice();
    if (!relationValue) return { error: `Pick the instance this one is a ${rel.value} of.`, field: 'relation' };
    if (exact && !p) return { error: 'Type the instance name, or turn the soul-name prefix back on.', field: 'name' };
    const identityChoice = identityOffered() && identity.value ? identity.value === 'local' ? { provider: messagingProvider, mode: 'local' }
      : { provider: messagingProvider, mode: 'global', resident: resident.value.trim() } : null;
    if (identityChoice?.mode === 'global' && !identityChoice.resident) return { error: 'Type the resident this instance acts as.', field: 'identity' };
    const out = { ...(p ? exact ? { name: p } : { purpose: p } : {}), ...(soul.work === 'checkout' && worktree.checked ? { work: 'worktree' } : {}),
      ...(effectiveWork() === 'worktree' && branch.value.trim() ? { branch: branch.value.trim() } : {}),
      ...(effectiveWork() === 'worktree' && base.value.trim() ? { base: base.value.trim() } : {}),
      ...(runtime.value ? { harness: runtime.value } : {}), ...(config.value ? { launchConfig: config.value } : {}),
      ...(backend.value ? { backend: backend.value } : {}), ...(yolo.value ? { yolo: yolo.value === 'true' } : {}),
      model: nativeModel ? { kind: 'native-default' } : model.value.trim() ? { kind: 'custom', value: model.value.trim() } : { kind: 'inherit' },
      relation: relationValue, ...(identityChoice ? { identity: identityChoice } : {}),
      ...(joinLabels().length ? { join: { provider: messagingProvider, labels: joinLabels() } } : {}) };
    const valid = previewChoices(out);
    return valid ? { value: valid } : { error: 'A value here is not a valid spawn option (no spaces or leading dashes).', field: 'option' };
  }
  const choiceKey = value => JSON.stringify(value);
  /** The kernel's preview for exactly the choices on screen, else null: a hint that reads from it
   * (the default harness and model, "Launches … with …") must not describe a previous choice while a
   * new preview is due or in flight (desktop/loading-states item 9), like the name and work hints. */
  const matched = () => shown?.data && shown.key === choiceKey(choices().value) ? shown.data : null;

  // ── rendering from the latest observation
  function render() {
    if (!alive) return;
    const data = shown?.data, draftChoice = choices();
    const typed = purpose.value.trim();
    // Name: what was typed, then the kernel's decision.
    const exact = !prefixLabel.hidden && !prefixed.checked;
    nameInput.classList.toggle('unprefixed', exact);
    purpose.placeholder = exact ? 'instance name, e.g. release-bot' : 'purpose, e.g. api-v2';
    // The kernel's name refusals belong next to the field, not only in the footer.
    const nameRefusal = shown?.failure && shown.key === choiceKey(draftChoice.value) && ['E_INSTANCE_NAME_INVALID', 'E_INSTANCE_NAME_TAKEN'].includes(shown.failure.code) ? shown.failure : null;
    nameResult.classList.toggle('err', !!(draftChoice.error && draftChoice.field === 'name' || nameRefusal));
    if (draftChoice.error && draftChoice.field === 'name') nameResult.textContent = draftChoice.error;
    else if (nameRefusal) nameResult.textContent = spawnProblem(nameRefusal).text;
    else if (!local()) nameResult.textContent = `Named by ${remoteTarget()} when it spawns.`;
    else {
      nameResult.replaceChildren();
      const fresh = data && shown.key === choiceKey(draftChoice.value);
      const name = fresh ? data.instance : typed ? exact ? typed : `${soul.name}-${typed}` : '';
      if (name) { nameResult.append('Instance name: '); nameResult.append(el('strong', name)); }
      else if (!fresh) nameResult.append('Instance name: numbered by the kernel');
      if (fresh && typed && !exact && data.instance !== `${soul.name}-${typed.toLowerCase()}`) nameResult.append(' — that name is taken, so the kernel numbered it');
    }
    // Runtime / model defaults: from the preview for these very choices only.
    const now = matched();
    const defaultRuntime = now && !runtime.value ? ` · ${runtimeName(now.harness)}` : '';
    runtime.options[0].textContent = `Default${defaultRuntime}`;
    const shownRuntime = runtimeName(runtime.value || now?.harness || '');
    const defaultModel = !now ? '' : nativeModel || now.model === null ? `${shownRuntime}'s default model` : now.model;
    model.placeholder = ' '; // :placeholder-shown drives the default overlay
    modelDefault.textContent = model.value ? '' : defaultModel;
    modelTag.textContent = model.value || !now ? '' : nativeModel || now.modelSource === 'explicit' ? 'chosen' : 'default';
    modelTag.title = now?.modelSource || '';
    model.setAttribute('aria-label', model.value ? 'Model' : `Model — empty uses ${defaultModel || 'the default'}`);
    syncRuntime(now);
    runHint.textContent = !local() ? `Harness and model defaults are decided on ${remoteTarget()}.` : launchHint(now, cli()) ?? (now ? `Launches ${runtimeName(now.harness)} with ${modelText(now)}.` : '');
    // Work.
    worktreeLabel.hidden = soul.work !== 'checkout';
    const worktreeMode = effectiveWork() === 'worktree' && local();
    const work = workText(data && shown.key === choiceKey(draftChoice.value) ? data : null, effectiveWork());
    workText_.replaceChildren();
    if (!worktreeMode) { workText_.append(work.lead); if (work.code) workText_.append(el('code', work.code)); if (work.tail) workText_.append(work.tail); }
    joined.hidden = !worktreeMode;
    worktreePath.replaceChildren(); worktreePath.hidden = !worktreeMode || !data?.worktree;
    if (worktreeMode && data?.worktree) {
      // Shown relative to the deployment the kernel reported; the full path is the tooltip.
      const dir = data.subject?.dir, shownPath = dir && data.worktree.startsWith(`${dir}/`) ? data.worktree.slice(dir.length + 1) : data.worktree;
      worktreePath.append('Worktree at '); const code = el('code', shownPath); code.title = data.worktree; worktreePath.append(code);
    }
    // Advanced defaults.
    yolo.options[0].textContent = data ? `Default · ${permissionText(data.yolo)}` : 'Default';
    backend.options[0].textContent = data ? `Default · ${data.backend === 'herdr' ? 'Herdr' : data.backend}` : 'Default';
    config.options[0].textContent = data?.launchConfig ? `Default · ${data.launchConfig}` : 'Default';
    branch.placeholder = data?.branch && !branch.value ? data.branch : `agents/${soul.name}-…`;
    base.placeholder = data?.base ? `${data.base.ref} · ${short(data.base.oid)}` : 'HEAD';
    // Messaging identity: what the kernel bound for this spawn, and the choice.
    if (data) { messagingProvider = data.messaging?.provider ?? null; teamsNow = data.teams ?? null; joinDeclaredNow = data.messaging?.joinDeclared === true; defaultFromNow = data.defaultTeam?.from ?? null; }
    // An unmapped default blocks the spawn even where joins are not offered (no provider declares
    // `join`): the row then shows the default and why, so a disabled Spawn never goes unexplained.
    teamsField.hidden = !teamsOffered() && !defaultBlocked();
    if (!teamsField.hidden) drawTeams();
    if (teamsOffered()) {
      teamsError.textContent = data && shown?.key === choiceKey(draftChoice.value) && !joinBound(data)
        ? "The kernel didn't bind the ticked teams. Spawn waits until it does." : '';
    }
    identityField.hidden = !identityOffered();
    residentLabel.hidden = identity.value !== 'global';
    advancedTopics.textContent = `Work area · permissions${identityOffered() ? ' · identity' : ''} · launch · session · wake-up`;
    if (identityOffered()) {
      const origins = !!cli()?.features?.includes('settings-origins');
      identity.options[0].textContent = identityDefaultLabel(data, identity.value, origins);
      identityHint.classList.toggle('err', draftChoice.field === 'identity');
      identityHint.textContent = draftChoice.field === 'identity' ? draftChoice.error : !data || !data.messaging ? '' : identityHintText(data.messaging, origins);
    }
    const related = rel.value !== 'unrelated';
    relTo.hidden = !related; relTo.disabled = !related; relTo.setAttribute('aria-label', related ? `${rel.value[0].toUpperCase()}${rel.value.slice(1)} of which instance?` : 'Which instance');
    relDesc.textContent = !related ? 'Independent — not linked to another instance.' : relTo.value ? `Spawns as a ${rel.value} of ${relTo.value}.` : `Pick the instance this one is a ${rel.value} of.`;
    if (layoutNow === 'scoped') renderPreview();
    syncButton();
  }
  /** What the preview column shows for the choices on screen: the kernel's data for exactly these
   * choices, its refusal, the loading shape while a read is due or in flight, or why there is none. */
  function previewState() {
    const draftChoice = choices(), key = choiceKey(draftChoice.value);
    if (!local()) return { kind: 'empty', text: `Decided on ${remoteTarget()} when it spawns.` };
    if (shown && shown.key === key) {
      if (shown.data) return { kind: 'data', data: shown.data, key };
      // A name refusal is already said next to the Name field.
      if (NAME_REFUSALS.includes(shown.failure.code)) return { kind: 'empty', text: 'No preview until the name is accepted.' };
      return { kind: 'failure', text: spawnProblem(shown.failure, 'preview').text };
    }
    if (timer || reading) return { kind: 'reading' };
    if (draftChoice.error) return { kind: 'empty', text: 'The preview reads once the form is valid.' };
    if (!previewable()) return { kind: 'empty', text: soul.work === 'attached' ? 'Attached souls are started by the instance they attach to.' : 'The installed CLI can’t preview this spawn.' };
    return { kind: 'reading' };
  }
  let previewDrawn = '';
  function renderPreview() {
    const state = previewState(), data = state.data;
    // The whole (bounded) projection: a re-read for the same choices may answer different facts.
    const signature = state.kind === 'data' ? `data:${state.key}:${JSON.stringify(data)}` : `${state.kind}:${state.text || ''}`;
    preview.setAttribute('aria-busy', String(state.kind === 'reading'));
    if (signature === previewDrawn) return;
    previewDrawn = signature; factsBody.replaceChildren();
    if (state.kind === 'reading') {
      const skeleton = el('div', undefined, 'spawn-preview-skeleton'); skeleton.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 4; i++) skeleton.append(el('span'), el('span'));
      factsBody.append(skeleton, el('p', 'Reading the preview…', 'workspace-sr-only spawn-preview-reading'));
    } else if (state.kind === 'failure') factsBody.append(el('p', state.text, 'spawn-preview-failure'));
    else if (state.kind === 'empty') factsBody.append(el('p', state.text, 'spawn-preview-empty'));
    else {
      const facts = el('dl', undefined, 'spawn-preview-facts');
      const fact = (label, ...value) => { const dd = el('dd'); dd.append(...value); facts.append(el('dt', label), dd); };
      const muted = text => el('span', text, 'muted');
      fact('Name', el('span', data.instance, 'mono'));
      if (data.work) fact('Works in', worksInText(data.work));
      if (data.harness) {
        // Where the harness came from: the Launch's `from` in words (0.30), else the kernel's modelSource verbatim.
        const launch = shownLaunch(data.launch, cli());
        const from = launch ? launchFromText(launch.from) : data.modelSource;
        const harness = el('span', undefined, 'spawn-preview-harness');
        // The badge is decorative here: the term says Harness and the text names it.
        const badge = createRuntimeBadge(doc, data.harness); badge.setAttribute('aria-hidden', 'true');
        harness.append(badge, doc.createTextNode(`${runtimeName(data.harness)}${from ? ` · ${from}` : ''}`));
        fact('Harness', harness);
      }
      // Team model v2: the default the kernel resolved (or none). A 0.29 kernel reports only `team`, the primary label.
      if (data.defaultTeam) fact('Team', doc.createTextNode(`${data.defaultTeam.label} `), muted('(default)'));
      else if (data.defaultTeam === null && !(data.teams?.length)) fact('Team', muted('none'));
      else if (data.defaultTeam === undefined && typeof data.team === 'string' && data.team) fact('Team', data.team);
      factsBody.append(facts);
    }
    // Core capabilities and Capabilities exist only when the preview carries `modules`.
    const sections = state.kind === 'data' ? composePreviewModules(doc, data.modules) : null;
    coreSection.hidden = capsSection.hidden = !sections;
    coreSection.replaceChildren(...(sections?.core ?? [])); capsSection.replaceChildren(...(sections?.caps ?? []));
  }
  /** The default team has no provider id yet: the spawn is refused (team model v2, the lead's ruling). */
  const defaultBlocked = () => (teamsNow || []).some(t => t.default === true && !t.team);
  function syncButton() {
    if (!alive) return;
    const draftChoice = choices(), ready = local() ? !!shown?.data && shown.key === choiceKey(draftChoice.value) && !reading && joinBound(shown.data) : true;
    spawn.textContent = flight ? (phase === 'checking' ? 'Checking…' : 'Spawning…')
      : ['unknown', 'pending'].includes(phase) ? 'Check result' : ['complete', 'partial'].includes(phase) ? 'Created' : phase === 'incomplete' ? 'Spawn incomplete' : 'Spawn';
    const recovering = ['unknown', 'pending'].includes(phase);
    spawn.disabled = !current() || busy() || ['complete', 'partial', 'incomplete'].includes(phase)
      || !recovering && (!!draftChoice.error || defaultBlocked() || (local() ? !applicable() || !ready : false));
  }
  /** A problem shows one plain sentence; its code and technical text wait behind Details. */
  function setStatus(text, error = false, problem = null, ok = false) {
    if (status.textContent !== text) status.textContent = text; // an unchanged status is not re-announced
    status.classList.toggle('err', error); status.classList.toggle('ok', ok && !error);
    status.dataset.code = problem?.code || '';
    if (details.textContent !== (problem?.detail || '')) {
      details.textContent = problem?.detail || ''; details.hidden = true;
      detailsToggle.setAttribute('aria-expanded', 'false'); detailsToggle.textContent = 'Details';
    }
    detailsToggle.hidden = !problem;
  }
  const showProblem = (reason, stage) => { const problem = spawnProblem(reason, stage); setStatus(problem.text, true, problem); return problem; };
  const NAME_REFUSALS = ['E_INSTANCE_NAME_INVALID', 'E_INSTANCE_NAME_TAKEN'];

  // ── background preview (latest intent wins)
  function schedule(delay = debounce) {
    if (!alive) return;
    clearTimeout(timer);
    if (submitted && !['complete', 'partial', 'incomplete'].includes(phase)) return; // the submitted intent owns the form until settled
    serial++;
    timer = setTimeout(() => { timer = null; void read(); }, delay); // before render(): the preview column shows a read is due
    render();
  }
  async function read() {
    if (!current()) return;
    if (!local()) { shown = null; setStatus(''); render(); return; }
    if (!previewable()) {
      shown = null;
      if (soul.work === 'attached') setStatus('Attached souls are started by the instance they attach to.', true);
      else showProblem(previewFailure('E_PREVIEW_UNAVAILABLE').reason, 'preview');
      render(); return;
    }
    const draftChoice = choices();
    if (draftChoice.error) { shown = null; setStatus(''); render(); return; }
    if (reading) return; // the settling read re-reads if it was superseded
    const ticket = serial, key = choiceKey(draftChoice.value), ws = workspace().id, owner = mount;
    const valid = () => current() && owner === mount && ticket === serial;
    reading = { ticket }; factsSeen = factsKey(); // the facts this read is based on
    if (!shown || shown.key !== key) setStatus('Reading defaults…'); syncButton();
    let next = null;
    try {
      const response = await postJson(ctx, `/api/workspace-spawn-preview?ws=${encodeURIComponent(ws)}`, { action: 'preview', selector, choices: draftChoice.value });
      if (!alive) return;
      if (response?.spawnPreviewViewApi !== 1) next = { key, failure: previewFailure('E_CLI_PROTOCOL').reason };
      else if (response.status !== 'available') next = { key, failure: reasonOf(response.reason) };
      else {
        const target = previewTarget(response.target), data = target && previewData(response.data, target);
        next = data && target.workspace === ws && target.selector.soul === soul.name && target.selector.agentsRoot === soul.agentsRoot
          ? { key, data } : { key, failure: previewFailure('E_CLI_PROTOCOL').reason };
      }
    } catch (error) { next = { key, failure: previewFailure(error?.code === 'E_FORBIDDEN_FRAME' ? 'E_FORBIDDEN_FRAME' : 'E_CLI_FAILED').reason }; }
    finally { if (reading?.ticket === ticket) reading = null; }
    if (!valid()) { void read(); return; } // superseded (or closed: read() then returns) — read the latest intent now
    if (next.failure?.code === 'E_TARGET_CHANGED') { schedule(0); return; }
    shown = next;
    if (next.data) {
      if (phase === 'drifted') setStatus('These values changed since you last looked. Check them and press Spawn again.');
      else if (notice) setStatus(notice.text, true, notice); else setStatus('Preview ready', false, null, true);
    }
    else if (NAME_REFUSALS.includes(next.failure.code)) setStatus(''); // said next to the name itself
    else showProblem(next.failure, 'preview');
    if (phase === 'drifted' && next.data) phase = 'idle';
    render();
    // Suggestions follow the harness the kernel resolved, once it is known.
    if (next.data && !runtime.value && modelsFor !== next.data.harness) void fillModels();
  }
  // A launch refusal (0.30) may carry the kernel's `fix`, flat on the reason: kept, bounded text.
  const fixOf = reason => typeof reason?.fix === 'string' && reason.fix.length && reason.fix.length <= 1024 && !/[\x00-\x1f\x7f]/.test(reason.fix) ? { fix: reason.fix } : {};
  const reasonOf = reason => typeof reason?.code === 'string' && typeof reason?.message === 'string' && reason.message.length <= 2048
    ? { code: reason.code, message: reason.message, ...fixOf(reason) } : previewFailure(reason?.code).reason;

  // ── spawn (local): prepare → same decision as shown → apply
  async function run() {
    syncButton();
    if (!current() || busy() || spawn.disabled) return;
    if (!local()) return runRemote();
    const recovering = ['unknown', 'pending'].includes(phase) && intent;
    let prepareInput = null;
    if (!recovering) {
      const draftChoice = choices();
      let wakeValue;
      try { wakeValue = wake.read(); } catch (error) { setStatus(error.message, true); return; }
      prepareInput = spawnPrepareInput({ action: 'prepare', selector, choices: draftChoice.value, task: task.value, ...(wakeValue ? { wake: wakeValue } : {}) });
      if (draftChoice.error || !prepareInput) { showProblem(spawnApplyReason('E_BAD_ARGS'), 'spawn'); return; }
    }
    const ws = workspace().id, token = {}, connection = ctx.connectionGeneration?.() ?? 0, owner = mount;
    const valid = () => current() && owner === mount && flight === token && connection === (ctx.connectionGeneration?.() ?? 0);
    flight = token; phase = recovering ? 'checking' : 'preparing'; setStatus(recovering ? 'Checking the submitted spawn…' : 'Spawning…'); syncButton();
    const request = async body => {
      const raw = await postJson(ctx, `/api/spawn?ws=${encodeURIComponent(ws)}`, body);
      if (!valid()) return null;
      const view = spawnApplyView(raw, { workspace: ws, ref: body.spawnRef, selector });
      if (!view || view.preview && intent && body.action !== 'prepare' && !sameSpawnDecision(view.preview.decision, intent.preview.decision)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      return view;
    };
    try {
      let view;
      if (recovering) {
        view = await request({ action: 'result', spawnRef: intent.spawnRef });
        if (!view) return;
        // An unknown outcome is retried on the SAME intent (same key) only.
        if (view.status === 'unknown') { submitted = true; view = await request({ action: 'apply', spawnRef: intent.spawnRef }); if (!view) return; }
        if (view.status === 'prepared') { intent = null; submitted = false; phase = 'idle'; setStatus('That spawn was never submitted. Press Spawn to spawn with the values shown.'); schedule(0); return; }
      } else {
        const prepared = await request(prepareInput);
        if (!prepared) return;
        if (prepared.status !== 'prepared') {
          phase = 'idle'; notice = showProblem(prepared.reason, 'spawn'); schedule(0); return;
        }
        // The confirmation is re-read by the server; apply only what is on screen.
        if (!shown?.data || !sameSpawnDecision(prepared.preview.decision, shown.data.decision)) {
          phase = 'drifted'; shown = { key: shown?.key, data: prepared.preview }; render();
          setStatus('These values changed since you last looked. Check them and press Spawn again.'); return;
        }
        intent = prepared; submitted = true; phase = 'submitting';
        view = await request({ action: 'apply', spawnRef: intent.spawnRef });
        if (!view) return;
      }
      phase = view.status;
      if (['complete', 'partial'].includes(phase)) {
        setStatus(view.reason?.message || `Created ${view.receipt.instance}${view.receipt.launched ? '' : ' — not launched'}.`, phase === 'partial');
        if (!delivered) { delivered = true; await onCreated(view, () => current() && owner === mount); }
      } else if (phase === 'incomplete') {
        const problem = spawnProblem(view.reason, 'spawn');
        setStatus(`${view.incomplete.instance} was created but didn’t finish starting. Open it from the instance list instead of spawning again.`, true, problem);
      } else if (phase === 'pending') {
        setStatus('The spawn is still running. Check result again in a moment; nothing else was started.');
      } else if (phase === 'unknown') {
        showProblem(spawnApplyReason('E_OUTCOME_UNKNOWN'), 'spawn');
      } else {
        // Refused or stale: nothing was created. Read the current values again.
        intent = null; submitted = false; phase = 'idle';
        const problem = spawnProblem(view.reason, 'spawn');
        notice = /Nothing was created/.test(problem.text) ? problem : { ...problem, text: `${problem.text} Nothing was created.` };
        setStatus(notice.text, true, notice); schedule(0);
      }
    } catch (error) {
      if (!valid()) return;
      if (submitted) { phase = 'unknown'; showProblem(spawnApplyReason('E_OUTCOME_UNKNOWN'), 'spawn'); }
      else { phase = 'idle'; showProblem(spawnApplyReason(error?.code), 'spawn'); }
    } finally {
      if (flight === token) { flight = null; if (alive) syncButton(); }
    }
  }
  async function runRemote() {
    let wakeValue;
    try { wakeValue = wake.read(); } catch (error) { setStatus(error.message, true); return; }
    const draftChoice = choices();
    if (draftChoice.error) { setStatus(draftChoice.error, true); return; }
    remoteBusy = true; syncButton();
    try {
      const outcome = await remoteSpawn({ server: remoteTarget(), purpose: purpose.value.trim(), task: task.value, harness: runtime.value, model: model.value.trim(),
        backend: backend.value, launchConfig: config.value, yolo: yolo.value === '' ? undefined : yolo.value === 'true', wake: wakeValue,
        relation: rel.value, relativeTo: relTo.value, relativeRoot: relTo.selectedOptions[0]?.dataset.root || '', status: setStatus, button: spawn });
      if (outcome?.created && alive) phase = 'complete'; // created on the host: never a second spawn
    } finally { remoteBusy = false; if (alive) syncButton(); }
  }

  // ── model suggestions (advisory; free text stays valid)
  const suggestions = [];
  const models = createChoicePopup(doc, modelControls, 'Model choices', 'spawn-model-choices', () => [
    { value: '', label: shown?.data && !model.value && !nativeModel ? `Default · ${shown.data.model ?? "harness's own"}` : 'Default', selected: !model.value && !nativeModel, group: 'Defaults', search: false },
    { native: true, label: "The harness's own default", selected: nativeModel, group: 'Defaults', search: false },
    ...suggestions.map(m => ({ value: m.id, label: m.label || m.id, detail: m.label && m.label !== m.id ? m.id : undefined, selected: model.value === m.id, group: 'Suggestions' })),
    { custom: true, label: 'Custom…', detail: model.value || 'Type a model ID', group: 'Custom', search: false, selected: !!model.value && !suggestions.some(m => m.id === model.value) },
  ], item => {
    if (item.native) { nativeModel = true; model.value = ''; }
    else if (!item.custom) { nativeModel = false; model.value = item.value; }
    schedule(0); model.focus();
  }, { searchable: true, scope: () => JSON.stringify([runtime.value || shown?.data?.harness || '', remoteTarget()]),
    nothingReported: 'No model suggestions reported. Any model ID can be typed.', noMatch: 'No suggestions match this filter.' });
  models.trigger.textContent = ''; models.trigger.setAttribute('aria-label', 'Choose model');
  // ── harness picker: the harness's badge, like the design's provider field
  const runtimePicker = createChoicePopup(doc, runtimeLabel, 'Harness choices', 'spawn-runtime-choices', () => [
    { value: '', label: matched() ? `Default · ${runtimeName(matched().harness)}` : 'Default', detail: 'What this soul launches with unless you choose', selected: !runtime.value,
      group: 'Default', search: false, ...(matched() ? { mark: () => createRuntimeBadge(doc, matched().harness) } : {}) },
    ...runtimes.map(v => ({ value: v, label: RUNTIME_NAMES[v], selected: runtime.value === v, group: 'Harnesses', mark: () => createRuntimeBadge(doc, v) })),
  ], item => { runtime.value = item.value; runtime.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); });
  function syncRuntime(data) {
    const t = runtimePicker.trigger, value = runtime.value || data?.harness || '';
    t.replaceChildren();
    if (value) t.append(createRuntimeBadge(doc, value));
    t.append(doc.createTextNode(value ? runtimeName(value) : 'Default'));
    if (!runtime.value && data) t.append(el('span', 'default', 'spawn-trigger-tag'));
    t.setAttribute('aria-label', `Harness: ${value ? runtimeName(value) : 'default'}${runtime.value ? '' : ' (default)'}`);
    runtimePicker.refresh();
  }
  async function fillModels() {
    const ticket = ++modelsReq, rt = runtime.value || shown?.data?.harness || '';
    modelsFor = rt; suggestions.length = 0; models.refresh();
    if (!rt || !local() || !current()) return;
    try {
      const d = await postJson(ctx, '/api/models', { harness: rt });
      if (!current() || ticket !== modelsReq) return;
      for (const m of Array.isArray(d?.models) ? d.models.slice(0, 500) : []) if (m && typeof m.id === 'string' && m.id) suggestions.push({ id: m.id, label: typeof m.label === 'string' ? m.label : '' });
      models.refresh();
    } catch { /* advisory only */ }
  }
  // ── launch configurations for this soul
  async function fillConfigs() {
    const ticket = ++configsReq, prefer = config.value;
    fillSelect(config, [['', config.options[0]?.textContent || 'Default']]);
    if (!local() || !cli()?.features?.includes('launch-config') || !current()) return;
    try {
      const d = await postJson(ctx, `/api/launch-configs${wsQuery()}`, { action: 'list', selector });
      if (!current() || ticket !== configsReq) return;
      if (d?.selected?.soul !== soul.name || d.selected.agentsRoot !== soul.agentsRoot || !Array.isArray(d.configurations)) return;
      for (const row of d.configurations.slice(0, 200)) if (row && typeof row.name === 'string' && typeof harnessOf(row) === 'string') {
        const o = el('option', `${row.name} · ${runtimeName(harnessOf(row))}`); o.value = row.name; config.append(o);
      }
      if ([...config.options].some(o => o.value === prefer)) config.value = prefer;
    } catch { /* the default stays */ }
  }
  // ── execution servers (Advanced › Run on)
  Promise.resolve(typeof servers === 'function' ? servers() : servers).then(list => {
    if (!current() || soul.server || !Array.isArray(list)) return;
    for (const srv of list) { const o = el('option', `${srv.label} (ssh ${srv.sshHost})`); o.value = srv.id; server.append(o); }
    serverLabel.hidden = !list.length;
  }).catch(() => {});
  serverLabel.hidden = !soul.server;

  // ── events
  const onEdit = event => {
    if (!current()) return;
    if (event.target === model) nativeModel = false;
    notice = null;
    if (phase === 'drifted') phase = 'idle';
    if (event.target === runtime || event.target === server) void fillModels();
    if (event.target === server) { shown = null; void fillConfigs(); }
    if ([search].includes(event.target) || wake.el.contains(event.target) || event.target === task) { syncButton(); return; }
    schedule(event.type === 'change' && (event.target.tagName !== 'INPUT' || event.target.type === 'checkbox') ? 0 : debounce);
  };
  form.addEventListener('input', onEdit); form.addEventListener('change', onEdit);
  spawn.addEventListener('click', () => { void run(); });
  cancel.addEventListener('click', () => close());
  closeButton.addEventListener('click', () => close());
  // Change soul: the picker, in place — never a reopen, so nothing typed is lost.
  changeSoul.addEventListener('click', () => { setLayout('picker'); focusTarget().focus({ preventScroll: true }); });

  setLayout(layout); render();
  return {
    /** Begin reading once the host owns the attached dialog. */
    start() { if (!current()) return; schedule(0); void fillModels(); void fillConfigs(); },
    dialog, search, purpose, spawn, status, preview, changeSoul,
    /** 'scoped' (preview + form) or 'picker' (chooser + form); switched in place. */
    get layout() { return layoutNow; }, setLayout,
    submit: () => { if (!spawn.disabled) void run(); },
    busy,
    /** CLI/roster/workspace facts changed under the open dialog. */
    sync() {
      if (!alive) return;
      if (!current() || flight || submitted) { syncButton(); return; }
      const facts = factsKey();
      // A settled failure (the CLI failed, was busy…) is retried on the next poll; a name refusal waits
      // for the operator's edit, and a settled preview or a read in flight stands until a fact changes.
      const retry = !timer && !reading && !!shown?.failure && !NAME_REFUSALS.includes(shown.failure.code);
      if (facts === factsSeen && !retry) { syncButton(); return; }
      factsSeen = facts; schedule(0);
    },
    closePopups() { models.close(); runtimePicker.close(); },
    dispose() { alive = false; clearTimeout(timer); serial++; modelsReq++; configsReq++; models.dispose(); runtimePicker.dispose(); form.removeEventListener('input', onEdit); form.removeEventListener('change', onEdit); },
  };
}

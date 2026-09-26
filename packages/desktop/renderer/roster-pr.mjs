/** Roster PR badges (forge-roster, #234): the pull request of each LOCAL instance's
 * branch, keyed by home, from `POST /api/forge-roster?ws=`. Read at most once a
 * minute per workspace (the server caches for 60 s). gh missing or signed out
 * (E_GH_UNAVAILABLE) shows nothing; a busy or failed read keeps the last rows.
 * Presentation only: an instance without a row has no badge, never a guess. */
import { iconElement } from './shell-icons.mjs';

export const ROSTER_PR_TTL = 60_000;
const STATES = ['OPEN', 'CLOSED', 'MERGED'];

export const rosterPrCSS = `
/* The name never gives way to the chip: without room, the chip wraps under it. */
.ctx-name-line { display:flex; flex-wrap:wrap; align-items:center; gap:3px 6px; max-width:100%; min-width:0; }
.ctx-name-line .ctx-name { flex:0 0 auto; max-width:100%; }
.ctx-pr { display:inline-flex; align-items:center; gap:3px; flex:none; height:16px; padding:0 5px; box-sizing:border-box; border:1px solid transparent; border-radius:4px; background:var(--tag-bg); color:var(--fg); font:600 10.5px/1 ui-monospace, Menlo, monospace; white-space:nowrap; }
.ctx-pr .shell-icon { flex:none; }
.ctx-pr[data-pr-state=draft] { background:transparent; border:1px dashed var(--border); color:var(--muted); }
.ctx-pr[data-pr-state=merged] .shell-icon { color:var(--accent); } /* accent text on tag-bg is not AA in every theme */
.ctx-pr[data-pr-state=closed] { color:var(--muted); }
`;

/** A row the roster can show: the fields #234 documents, nothing else. */
export function rosterPrRow(row) {
  if (!row || typeof row !== 'object' || typeof row.home !== 'string' || !row.home) return null;
  if (!Number.isSafeInteger(row.number) || row.number <= 0 || !STATES.includes(row.state) || typeof row.isDraft !== 'boolean') return null;
  return { home: row.home, number: row.number, state: row.state, isDraft: row.isDraft, url: typeof row.url === 'string' && /^https:\/\//.test(row.url) ? row.url : null };
}

/** 'open' | 'draft' | 'merged' | 'closed': a draft is an open PR not yet ready. */
export const prState = row => row.state === 'MERGED' ? 'merged' : row.state === 'CLOSED' ? 'closed' : row.isDraft ? 'draft' : 'open';
export const prText = row => `#${row.number} · ${prState(row)}`;

/** The chip on the roster row's name line: "#231", with its state said when not open. */
export function prChip(doc, row) {
  const state = prState(row), chip = doc.createElement('span');
  chip.className = 'ctx-pr'; chip.dataset.prState = state;
  chip.append(iconElement(doc, 'pullRequest', { size: 11 }), `#${row.number}${state === 'open' ? '' : ` ${state}`}`);
  chip.setAttribute('aria-label', `pull request ${prText(row)}`);
  return chip;
}

export function createRosterPrs({ request, onChange = () => {}, now = Date.now }) {
  let workspace = null, rows = new Map(), readAt = -Infinity, flight = null, disposed = false;
  const signature = map => JSON.stringify([...map.values()]);
  const settle = (mine, next) => {
    if (disposed || mine !== workspace) return;
    readAt = now();
    if (next && signature(next) !== signature(rows)) { rows = next; onChange(); }
  };
  return {
    get: home => rows.get(home) ?? null,
    /** workspace: a local workspace id, or null (none, or remote) to clear the badges. */
    refresh(ws) {
      if (disposed) return null;
      if (ws !== workspace) {
        const had = rows.size; workspace = ws ?? null; rows = new Map(); readAt = -Infinity; flight = null;
        if (had) onChange();
      }
      if (!workspace || flight || now() - readAt < ROSTER_PR_TTL) return flight;
      const mine = workspace;
      flight = Promise.resolve().then(() => request(mine)).then(result => {
        if (result?.status === 'ok' && Array.isArray(result.rows)) settle(mine, new Map(result.rows.map(rosterPrRow).filter(Boolean).map(row => [row.home, row])));
        else if (result?.reason?.code === 'E_GH_UNAVAILABLE') settle(mine, new Map());
        else settle(mine, null); // busy or failed: keep what was shown, try again next minute
      }, () => settle(mine, null)).finally(() => { if (mine === workspace) flight = null; });
      return flight;
    },
    dispose() { disposed = true; rows = new Map(); },
  };
}

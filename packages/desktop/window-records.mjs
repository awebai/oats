// One Desktop window per workspace (#481): what main remembers of its windows across launches
// (windows.json in userData), how they come back, and what each one is titled.
//
// A record is `{ workspace, bounds: { x, y, width, height }, maximized, fullscreen? }`. Nothing is
// dropped because its workspace is not served (#472's rule): a record goes only when the operator
// closes that window while its workspace is served. Writes are atomic and debounced.
import { validWorkspaceId } from './renderer/workspace-id.mjs';
import { writeJsonAtomic } from './workspace-registry.mjs';

/** How long a burst of moves and resizes waits before one write. */
export const WINDOW_RECORDS_DELAY_MS = 500;
/** The title of a window bound to no served workspace. */
export const APP_TITLE = 'OATS Desktop';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const validBounds = (b) => !!b && typeof b === 'object' && finite(b.x) && finite(b.y) && finite(b.width) && finite(b.height) && b.width > 0 && b.height > 0;

function readRecord(v) {
  if (!v || typeof v !== 'object' || !validWorkspaceId(v.workspace) || !validBounds(v.bounds) || typeof v.maximized !== 'boolean') return null;
  if (Object.hasOwn(v, 'fullscreen') && typeof v.fullscreen !== 'boolean') return null;
  const { x, y, width, height } = v.bounds;
  return { workspace: v.workspace, bounds: { x, y, width, height }, maximized: v.maximized,
    ...(Object.hasOwn(v, 'fullscreen') ? { fullscreen: v.fullscreen } : {}) };
}

/** The records of a windows.json text, in order; a malformed entry is not a record. */
export function parseWindowRecords(text) {
  let value;
  try { value = JSON.parse(text); } catch { return []; }
  return Array.isArray(value) ? value.map(readRecord).filter(Boolean) : [];
}

/** The served view an id names (the server's viewFor): a view id as itself, a deployment id as the
 * view that holds it, else null. `workspaces` is the served list (/api/panel `workspaces`). */
export function resolveView(id, workspaces) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  const view = list.find((w) => w?.id === id) || list.find((w) => Array.isArray(w?.deployments) && w.deployments.includes(id));
  return view?.id ?? null;
}

/** The windows a launch restores: `[{ key, record }]`, one per served view, in record order (two
 * records that resolve to one view give one window, the first record's). A record whose workspace
 * is not served gets no window. The records themselves are never changed here. */
export function restorePlan(records, workspaces) {
  const plan = [], keys = new Set();
  for (const record of records) {
    const key = resolveView(record.workspace, workspaces);
    if (key === null || keys.has(key)) continue;
    keys.add(key);
    plan.push({ key, record });
  }
  return plan;
}

const overlap = (b, a) => Math.max(0, Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x))
  * Math.max(0, Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y));

/** Bounds that lie fully on a visible display: the display the bounds cover most, moved inside its
 * work area and shrunk to it when larger. Bounds on no display are centred on the first (primary)
 * display. `displays`: `[{ workArea }]` (Electron's screen.getAllDisplays(), primary first). */
export function clampBounds(bounds, displays) {
  const areas = (Array.isArray(displays) ? displays : []).map((d) => d?.workArea).filter(validBounds);
  if (!areas.length) return bounds;
  let best = null, most = 0;
  for (const area of areas) { const o = overlap(bounds, area); if (o > most) { most = o; best = area; } }
  const area = best ?? areas[0];
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  if (!best) return { x: Math.floor(area.x + (area.width - width) / 2), y: Math.floor(area.y + (area.height - height) / 2), width, height };
  return { x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height), width, height };
}

/** A window's title, from the served list: the workspace's name, a remote workspace's name with its
 * server (its machine label, else the server id). Never an id; the app's name otherwise. */
export function windowTitle(key, workspaces) {
  const view = key ? (Array.isArray(workspaces) ? workspaces : []).find((w) => w?.id === key) : null;
  const name = typeof view?.name === 'string' && view.name ? view.name : '';
  if (!name) return APP_TITLE;
  if (!view.remote) return name;
  const machine = Array.isArray(view.machines) ? view.machines.find((m) => typeof m === 'string' && m) : '';
  const server = machine || (typeof view.server === 'string' ? view.server : '');
  return server ? `${name} — ${server}` : name;
}

/**
 * The records, owned by their windows. `adopt` gives a restored window its record; `bind` points a
 * window's record at the workspace it is bound to now (creating one for a window that had none);
 * `update` keeps its bounds and state; `close` drops the record only when the window's workspace
 * is served. Every change is written (atomically) after `delay`; `flush` writes at once.
 * @param {{ file: string, initial: object[], timers?: { setTimeout, clearTimeout }, delay?: number,
 *           onError?: (error: Error) => void }} io
 */
export function createWindowRecords({ file, initial, timers = globalThis, delay = WINDOW_RECORDS_DELAY_MS,
  onError = (error) => console.error(`oats-desktop: windows.json not written: ${error.message}`) }) {
  const records = [...initial];
  const owned = new Map(); // window -> its record
  let timer = null;
  const write = () => {
    timer = null;
    try { writeJsonAtomic(file, records); } catch (error) { onError(error); }
  };
  const schedule = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(write, delay);
    timer?.unref?.();
  };
  const apply = (record, state) => {
    if (!state) return;
    if (validBounds(state.bounds)) { const { x, y, width, height } = state.bounds; record.bounds = { x, y, width, height }; }
    if (typeof state.maximized === 'boolean') record.maximized = state.maximized;
    if (typeof state.fullscreen === 'boolean') record.fullscreen = state.fullscreen;
  };
  return {
    records: () => [...records],
    adopt(win, record) { if (records.includes(record)) owned.set(win, record); },
    bind(win, workspace, state) {
      let record = owned.get(win);
      if (!record) {
        if (!validBounds(state?.bounds)) return;
        record = { workspace, bounds: null, maximized: false };
        records.push(record); owned.set(win, record);
      }
      record.workspace = workspace;
      apply(record, state);
      schedule();
    },
    update(win, state) {
      const record = owned.get(win);
      if (!record) return;
      apply(record, state);
      schedule();
    },
    close(win, { served }) {
      const record = owned.get(win);
      owned.delete(win);
      if (!record || !served) return;
      records.splice(records.indexOf(record), 1);
      schedule();
    },
    flush() {
      if (timer !== null) { timers.clearTimeout(timer); write(); }
    },
  };
}

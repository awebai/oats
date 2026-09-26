/** Schedules + Triggers (§2.3a, kernel 0.29.0 `automations`): the ONE adapter from
 * `oats schedule list --json` / `oats trigger list --json` to the rows the views
 * render. The kernel places every row (runsHere, reason, enabledHere); this module
 * only reads those facts and never re-derives placement. When the contract
 * grows (docs/desktop-cli-api.md "Workspace triggers and schedules"), only this
 * file changes. */

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const REASONS = new Set(['host-unnamed', 'assigned-elsewhere', 'owner-mismatch']);
/** The whitelisted template fields (§2.3): the only ones the kernel substitutes. */
export const TASK_FIELDS = Object.freeze(['repo', 'number', 'url', 'event', 'headSha']);

/** Which group a row belongs to, from the kernel's placement:
 * here: this computer runs it, or would but it is off / invalid here;
 * attention: named for this computer but it cannot run (owner-mismatch), or an invalid definition placed here;
 * elsewhere: another host, or this host has no name. */
export function automationGroup(row) {
  if (row.reason === 'assigned-elsewhere' || row.reason === 'host-unnamed') return 'elsewhere';
  if (row.reason === 'owner-mismatch') return 'attention';
  if (row.invalid || row.unreadable) return 'attention';
  return 'here';
}

function origin(raw, qualifiedId) {
  const o = record(raw) ? raw : {};
  const member = typeof qualifiedId === 'string' && qualifiedId.includes('/') ? qualifiedId.slice(0, qualifiedId.indexOf('/')) : null;
  if (o.kind === 'workspace') return { kind: 'workspace', member: member && member !== 'local' ? member : null, repoKey: text(o.repoKey), path: text(o.path), commit: text(o.commit), url: text(o.url) };
  return { kind: 'local', member: null, repoKey: null, path: text(o.path), commit: null, url: null };
}
function soul(raw) {
  if (!record(raw) || !text(raw.name)) return null;
  const o = record(raw.origin) ? raw.origin : null;
  return { name: raw.name, origin: o && text(o.kind) ? o : null };
}

/** One kernel row → the view's row. Unknown or missing facts stay null; nothing is guessed. */
export function automationRow(raw, kind) {
  if (!record(raw)) return null;
  const qualifiedId = text(raw.qualifiedId) || text(raw.id);
  if (!qualifiedId) return null;
  const row = {
    kind,
    // A schedule's kernel `kind` is its run (spawn, command, wake, operation).
    run: kind === 'schedule' ? text(raw.kind) : 'spawn',
    id: qualifiedId, key: qualifiedId, name: text(raw.name) || qualifiedId.split('/').pop(),
    origin: origin(raw.origin, qualifiedId),
    description: text(raw.description), owner: text(raw.owner), runsOn: text(raw.runsOn),
    runsHere: raw.runsHere === true,
    reason: REASONS.has(raw.reason) ? raw.reason : null, reasonDetail: text(raw.reasonDetail),
    enabledHere: raw.enabledHere !== false, enabled: raw.enabled !== false,
    soul: soul(raw.soul), task: text(raw.task),
    on: kind === 'trigger' && record(raw.on) ? raw.on : null,
    spawn: kind === 'trigger' && record(raw.spawn) ? raw.spawn : null,
    cron: kind === 'schedule' ? text(raw.cron) : null, tz: kind === 'schedule' ? text(raw.tz) : null,
    teams: list(raw.teams).filter(text), harness: text(raw.harness), model: text(raw.model),
    concurrency: record(raw.concurrency) ? raw.concurrency : null,
    template: record(raw.template) ? raw.template : null,
    lastRun: record(raw.lastRun) ? raw.lastRun : null, nextDue: text(raw.nextDue),
    recentRuns: list(raw.recentRuns).filter(record),
    invalid: record(raw.invalid) ? raw.invalid : null,
    unreadable: record(raw.unreadable) ? raw.unreadable : null,
  };
  row.group = automationGroup(row);
  return row;
}

/** A whole list answer → { kind, host, scheduler, snapshot, rows }, or null when it is not one. */
export function automationRows(json, kind) {
  if (!record(json) || !['schedule', 'trigger'].includes(kind)) return null;
  const raws = kind === 'trigger' ? json.triggers : json.schedules;
  if (!Array.isArray(raws)) return null;
  const rows = raws.map(raw => automationRow(raw, kind)).filter(Boolean);
  const host = record(json.host) ? { name: text(json.host.name), ghUser: text(json.host.ghUser) } : { name: null, ghUser: null };
  const snapshot = record(json.snapshot) ? { takenAt: text(json.snapshot.takenAt), problems: Number.isInteger(json.snapshot.problems) ? json.snapshot.problems : list(json.snapshot.problems).length } : null;
  return { kind, host, scheduler: record(json.scheduler) ? json.scheduler : null, snapshot, rows };
}

/** The groups in page order, each with its rows (empty groups omitted). */
export const GROUPS = Object.freeze([
  { id: 'here', title: 'Runs on this computer' },
  { id: 'attention', title: 'Needs attention here' },
  { id: 'elsewhere', title: 'Runs elsewhere' },
]);
export function groupRows(rows) {
  return GROUPS.map(g => ({ ...g, rows: rows.filter(r => r.group === g.id) })).filter(g => g.rows.length);
}

/** The origin filter (All / Workspace / Local) and the search (id, soul, task, description). */
export function filterRows(rows, { origin = 'all', query = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return rows.filter(r => (origin === 'all' || r.origin.kind === origin)
    && (!needle || [r.id, r.soul?.name, r.task, r.description, r.runsOn, r.owner].some(v => typeof v === 'string' && v.toLowerCase().includes(needle))));
}

/** "github.com/acme-kb-bot" → { login: "acme-kb-bot", host: "github.com" }. */
export function ownerParts(owner) {
  const m = typeof owner === 'string' && /^([^/\s]+)\/([^/\s]+)$/.exec(owner);
  return m ? { host: m[1], login: m[2] } : null;
}

/** Where a row runs, in words: { label, tone: ok|warn|muted, detail }. */
export function placementText(row, host) {
  if (row.origin.kind === 'local') return { label: 'This computer', tone: row.enabledHere ? 'ok' : 'muted', detail: 'Local: runs on this computer as its own gh login' };
  if (row.reason === 'owner-mismatch') return { label: 'Wrong account here', tone: 'warn', detail: row.reasonDetail };
  if (row.reason === 'host-unnamed') return { label: row.runsOn || 'Not named', tone: 'muted', detail: 'This computer has no host name' };
  if (row.reason === 'assigned-elsewhere') return { label: row.runsOn || 'Another host', tone: 'muted', detail: row.reasonDetail };
  return { label: 'This computer', tone: row.enabledHere ? 'ok' : 'muted', detail: host?.name ? `This computer is ${host.name}` : null };
}

/** The task template split into text and whitelisted field tokens, for highlighting. */
export function taskParts(task) {
  const out = [];
  if (typeof task !== 'string') return out;
  const re = new RegExp(`\\{(${TASK_FIELDS.join('|')})\\}`, 'g');
  let at = 0;
  for (const m of task.matchAll(re)) {
    if (m.index > at) out.push({ text: task.slice(at, m.index) });
    out.push({ field: m[1] }); at = m.index + m[0].length;
  }
  if (at < task.length) out.push({ text: task.slice(at) });
  return out;
}

const pad = n => String(n).padStart(2, '0');
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
/** Common cron shapes in words; anything else → null (the view shows the cron itself). */
export function cronInWords(cron) {
  const f = typeof cron === 'string' ? cron.trim().split(/\s+/) : [];
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${every[1]} minutes`;
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || dom !== '*' || mon !== '*') return null;
  const at = `${pad(hour)}:${pad(min)}`;
  if (dow === '*') return `Daily at ${at}`;
  if (dow === '1-5') return `Weekdays at ${at}`;
  if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${at}`;
  return null;
}

const SOURCES = { 'github.pull_request': 'Pull request' };
/** A trigger's event in words: "Pull request opened, reopened" + repo + labels + base. */
export function onSummary(on) {
  if (!record(on)) return null;
  const events = list(on.events).filter(text).map(e => e.replace(/_/g, ' '));
  return {
    title: [SOURCES[on.source] || text(on.source) || 'Event', events.join(', ')].filter(Boolean).join(' '),
    repo: text(on.repo) ? on.repo.replace(/^github\.com\//, '') : null,
    labels: list(on.labels).filter(text), base: text(on.base), poll: text(on.poll),
  };
}

/** A timestamp relative to now ("in 5 min", "2 h ago"), with the absolute time for its title. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = t - now, a = Math.abs(d), future = d > 0;
  const unit = a < 60e3 ? null : a < 3600e3 ? `${Math.round(a / 60e3)} min` : a < 86400e3 ? `${Math.round(a / 3600e3)} h` : `${Math.round(a / 86400e3)} d`;
  return { label: unit === null ? (future ? 'in under a minute' : 'just now') : future ? `in ${unit}` : `${unit} ago`, title: new Date(t).toLocaleString() };
}

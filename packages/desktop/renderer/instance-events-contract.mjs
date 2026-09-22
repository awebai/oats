/** K7 API2 consumer input contract. Pure data validation; no log/kernel IO. */
import { absolute, record } from './readiness-contract.mjs';
const exact = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const text = (v, max = 4096) => typeof v === 'string' && !!v && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
export const EVENTS_LIMITS = Object.freeze([50, 100, 200]);
export const EVENTS_DEFAULT_LIMIT = 100;
export const eventsTimestamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const eventsLimit = v => EVENTS_LIMITS.includes(v) ? v : null;
export const eventsSupported = cli => cli?.ok === true && absolute(cli.bin) && cli.eventsApi === 2
  && Array.isArray(cli.features) && cli.features.includes('instance-events-2');
/** Renderer supplies a qualified local selector, never a home or log path. */
export function eventsSelector(v) {
  return exact(v, ['instance', 'agent', 'agentsRoot', 'server']) && name(v.instance) && name(v.agent)
    && absolute(v.agentsRoot) && v.server === null
    ? { instance: v.instance, agent: v.agent, agentsRoot: v.agentsRoot, server: null } : null;
}
export function eventsRequest(v) {
  if (!exact(v, ['action', 'selector', 'limit']) || v.action !== 'read') return null;
  const selector = eventsSelector(v.selector);
  const limit = Object.hasOwn(v, 'limit') ? eventsLimit(v.limit) : EVENTS_DEFAULT_LIMIT;
  return selector && limit !== null ? { action: 'read', selector, limit } : null;
}
/** Only server admission supplies these paths. Syntactic validation is NOT
 * roster/scope admission, incarnation proof, or authority to open a file. */
export function eventsTarget(v) {
  const selector = eventsSelector(v?.selector);
  return record(v) && selector && text(v.workspace) && absolute(v.context) && absolute(v.home)
    && v.home.split('/').at(-1) === selector.instance && (v.incarnation == null || eventsTimestamp(v.incarnation))
    ? { workspace: v.workspace, context: v.context, selector, home: v.home, incarnation: v.incarnation ?? null } : null;
}
const errors = {
  E_BAD_ARGS: 'Activity requires one qualified local instance and an approved row limit.',
  E_EVENTS_UNAVAILABLE: 'Activity requires advertised instance-events-2 and integer eventsApi 2. API 1 is not invoked.',
  E_WORKSPACE_UNKNOWN: 'Choose an advertised local workspace.',
  E_SESSION_UNKNOWN: 'The selected instance is no longer in the current roster.',
  E_AMBIGUOUS_INSTANCE: 'Choose one exact instance home.',
  E_HOME_MISMATCH: 'The instance home no longer matches the selected address.',
  E_NOT_IN_SCOPE: 'The selected instance is outside this workspace scope.',
  E_TARGET_CHANGED: 'The workspace, instance or CLI changed. Load activity again.',
  'cli-unavailable': 'Choose a compatible installed OATS CLI.',
  'unsupported-remote-operation': 'Activity is local only; no remote-to-local substitution.',
  E_UNSUPPORTED_MODE: 'Activity is unavailable for this execution mode; no classic fallback.',
  'unsupported-action': 'This CLI cannot read activity for the selected execution mode.',
  E_BUSY: 'Two activity reads are already in progress. Retry when one finishes.',
  E_FORBIDDEN_FRAME: 'This frame cannot request activity.',
  E_CLI_TIMEOUT: 'The activity read timed out.',
  E_CLI_OUTPUT_LIMIT: 'The activity response exceeded its output limit.',
  E_CLI_PROTOCOL: 'The CLI returned invalid or mismatched activity data.',
  E_CLI_FAILED: 'The installed CLI could not complete the activity read.',
};
export function eventsFailure(code, target = null) {
  if (!Object.hasOwn(errors, code)) code = 'E_CLI_FAILED';
  return { instanceEventsViewApi: 1, status: 'unavailable', target: eventsTarget(target), data: null,
    reason: { code, message: errors[code] } };
}

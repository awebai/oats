/** K8b History API3 input contract. Pure validation, never schedule execution. */
import { absolute, record } from './readiness-contract.mjs';
const exact = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
export const scheduleReadId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
export const scheduleReadSupported = cli => cli?.ok === true && absolute(cli.bin) && cli.scheduleHistoryApi === 3
  && Array.isArray(cli.features) && cli.features.includes('schedule-read-2');
export const CAPTURED_SCHEDULE_EDIT_UNAVAILABLE = 'this schedule carries an execution policy the editor cannot preserve; edit via CLI';
export const SCHEDULE_TRANSCRIPT_UNAVAILABLE = 'This record provides session provenance, not a transcript. Read-only transcript access is not available (K12).';
export function scheduleReadRequest(v) {
  if (exact(v, ['action']) && v.action === 'list') return { action: 'list' };
  if (exact(v, ['action', 'id']) && v.action === 'show' && scheduleReadId(v.id)) return { action: 'show', id: v.id };
  return null;
}
/** Legacy READ spellings only. A mutation is not convertible to a read and
 * extra keys are not silently discarded. HTTP aliases will share one broker. */
export function scheduleReadAlias(v) {
  if (!exact(v, v?.operation === 'list' ? ['operation'] : ['operation', 'id'])) return null;
  return scheduleReadRequest({ action: v.operation, ...(Object.hasOwn(v, 'id') ? { id: v.id } : {}) });
}
const errors = {
  E_BAD_ARGS: 'Schedule reads accept only list or show with a bounded schedule ID.',
  E_WORKSPACE_UNKNOWN: 'Choose an advertised local workspace.',
  'cli-unavailable': 'Choose a compatible installed OATS CLI.',
  E_SCHEDULE_READ_UNAVAILABLE: 'Schedule reads require advertised schedule-read-2 and integer scheduleHistoryApi 3. Older read modes are not invoked.',
  'unsupported-remote-operation': 'Schedule history is unsupported on remote workspaces; no local substitution was used.',
  E_SCHEDULE_UNKNOWN: 'This schedule is no longer reported in the selected scope.',
  E_SCHEDULE_IDENTITY: 'The stored schedule identity does not match the canonical schedule key.',
  E_SCHEDULE_STATE_OVERSIZE: 'Schedule definitions or state exceed the safe read budget. No partial JSON was accepted.',
  E_SCHEDULE_INVALID: 'The installed CLI could not read valid schedule data.',
  E_TARGET_CHANGED: 'The workspace, schedule or CLI changed. Refresh the schedule observation.',
  E_BUSY: 'Two schedule reads are already in progress. Retry when one finishes.',
  E_METHOD_NOT_ALLOWED: 'Schedule reads require an explicit workspace and POST. GET does not run a command.',
  E_FORBIDDEN_FRAME: 'This frame cannot request schedule data.',
  E_CLI_TIMEOUT: 'The schedule read timed out.',
  E_CLI_OUTPUT_LIMIT: 'The schedule response exceeded its output limit.',
  E_CLI_PROTOCOL: 'The CLI returned invalid or mismatched schedule data.',
  E_CLI_FAILED: 'The installed CLI could not complete the schedule read.',
};
export function scheduleSource(v) {
  if (!record(v) || !['definitions', 'state'].includes(v.path) || !['ok', 'absent', 'refused', 'oversize', 'corrupt'].includes(v.status)
    || !Number.isSafeInteger(v.bytes) || v.bytes < 0 || v.status === 'absent' && v.bytes !== 0
    || v.status === 'ok' && v.bytes > 1048576 || v.status === 'oversize' && v.bytes <= 1048576) return null;
  return { path: v.path, status: v.status, bytes: v.bytes };
}
export function scheduleReadFailure(code, scope = null, details = null) {
  if (typeof code !== 'string' || !Object.hasOwn(errors, code)) code = 'E_CLI_FAILED';
  const source = ['E_SCHEDULE_INVALID', 'E_SCHEDULE_STATE_OVERSIZE'].includes(code) ? scheduleSource(details?.source) : null;
  return { scheduleReadViewApi: 1, status: 'unavailable', scope: absolute(scope) ? scope : null, data: null,
    reason: { code, message: errors[code], ...(source ? { details: { source } } : {}) } };
}

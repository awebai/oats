/** Fixed read-only API2 argv. Never dispatch API1 or fall back to spawn. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from './cli-adapter.mjs';
import { previewChoices, previewTarget, previewSupported, previewFailure, choiceArgv } from './renderer/spawn-preview-contract.mjs';
const failure = (code, message) => ({ schemaVersion: 1, ok: false, error: previewFailure(code, null, message).reason });
export function cliSpawnPreview(cli, options = {}, io = {}) {
  // Defense at the actual exec owner as well as at HTTP admission.
  if (!previewSupported(cli)) return Promise.resolve(failure('E_PREVIEW_UNAVAILABLE'));
  const target = previewTarget(options.target), choices = previewChoices(options.choices);
  if (!target || !choices || Object.keys(options).some(k => !['target', 'choices', 'maxAge'].includes(k))) return Promise.resolve(failure('E_BAD_ARGS'));
  // Feature spawn-preview-max-age: reuse member heads the kernel observed within maxAge seconds. Only
  // where the CLI advertises it (an older kernel refuses the flag); prepare and apply never pass it.
  const maxAge = options.maxAge;
  if (maxAge !== undefined && (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 3600)) return Promise.resolve(failure('E_BAD_ARGS'));
  const reuse = maxAge !== undefined && Array.isArray(cli.features) && cli.features.includes('spawn-preview-max-age') ? ['--max-age', String(maxAge)] : [];
  const argv = ['spawn', target.selector.soul, '--dir', target.context, '--agents-root', target.selector.agentsRoot, '--preview', ...choiceArgv(choices, cli), ...reuse, '--json'];
  const env = { ...(io.env ?? process.env) };
  for (const k of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION', 'OATS_PREVIEW_PREFLIGHT_BUDGET_MS']) delete env[k];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(cli.bin, argv, { cwd: target.context, env, shell: false, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        if (err?.killed) return resolve(failure('E_CLI_TIMEOUT'));
        const doc = parseEnvelope(stdout);
        if (doc?.ok === false) return resolve(failure(doc.error?.code, doc.error?.message));
        if (err) return resolve(failure('E_CLI_FAILED'));
        resolve(doc?.ok === true ? doc : failure('E_CLI_PROTOCOL'));
      });
    } catch { resolve(failure('E_CLI_FAILED')); }
  });
}

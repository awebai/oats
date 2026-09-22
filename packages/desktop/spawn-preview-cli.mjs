/** Fixed read-only API2 argv. Never dispatch API1 or fall back to spawn. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from './cli-adapter.mjs';
import { previewChoices, previewTarget, previewSupported, previewFailure } from './renderer/spawn-preview-contract.mjs';
const failure = code => ({ schemaVersion: 1, ok: false, error: previewFailure(code).reason });
export function cliSpawnPreview(cli, options = {}, io = {}) {
  // Defense at the actual exec owner as well as at HTTP admission.
  if (!previewSupported(cli)) return Promise.resolve(failure('E_PREVIEW_UNAVAILABLE'));
  const target = previewTarget(options.target), choices = previewChoices(options.choices);
  if (!target || !choices || Object.keys(options).some(k => !['target', 'choices'].includes(k))) return Promise.resolve(failure('E_BAD_ARGS'));
  const argv = ['spawn', target.selector.soul, '--dir', target.context, '--agents-root', target.selector.agentsRoot, '--preview'];
  for (const [k, flag] of [['purpose', '--purpose'], ['branch', '--branch'], ['base', '--base'], ['runtime', '--runtime'], ['launchConfig', '--launch-config'], ['backend', '--backend']]) if (choices[k] !== undefined) argv.push(flag, choices[k]);
  if (choices.model.kind !== 'inherit') argv.push('--model', choices.model.kind === 'native-default' ? '@native-default' : choices.model.value);
  for (const [k, on, off] of [['yolo', '--yolo', '--no-yolo'], ['allowChildSpawns', '--allow-child-spawns', '--no-child-spawns']]) if (choices[k] !== undefined) argv.push(choices[k] ? on : off);
  if (choices.relation.kind !== 'unrelated') argv.push('--relation', choices.relation.kind, '--relative-to', choices.relation.anchor.instance, '--relative-root', choices.relation.anchor.agentsRoot);
  argv.push('--json');
  const env = { ...(io.env ?? process.env) };
  for (const k of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION', 'OATS_PREVIEW_PREFLIGHT_BUDGET_MS']) delete env[k];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(cli.bin, argv, { cwd: target.context, env, shell: false, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        if (err?.killed) return resolve(failure('E_CLI_TIMEOUT'));
        const doc = parseEnvelope(stdout);
        if (doc?.ok === false) return resolve(failure(doc.error?.code));
        if (err) return resolve(failure('E_CLI_FAILED'));
        resolve(doc?.ok === true ? doc : failure('E_CLI_PROTOCOL'));
      });
    } catch { resolve(failure('E_CLI_FAILED')); }
  });
}

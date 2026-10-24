// Deployment setup reads only location selectors from the already-effective
// configuration map. Native directory policy stays owned by the record package.
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { captureRootDirectory } from '../packages/record/lib/capture-roots.mjs';
import { nativeLaunchLocations } from '../packages/record/lib/session-roots.mjs';

const names = ['HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'];
const sources = { claude: 'cc', codex: 'codex', pi: 'pi' };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function deriveCaptureRoots({ deployment, configurations = {}, configurationError = false, env = process.env }) {
  const roots = new Map(), unavailable = [];
  if (configurationError) unavailable.push({ configuration: '(deployment)', selector: 'launch-configs', reason: 'unreadable' });
  else for (const [configuration, config] of Object.entries(configurations).sort(([a], [b]) => order(a, b))) {
    let selector = 'harness';
    const refuse = reason => { throw Object.assign(new Error('unsupported transcript selector'), { rootReason: reason }); };
    try {
      if (!Object.hasOwn(sources, config.harness)) refuse('malformed');
      const selected = {};
      for (const name of names) {
        selector = name;
        if (Object.hasOwn(config.env ?? {}, name)) {
          const value = config.env[name];
          if (typeof value === 'string') selected[name] = value;
          else if (value && Object.keys(value).length === 1 && typeof value.fromEnv === 'string') {
            if (typeof env[value.fromEnv] !== 'string') refuse('unresolved-reference');
            selected[name] = env[value.fromEnv];
          } else refuse('malformed');
        } else if (typeof env[name] === 'string') selected[name] = env[name];
      }
      // Refuse before nativeDirectory could resolve a relative selector against
      // setup's cwd. Future instance homes are deliberately unknown here.
      const check = (name, value, tilde = false) => {
        selector = name;
        if (!value) return;
        if (value.includes('\0') || value.startsWith('~') && (!tilde || !(value === '~' || value.startsWith('~/')))) refuse('malformed');
        if (!isAbsolute(value) && !(tilde && value.startsWith('~'))) refuse('relative');
      };
      check('HOME', selected.HOME || homedir());
      const args = config.args ?? [];
      if (config.harness === 'pi') {
        let session = selected.PI_CODING_AGENT_SESSION_DIR;
        let sessionSelector = 'PI_CODING_AGENT_SESSION_DIR';
        if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) { selector = 'args'; refuse('malformed'); }
        for (let i = 0; i < args.length; i++) {
          selector = '--session';
          if (args[i] === '--session' || args[i].startsWith('--session=')) refuse('malformed');
          if (args[i] === '--session-dir' || args[i].startsWith('--session-dir=')) {
            selector = '--session-dir';
            session = args[i] === '--session-dir' ? args[++i] : args[i].slice('--session-dir='.length);
            if (!session || session.startsWith('--')) refuse('malformed');
            sessionSelector = '--session-dir';
          }
        }
        if (session) check(sessionSelector, session, true);
        else check('PI_CODING_AGENT_DIR', selected.PI_CODING_AGENT_DIR, true);
      } else check(config.harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        selected[config.harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']);
      for (const path of nativeLaunchLocations(config.harness, { env: selected, args, cwd: deployment })) {
        const root = { source: sources[config.harness], path };
        roots.set(`${root.source}\0${path}`, root);
        try { captureRootDirectory(path, { readable: true }); }
        catch { unavailable.push({ configuration, selector, reason: 'unreadable', path }); }
      }
    } catch (error) {
      unavailable.push({ configuration, selector, reason: error.rootReason ?? 'malformed' });
    }
  }
  return { schemaVersion: 1, deployment,
    roots: [...roots.values()].sort((a, b) => order(a.source, b.source) || order(a.path, b.path)), unavailable };
}

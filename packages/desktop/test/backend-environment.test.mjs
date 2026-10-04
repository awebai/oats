// The programs the backend and its collector start get the user's environment (#602), against
// the shipped server as a real process (helpers/load-path-server.mjs): a scripted fake `oats` and
// a fake `tmux`, each recording the environment it was started with. The server is started as
// main starts the backend on an AppImage: with what Electron, the AppImage runtime and its
// launcher added, and ELECTRON_RUN_AS_NODE. No real tmux server is asked anything: the only tmux
// on the server's PATH is the fake, which answers as a server that is not running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startLoadPathServer } from './helpers/load-path-server.mjs';
import { desktopEnvironment, assertUserEnvironment } from './helpers/desktop-environment.mjs';

test('the oats CLI at startup and on a roster read, and the tmux the collector starts, get none of what the Desktop or its packaging added', async () => {
  const s = await startLoadPathServer({ recordEnvironment: true, tmux: true,
    // The mount's two entries in front of the directory that holds the fakes; one kernel name.
    env: ({ dir }) => ({ ...desktopEnvironment(join(dir, 'mount'), { PATH: dir }), OATS_RESOLUTION: 'fixture-resolution' }) });
  try {
    const mount = join(s.dir, 'mount');
    // The backend to the oats CLI. The first call is the probe the server runs when it starts.
    const [version] = await s.started('version');
    assert.deepEqual(version.argv, ['version', '--json']);
    assertUserEnvironment(version.env, mount, 'the startup probe', { path: s.dir });
    assert.equal(version.env.OATS_RESOLUTION, 'fixture-resolution', 'the probe deletes no kernel name, as before');
    const [status] = await s.started('status');
    assertUserEnvironment(status.env, mount, 'the roster read', { path: s.dir });
    assert.equal(Object.hasOwn(status.env, 'OATS_RESOLUTION'), false, 'the roster read still deletes the kernel names');
    // The backend to the collector to tmux: the fixture's seat has a tmux target, so the collector reads it.
    const [tmux] = await s.until(() => { const calls = s.tmuxCalls(); return calls.length ? calls : null; });
    assert.ok(tmux.argv.includes('list-panes'), tmux.argv.join(' '));
    assertUserEnvironment(tmux.env, mount, "the collector's tmux", { path: s.dir });
    // The collector ran as a program and its answer was merged: no server, so the seat is stopped.
    const panel = await s.until(async () => { const p = await s.panel(); return p.deployment?.status === 'observed' ? p : null; });
    assert.deepEqual(panel.instances.map(i => i.runtimeState), ['stopped']);
  } finally { await s.stop(); }
});

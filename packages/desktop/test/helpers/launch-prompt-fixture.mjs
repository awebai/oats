// Inert DTOs from the writer contract; no harness, CLI or tmux process runs.
export function launchPrompts(status = 'blocked') {
  return { status, answers: status === 'blocked' ? [{ class: 'awebDevelopmentChannel', signatureId: 'claude-fixture', status: 'submitted' }] : [],
    reason: status === 'blocked' ? 'blocked: unexpected prompt' : 'launch prompt audit failed after possible input',
    receipt: [{ ok: true, row: { data: { private: 'PRIVATE RAW EVENT' } }, results: [
      { path: '/example/events.jsonl', ok: true }, { path: '/example/home-events.jsonl', ok: false, reason: 'PRIVATE OS ERROR' }] }] };
}
export function retained(d, status = 'blocked') {
  return { instance: d.instance, home: d.home, launched: 'unknown', retained: true, unconfirmed: true,
    parentLineageCommitted: true, target: { socket: '/tmp/fixture.sock', session: 'agents', window: d.instance, windowId: '@2', paneId: '%2', pid: 1234 },
    launchPrompts: launchPrompts(status) };
}

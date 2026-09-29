export function parseAwJson(text, what) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error(`${what} returned no JSON result`);
  try { return JSON.parse(trimmed); } catch { /* may have progress before JSON */ }
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('{')) continue;
    try { return JSON.parse(lines.slice(i).join('\n')); } catch { /* keep looking */ }
  }
  throw new Error(`${what} returned no JSON result`);
}

export function custodyPreflight({ custody, resident, team, e2eeRequired = true, runAw, fatalOnError = true, fatal }) {
  const failNow = (message) => { if (fatalOnError && typeof fatal === 'function') fatal(message); throw new Error(message); };
  let status;
  try { status = parseAwJson(runAw(['aw', 'custody', 'status', '--json'], custody, { unsetEnv: ['AWEB_IDENTITY_HOME'] }), 'aw custody status'); }
  catch (e) { failNow(`custody preflight failed for ${resident}: aw custody status --json could not run (${e.message || e}); start aw custody serve for ${resident}`); }
  const state = String(status.status || 'unknown');
  const firstError = Array.isArray(status.errors) && status.errors.length ? status.errors[0] : undefined;
  const firstErrorCode = typeof firstError === 'string' ? firstError : firstError?.code;
  const code = firstErrorCode ? ` error=${firstErrorCode}` : '';
  const fail = (why) => failNow(`custody preflight failed for ${resident}: status=${state}${code}; ${why}; start aw custody serve for ${resident}`);
  if (state !== 'running') fail('custody service is not running');
  const teamRow = (Array.isArray(status.teams) ? status.teams : []).find((t) => t && (t.team_id || t.id) === team);
  if (!teamRow) fail(`team ${team} is not present in custody status`);
  if (teamRow.ready !== true) fail(`team ${team} is not ready in custody status`);
  if (teamRow.certificate_present === false) fail(`team ${team} certificate is not present in custody status`);
  if (teamRow.grant_status_endpoint_ready !== undefined && teamRow.grant_status_endpoint_ready !== true) fail(`the aweb server serving team ${team} does not provide grant status yet; hosted grants wait for that deployment`);
  if (status.keys?.signing_ready !== true) fail('keys.signing_ready is false');
  const ops = new Set(Array.isArray(status.ops) ? status.ops.map(String) : []);
  const requiredOps = ['sign_plain_message.v1', ...(e2eeRequired ? ['unwrap_e2ee_message.v1', 'create_e2ee_envelope.v1'] : [])];
  const missingOps = requiredOps.filter((op) => !ops.has(op));
  if (missingOps.length) fail(`required custody operations are missing: ${missingOps.join(', ')}`);
  if (e2eeRequired && status.keys?.encryption_ready !== true) fail('keys.encryption_ready is false');
  const warnings = [];
  if (!e2eeRequired && status.keys?.encryption_ready !== true) warnings.push('E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session.');
  return { status, warnings };
}

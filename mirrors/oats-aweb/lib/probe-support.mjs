// Both the CLI primitive and server freshness behavior need published, qualified
// contracts. This gate has no environment/flag bypass and never uses a canary send.
import {accessSync, realpathSync, statSync, constants} from 'node:fs';
import {join, delimiter} from 'node:path';
import {request as httpsRequest} from 'node:https';
import {refuse, parseProbeJson, canonicalArgument} from './probe-runtime.mjs';
import {readWorkspaceService} from './probe-service.mjs';
import {AW_MIN} from './aw-floor.mjs';

// Maintainer declaration: oats-aweb#57, issuecomment-6077900224. The origins and
// server floor are probe only; the CLI floor is the provider's single aw floor.
export const PROBE_RELEASE_SUPPORT = Object.freeze({origins: Object.freeze(['https://app.aweb.ai']), cliFloor: AW_MIN, serverFloor: '1.27.12'});

/** Exact selected service only. URL.origin strips /api without switching host;
 * credentials, query strings and fragments are never accepted as an authority. */
export function probeMetadataUrl(awebUrl) {
  if (typeof awebUrl !== 'string' || awebUrl.length > 2048 || !/^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/api\/?|\/)?$/.test(awebUrl)) return null;
  let url;
  try { url = new URL(awebUrl); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname)) return null;
  return `${url.origin}/meta`;
}
function stableSemver(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function atLeast(value, floor) {
  const v = stableSemver(value), f = stableSemver(floor);
  if (!v || !f) return false;
  for (let i = 0; i < 3; i++) if (v[i] !== f[i]) return v[i] > f[i];
  return true;
}
/** Pure admission projection; the I/O adapter below supplies bounded metadata
 * from this exact URL and a version observation of the selected executable. */
export function projectProbeSupport({awebUrl, cliVersion, metadata, observedUrl, policy = PROBE_RELEASE_SUPPORT}) {
  const metadataUrl = probeMetadataUrl(awebUrl);
  const origin = metadataUrl ? new URL(metadataUrl).origin : null;
  const supported = !!(metadataUrl && policy && Array.isArray(policy.origins) && policy.origins.includes(origin) && observedUrl === metadataUrl && atLeast(cliVersion, policy.cliFloor) && atLeast(metadata?.build?.aweb_version, policy.serverFloor));
  return {supported, origin, metadataUrl, reason: supported ? null : `fresh-conversation support unknown/unsupported on ${origin ?? 'unknown origin'}`};
}
export function resolveProbeAw(pathValue) {
  // Resolve once, then run version and every identity/mail command via this path.
  for (const dir of String(pathValue ?? '').split(delimiter)) {
    if (!canonicalArgument(dir)) continue;
    try {
      const file = realpathSync(join(dir, 'aw'));
      accessSync(file, constants.X_OK);
      if (canonicalArgument(file) && statSync(file).isFile()) return file;
    } catch { /* next explicit PATH entry */ }
  }
  refuse('probe-cli-unavailable');
}
export function probeAwVersion(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  // versionReport() emits text, even with --json. Only the anchored release
  // version line grants admission; dev, prerelease and malformed lines refuse.
  const match = /^aw ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\r?\n(?:  (?:commit:|built:) [^\r\n]*\r?\n)*$/.exec(text);
  return match && stableSemver(match[1]) ? match[1] : null;
}
export function observeProbeMetadata(url, budget, request = httpsRequest) {
  const timeout = budget.cap(5000);
  return new Promise((resolve, reject) => {
    let req, response, timer, settled = false, size = 0; const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); budget.signal?.removeEventListener('abort', cancel);
      if (error) { response?.destroy(); req?.destroy(); reject(error); }
      else resolve(value);
    };
    const fail = () => finish(new Error('metadata unavailable'));
    const cancel = () => fail();
    try {
      // node:https sends no ambient auth/proxy headers and follows no redirects.
      req = request(url, {method: 'GET', agent: false, rejectUnauthorized: true, headers: {accept: 'application/json'}}, res => {
        response = res;
        if (res.statusCode !== 200) { fail(); return; }
        res.on('error', fail); res.on('aborted', fail);
        res.on('data', data => {
          size += data.length;
          if (size > 65536) fail(); else chunks.push(data);
        });
        res.on('end', () => {
          try { budget.check(); finish(null, parseProbeJson(Buffer.concat(chunks))); } catch (e) { finish(e); }
        });
      });
      req.on('error', fail);
      timer = setTimeout(fail, timeout);
      budget.signal?.addEventListener('abort', cancel, {once: true});
      if (budget.signal?.aborted) cancel(); else req.end();
    } catch (e) { finish(e); }
  });
}
export async function qualifyProbeSupport({execute, target, budget, path, observe = observeProbeMetadata, resolveAw = resolveProbeAw}) {
  budget.check();
  const root = readWorkspaceService(target.rootHome), receiver = readWorkspaceService(target.identityHome);
  if (root.awebUrl !== receiver.awebUrl) refuse('selected-service-mismatch');
  const metadataUrl = probeMetadataUrl(root.awebUrl);
  const origin = metadataUrl ? new URL(metadataUrl).origin : null;
  // Never put credentials or arbitrary config text in the refusal projection.
  const reason = `fresh-conversation support unknown/unsupported on ${origin ?? 'unknown origin'}`;
  if (!metadataUrl || !PROBE_RELEASE_SUPPORT.origins.includes(origin)) refuse(reason);
  const awBinary = resolveAw(path);
  const binaryStamp = () => { const s = statSync(awBinary); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; };
  const stamp = binaryStamp();
  const revalidate = () => {
    budget.check();
    if (readWorkspaceService(target.rootHome).digest !== root.digest || readWorkspaceService(target.identityHome).digest !== receiver.digest) refuse('selected-service-config-changed');
    if (binaryStamp() !== stamp) refuse('probe-cli-changed');
  };
  let awVersion;
  try { awVersion = probeAwVersion(await execute(awBinary, ['version'], 3000)); }
  catch { budget.check(); refuse('probe-cli-version-unavailable'); }
  if (!atLeast(awVersion, PROBE_RELEASE_SUPPORT.cliFloor)) refuse('probe-cli-version-unsupported');
  revalidate();
  let metadata;
  try { metadata = await observe(metadataUrl, budget); }
  catch { budget.check(); refuse(reason); }
  budget.check(); revalidate();
  if (!projectProbeSupport({awebUrl: root.awebUrl, cliVersion: awVersion, metadata, observedUrl: metadataUrl}).supported) refuse(reason);
  return {cli: true, server: true, awBinary, awVersion, revalidate};
}

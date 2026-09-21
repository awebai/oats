/** Read-only effective catalog of the accepted installed LOCAL CLI. */
import { isAbsolute } from 'node:path';
import { cliCatalog } from '../cli-adapter.mjs';
import { parseSemver } from '../cli-locator.mjs';

export const CATALOG_MINIMUM_VERSION = '0.24.6';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const nullableText = value => value === null || typeof value === 'string';
const absolute = value => text(value) && isAbsolute(value) && !value.includes('\0');

function validDescription(value) {
  return object(value) && value.schemaVersion === 1 && object(value.catalog)
    && ['bundled', 'override'].includes(value.catalog.origin)
    && nullableText(value.catalog.file) && nullableText(value.catalog.kernelVersion)
    && Array.isArray(value.packages) && value.packages.every(p => object(p) && text(p.package)
      && nullableText(p.url) && nullableText(p.ref) && nullableText(p.path)
      && object(p.acquire) && Array.isArray(p.acquire.argv) && p.acquire.argv.length === 3
      && p.acquire.argv[0] === 'oats' && p.acquire.argv[1] === 'install' && p.acquire.argv[2] === p.package)
    && Array.isArray(value.capabilityAliases) && value.capabilityAliases.every(a => object(a)
      && text(a.capability) && nullableText(a.package) && nullableText(a.capabilityInPackage)
      && nullableText(a.via) && (typeof a.available === 'boolean' || a.available === null))
    && Array.isArray(value.notes) && value.notes.every(n => typeof n === 'string');
}

const response = (description, reason = null) => ({
  catalogApi: 1, scope: 'local-cli', status: reason ? 'unavailable' : 'available',
  minimumVersion: CATALOG_MINIMUM_VERSION, description, reason,
});
const unavailable = (code, message) => response(null, { code, message });

/** Injectable, in-flight-only boundary. Invoker identity is part of the key so
 * independent CLI transports/tests can never consume one another's reads. */
export function createCatalogBoundary({ invoke: defaultInvoke = cliCatalog } = {}) {
  const byInvoker = new WeakMap();
  return async function catalogRequest(request, { cli, localCwd, invoke = defaultInvoke } = {}) {
    if (!object(request) || Object.keys(request).length) {
      throw Object.assign(new Error('Catalog reads accept only an empty JSON object or body'), { code: 'E_BAD_ARGS' });
    }
    if (cli?.ok !== true || !absolute(cli.bin) || !absolute(localCwd)) {
      return unavailable('cli-unavailable', 'Select a compatible installed OATS CLI to read its catalog');
    }
    const version = parseSemver(cli.version);
    const floor = parseSemver(CATALOG_MINIMUM_VERSION).nums;
    const comparison = version && (version.nums[0] - floor[0] || version.nums[1] - floor[1] || version.nums[2] - floor[2]);
    if (!version || version.prerelease || comparison < 0) {
      return unavailable('cli-no-catalog', `Catalog reads require OATS ${CATALOG_MINIMUM_VERSION} or newer`);
    }
    if (typeof invoke !== 'function') return unavailable('E_CLI_FAILED', 'The installed OATS CLI catalog read failed');
    let pending = byInvoker.get(invoke);
    if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
    const bin = cli.bin;
    const key = JSON.stringify([bin, cli.version, localCwd]);
    if (!pending.has(key)) {
      const read = Promise.resolve().then(() => invoke(bin, { localCwd })).then(envelope => {
        if (envelope?.schemaVersion !== 1 || envelope.ok !== true) {
          // Do not echo free-form child diagnostics (or raw stderr) to clients.
          return unavailable('E_CLI_FAILED', 'The installed OATS CLI could not read its catalog; update it or retry');
        }
        if (!validDescription(envelope.result)) return unavailable('E_CLI_PROTOCOL', 'The installed OATS CLI returned an invalid catalog');
        // Identity/aliases are not exports, signatures, approval or acquisition.
        // Preserve the kernel result, including null and future unknown facts.
        return response(envelope.result);
      }).catch(() => unavailable('E_CLI_FAILED', 'The installed OATS CLI catalog read failed'))
        .finally(() => pending.delete(key));
      pending.set(key, read);
    }
    return pending.get(key);
  };
}

export const catalogRequest = createCatalogBoundary();

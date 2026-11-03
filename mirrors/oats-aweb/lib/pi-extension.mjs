// The skills bundled with the aweb pi extension.
//
// @awebai/pi declares `"pi": {"skills": ["./skills"]}` next to its extension,
// so a plain `pi install npm:@awebai/pi` makes pi load those skills in every
// session that uses that pi folder. OATS hands a home its skills through its
// capabilities only, so the extension's settings entry filters them out with
// pi's object form, {"source": "npm:@awebai/pi", "skills": []} (pi's
// docs/packages.md, "Select package resources"). Checked with pi 1.3.0 and
// @awebai/pi 0.4.0: the filtered entry still loads the extension and none of
// its skills, and a later `pi install` or `pi update` of the package keeps the
// filter (`pi install npm:@awebai/pi@latest` rewrites `source` and keeps
// `skills`). Interim, until aweb publishes the extension without skills.
import {readFileSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';

export const PI_EXTENSION = 'npm:@awebai/pi';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = value => typeof value === 'string' && value !== '' && isAbsolute(value) && !value.includes('\0');
/** The extension's source, with or without a version (`npm:@awebai/pi@0.4.0`). */
const extensionSource = value => typeof value === 'string' && (value === PI_EXTENSION || value.startsWith(`${PI_EXTENSION}@`));
const skillsFiltered = entry => Array.isArray(entry.skills) && entry.skills.length === 0;

/** The pi folder of the home's recorded launch, for a pi home only: its literal
 *  PI_CODING_AGENT_DIR (absolute, or under ~, which pi expands against HOME),
 *  else HOME's .pi/agent when the launch sets none. Unknown (undefined) for
 *  any other value, such as a {fromEnv} reference, for a home that is not on
 *  pi, or when the home has no launch record. */
export function recordedPiAgentDir(home, env = process.env) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')); } catch { return undefined; }
  if (!object(doc?.launch)) return undefined;
  const meta = object(doc.capabilityMeta?.['oats.aweb']) ? doc.capabilityMeta['oats.aweb'] : {};
  if ((doc.launch.harness ?? doc.harness ?? meta.runtime) !== 'pi') return undefined;
  const launchEnv = object(doc.launch.env) ? doc.launch.env : {};
  const userHome = absolute(env.HOME) ? env.HOME : undefined;
  if (!Object.hasOwn(launchEnv, 'PI_CODING_AGENT_DIR')) return userHome && join(userHome, '.pi', 'agent');
  const dir = launchEnv.PI_CODING_AGENT_DIR;
  if (typeof dir === 'string' && /^~(?=$|\/)/.test(dir)) return userHome && join(userHome, dir.slice(1));
  return absolute(dir) ? dir : undefined;
}

/** The pi-extension-skills-loaded warning for `agentDir`, or nothing: the
 *  folder's settings.json lists the aweb extension as a plain string or as an
 *  object without `"skills": []`. A missing, unreadable or malformed file, or
 *  one that does not list the extension, says nothing. */
export function piExtensionSkillsWarning(agentDir) {
  if (!agentDir) return undefined;
  const file = join(agentDir, 'settings.json');
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
  if (!object(doc) || !Array.isArray(doc.packages)) return undefined;
  for (const entry of doc.packages) {
    let edit;
    if (extensionSource(entry)) edit = `replace the entry ${JSON.stringify(entry)} with ${JSON.stringify({source: entry, skills: []})}`;
    else if (object(entry) && extensionSource(entry.source) && !skillsFiltered(entry)) edit = `set "skills": [] in the entry whose "source" is ${JSON.stringify(entry.source)}`;
    else continue;
    return {code: 'pi-extension-skills-loaded', message: `pi loads the skills bundled with the aweb pi extension in every session that uses ${agentDir}: its settings.json lists ${JSON.stringify(PI_EXTENSION)} without a skills filter, and OATS gives a home its skills through its capabilities only. In ${file}, ${edit}, keeping the other entries; the extension still loads, and pi install and pi update keep the filter`};
  }
  return undefined;
}

import test from "node:test";
import assert from "node:assert/strict";
import { compileCapturedLaunchRequest } from "../lib/captured-launch-request.mjs";
import { applicableRequirements } from "../lib/core.mjs";

// Captured launch compilation over aweb-shaped runtime requirements. Data-only: no host probe,
// no package discovery, no launch.
const AWEB = { capability: "oats.aweb", layer: "messaging", requires: [
  { runtime: "pi", package: "npm:@awebai/pi", when: { delivery: "channel" }, install: "pi install npm:@awebai/pi" },
  { runtime: "pi", package: "npm:@awebai/pi", minVersion: "0.3.10", when: { delivery: "session" }, ifInstalled: true, install: "pi install npm:@awebai/pi@latest" },
] };
const kernel = { validateLaunchConfig: () => {}, runtimeRequirements: applicableRequirements };
const env = settings => ({ artifacts: { capabilities: { "oats.aweb": {} } }, manifests: new Map([["oats.aweb", AWEB]]), settings: { "oats.aweb": settings }, resources: {} });
const request = { runtime: "pi", executable: "/host/bin/pi", args: [], env: {}, model: "m", yolo: false };

test("an ifInstalled runtime floor is satisfied by absence: session + Pi compiles", () => {
  // Second-operator finding (2026-09-21): this row made every Pi + aweb session launch unpublishable.
  const compiled = compileCapturedLaunchRequest(request, env({ delivery: "session" }), kernel);
  assert.equal(compiled.executable, "/host/bin/pi");
  assert.equal(compiled.executableResolvedFrom, "explicit-host");
});

test("a hard runtime requirement refuses through the attributed problem shape", () => {
  let error;
  try { compileCapturedLaunchRequest(request, env({ delivery: "channel" }), kernel); } catch (e) { error = e; }
  assert.equal(error?.code, "needs-configuration");
  assert.deepEqual(error.problems, [{ code: "needs-configuration",
    message: "pi launch requires runtime package npm:@awebai/pi, which captured preparation has not retained",
    capability: "oats.aweb", slot: "messaging", runtime: "pi", package: "npm:@awebai/pi", install: "pi install npm:@awebai/pi" }]);
});

test("the remedy is the manifest's declared install text, never operator or host values", () => {
  let error;
  try { compileCapturedLaunchRequest({ ...request, executable: "/secret/host/path/pi", env: {} }, env({ delivery: "channel" }), kernel); } catch (e) { error = e; }
  const text = JSON.stringify(error.problems);
  assert.equal(text.includes("/secret/host/path"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createHarnessServer } from "../renderer/harness-server.mjs";

// The harness page resolves marked/dompurify via /node_modules/* — the route
// must serve browser-ready ESM and stay traversal-guarded.
test("harness-server: serves renderer files and /node_modules ESM, guards traversal", async () => {
  const server = createHarnessServer(new URL("http://127.0.0.1:1")); // api unused here
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const get = (p, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { headers });
  try {
    assert.equal((await get("/")).status, 200, "harness page serves");
    assert.equal((await get("/views/markdown.mjs")).status, 200, "view module serves");
    assert.equal((await get("/identity-marks.mjs")).status, 200, "identity component serves");
    const colors = await get("/soul-colors.mjs");
    assert.equal(colors.status, 200, "shared pure color module uses the existing renderer static root");
    assert.match(await colors.text(), /export const SOUL_COLORS/);
    const marked = await get("/node_modules/marked/lib/marked.esm.js");
    assert.equal(marked.status, 200, "marked ESM serves through /node_modules");
    assert.ok((marked.headers.get("content-type") || "").includes("text/javascript"), "ESM content-type");
    assert.equal((await get("/node_modules/dompurify/dist/purify.es.mjs")).status, 200, "dompurify ESM serves");
    assert.equal((await get("/node_modules/%2e%2e/package.json")).status, 404, "encoded traversal out of node_modules rejected");
    assert.equal((await get("/%2e%2e/package.json")).status, 404, "encoded traversal out of renderer rejected");
    // A renderer module that moved to the shared home (packages/client) left a re-export of
    // ../../client/x.mjs. The renderer is this server's root, so the browser clamps that to /client/x.mjs.
    const shim = await get("/harness-names.mjs");
    assert.equal(await shim.text(), 'export * from "../../client/harness-names.mjs";\n');
    const shared = new URL("../../client/harness-names.mjs", `http://127.0.0.1:${port}/harness-names.mjs`);
    assert.equal(shared.pathname, "/client/harness-names.mjs");
    const moved = await get(shared.pathname);
    assert.equal(moved.status, 200, "the shared home serves through /client");
    assert.ok((moved.headers.get("content-type") || "").includes("text/javascript"), "ESM content-type");
    assert.match(await moved.text(), /export const HARNESSES/);
    assert.equal((await get("/client/%2e%2e/desktop/package.json")).status, 404, "encoded traversal out of the shared home rejected");
    // fetch cannot forge Host — raw request for the rebinding case
    const hostile = await new Promise((resolve, reject) => {
      const rq = httpRequest({ host: "127.0.0.1", port, path: "/", headers: { host: "evil.example" } }, (rs) => resolve(rs.statusCode));
      rq.on("error", reject); rq.end();
    });
    assert.equal(hostile, 403, "hostile Host rejected");
  } finally { server.close(); }
});

// The whole-workspace example in docs/packages.md (marked `<!-- catalog-pins -->`)
// pins the current official packages by bare version. A catalog pin round must
// update it in the same change, so it can never teach a version the catalog
// has moved past.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bare = (v) => String(v).replace(/^v/, "");

test("docs/packages.md catalog-pins example matches package-catalog.json", () => {
  const doc = readFileSync(join(ROOT, "docs", "packages.md"), "utf8");
  const blocks = [...doc.matchAll(/<!-- catalog-pins -->\n```yaml\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1, "docs/packages.md must carry exactly one <!-- catalog-pins --> YAML example");
  const pins = parse(blocks[0][1]).packages;
  assert.ok(pins && Object.keys(pins).length, "the catalog-pins example declares packages");
  const catalog = JSON.parse(readFileSync(join(ROOT, "package-catalog.json"), "utf8")).packages;
  for (const [id, version] of Object.entries(pins)) {
    assert.ok(Object.hasOwn(catalog, id), `${id} is pinned by bare version but is not in package-catalog.json`);
    // The catalog ref carries the tag convention (`v2.1.5`, `oats-framework/v1.1.3`).
    assert.equal(bare(version), bare(catalog[id].ref.split("/").pop()), `${id}: the example pins ${version}, the catalog ${catalog[id].ref}`);
  }
});

// rep.cjs <file> <pairs.json>: each pair [old, new] must match exactly once.
const fs = require("fs");
module.exports = (file, pairs) => { let t = fs.readFileSync(file, "utf8"); for (const [a, b] of pairs) { const n = t.split(a).length - 1; if (n !== 1) throw new Error(`${file}: ${n} matches for: ${a.slice(0, 90)}`); t = t.replace(a, () => b); } fs.writeFileSync(file, t); };

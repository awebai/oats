// Bounded keyset enumeration using the SQLite API available at Node 22.5.
// Statement.iterate() requires 22.13; OFFSET paging would rescan old prefixes.
// Callers supply a SELECT with one unique, non-null text ordering key.
export function* keysetRows(db, sql, key, parameters = []) {
  if (!/^[a-z_]+$/.test(key)) throw new Error("invalid internal SQLite ordering key");
  const order = `"${key}"`;
  const first = db.prepare(`SELECT * FROM (${sql}) ORDER BY ${order} LIMIT 128`);
  const next = db.prepare(`SELECT * FROM (${sql}) WHERE ${order} > ? ORDER BY ${order} LIMIT 128`);
  let rows = first.all(...parameters);
  while (rows.length) {
    yield* rows;
    rows = next.all(...parameters, rows[rows.length - 1][key]);
  }
}

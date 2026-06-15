const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function query(text, params) {
  return pool.query(text, params);
}

// Translate SQLite-style "?" placeholders into Postgres "$1, $2, ..." in order.
// Lets us reuse the existing SQL strings with minimal changes during the cutover.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

// better-sqlite3-style helpers, backed by Postgres (async).
//   db.prepare(sql).all(a, b)  ->  await pgAll(sql, [a, b])
//   db.prepare(sql).get(a)     ->  await pgGet(sql, [a])
//   db.prepare(sql).run(a, b)  ->  await pgRun(sql, [a, b])   ({ rowCount, rows })
async function pgAll(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return r.rows;
}
async function pgGet(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return r.rows[0];
}
async function pgRun(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return { rowCount: r.rowCount, rows: r.rows };
}

module.exports = { pool, query, toPg, pgAll, pgGet, pgRun };

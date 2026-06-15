// Compare row counts between the local SQLite DB and the Supabase Postgres DB,
// so we can confirm the migration is complete. Read-only, safe to run anytime.
//   Usage: node scripts/check-counts.js
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { query, pool } = require('../database/db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'database');
const sqlite = new Database(path.join(DATA_DIR, 'edu_database.db'), { readonly: true });

const TABLES = [
  'users', 'resource_categories', 'teacher_profiles', 'nav_buttons', 'resources',
  'photos', 'albums', 'videos', 'posts', 'slider_settings', 'access_logs',
  'chatbox_links', 'site_settings',
];

function sqliteCount(t) {
  try { return sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; }
  catch (e) { return `(n/a: ${e.message})`; }
}
async function pgCount(t) {
  try { return Number((await query(`SELECT COUNT(*) AS c FROM ${t}`)).rows[0].c); }
  catch (e) { return `(n/a: ${e.message})`; }
}

(async () => {
  console.log('\n  TABLE                 SQLite   ->   Supabase');
  console.log('  ------------------------------------------------');
  for (const t of TABLES) {
    const s = sqliteCount(t);
    const p = await pgCount(t);
    const flag = (typeof s === 'number' && typeof p === 'number' && p < s) ? '  ⚠️ THIẾU' : '';
    console.log(`  ${t.padEnd(20)} ${String(s).padStart(6)}   ->   ${String(p).padStart(6)}${flag}`);
  }
  console.log('');
  sqlite.close();
  await pool.end();
})();

// One-time migration: copy data from the legacy SQLite database (database/edu_database.db)
// into the new Supabase Postgres database. Idempotent (ON CONFLICT (id) DO NOTHING) and
// preserves primary key IDs, then realigns each table's SERIAL sequence afterward.
//
// Usage: node scripts/migrate-sqlite-to-postgres.js
// Requires DATABASE_URL (Supabase) in .env. Reads the SQLite file via better-sqlite3 (read-only).

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { query, pool } = require('../database/db');
const { initPostgresDatabase } = require('../database/pgSchema');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'database');
const sqlite = new Database(path.join(DATA_DIR, 'edu_database.db'), { readonly: true });

// Tables with a SERIAL `id` primary key, in FK-safe insert order.
// resource_categories has a self-referencing parent_id, handled in a second pass.
const ID_TABLES = [
  'users',
  'resource_categories',
  'teacher_profiles',
  'nav_buttons',
  'resources',
  'photos',
  'albums',
  'videos',
  'posts',
  'slider_settings',
  'access_logs',
  'chatbox_links',
];

async function migrateIdTable(table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  // resource_categories.parent_id is filled in a second pass to avoid FK ordering issues
  const insertColumns = table === 'resource_categories' ? columns.filter(c => c !== 'parent_id') : columns;
  const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${insertColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;

  let inserted = 0;
  for (const row of rows) {
    const values = insertColumns.map(c => row[c]);
    const result = await query(sql, values);
    inserted += result.rowCount;
  }

  if (table === 'resource_categories') {
    for (const row of rows) {
      if (row.parent_id != null) {
        await query('UPDATE resource_categories SET parent_id = $1 WHERE id = $2', [row.parent_id, row.id]);
      }
    }
  }

  // Realign the SERIAL sequence so future inserts don't collide with migrated IDs
  await query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
    [table]
  );

  return inserted;
}

async function migrateSiteSettings() {
  const rows = sqlite.prepare(`SELECT * FROM site_settings`).all();
  let inserted = 0;
  for (const row of rows) {
    const result = await query(
      `INSERT INTO site_settings (key, value, description) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [row.key, row.value, row.description]
    );
    inserted += result.rowCount;
  }
  return inserted;
}

async function main() {
  await initPostgresDatabase();

  for (const table of ID_TABLES) {
    const n = await migrateIdTable(table);
    console.log(`  ${table}: ${n} rows inserted`);
  }
  const settingsN = await migrateSiteSettings();
  console.log(`  site_settings: ${settingsN} rows inserted`);

  console.log('✅ Migration complete');
}

main()
  .catch(err => {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    sqlite.close();
    await pool.end();
  });

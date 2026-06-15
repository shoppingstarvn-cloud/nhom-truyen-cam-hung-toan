const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };

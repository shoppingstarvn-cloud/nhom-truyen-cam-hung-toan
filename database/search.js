// Smart Search index + analytics, backed by Postgres (Supabase).
// Replaces the legacy SQLite FTS5 implementation. Accent-insensitive search is
// achieved via a pre-computed `normalized` column (diacritics stripped) + pg_trgm.
const { query, pgAll, pgGet, pgRun } = require('./db');

// Strip Vietnamese diacritics + lowercase, for accent-insensitive search
function normalizeText(str) {
  if (!str) return '';
  return str
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function initSearchIndex() {
  await query(`
    CREATE TABLE IF NOT EXISTS search_index (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      rowref INTEGER NOT NULL,
      title TEXT,
      body TEXT,
      normalized TEXT,
      image TEXT,
      url TEXT,
      access_level TEXT DEFAULT 'public',
      UNIQUE(type, rowref)
    );

    CREATE TABLE IF NOT EXISTS search_analytics (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      query TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      intent TEXT,
      result_clicked_id TEXT,
      result_clicked_type TEXT,
      result_position INTEGER,
      time_to_click_ms INTEGER,
      used_ai_assistant INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_search_analytics_normalized_query ON search_analytics(normalized_query);

    CREATE TABLE IF NOT EXISTS search_query_boost (
      normalized_query TEXT NOT NULL,
      result_type TEXT NOT NULL,
      result_id TEXT NOT NULL,
      boost_score DOUBLE PRECISION DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (normalized_query, result_type, result_id)
    );
  `);

  // Trigram index for fast accent-insensitive LIKE '%...%' search. Best-effort:
  // if the pg_trgm extension can't be created, plain LIKE still works (just slower).
  try {
    await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await query(`CREATE INDEX IF NOT EXISTS idx_search_index_normalized_trgm ON search_index USING gin (normalized gin_trgm_ops)`);
  } catch (e) {
    console.warn('⚠️  pg_trgm không khả dụng, tìm kiếm dùng LIKE thường:', e.message);
  }
}

// Source table fetchers, one per searchable "type"
const FETCHERS = {
  resource: id => pgGet('SELECT * FROM resources WHERE id = ?', [id]),
  post: id => pgGet('SELECT * FROM posts WHERE id = ?', [id]),
  video: id => pgGet('SELECT * FROM videos WHERE id = ?', [id]),
  teacher: id => pgGet('SELECT * FROM teacher_profiles WHERE id = ?', [id]),
  album: id => pgGet('SELECT * FROM albums WHERE id = ?', [id]),
  category: id => pgGet('SELECT * FROM resource_categories WHERE id = ?', [id]),
  chatbox: id => pgGet('SELECT * FROM chatbox_links WHERE id = ?', [id]),
  nav: id => pgGet('SELECT * FROM nav_buttons WHERE id = ?', [id]),
};

function isRowActive(type, row) {
  if (!row) return false;
  if (type === 'teacher') return row.is_public !== 0;
  if ('is_active' in row) return row.is_active !== 0;
  return true;
}

function buildEntry(type, row) {
  let title, body, image = null, url = '#', access_level = row.access_level || 'public';
  switch (type) {
    case 'resource':
      title = row.title;
      body = [row.description, row.tags].filter(Boolean).join(' ');
      image = row.thumbnail;
      url = `/#resources`;
      break;
    case 'post':
      title = row.title;
      body = [row.excerpt, row.content].filter(Boolean).join(' ');
      image = row.featured_image;
      url = `/#news`;
      break;
    case 'video':
      title = row.title;
      body = row.description || '';
      image = row.thumbnail;
      url = `/#videos`;
      break;
    case 'teacher':
      title = row.display_name;
      body = [row.title, row.subject, row.school, row.bio, row.achievements].filter(Boolean).join(' ');
      image = row.avatar;
      url = `/#teachers`;
      access_level = 'public';
      break;
    case 'album':
      title = row.name;
      body = row.description || '';
      image = row.cover_photo;
      url = `/#gallery`;
      break;
    case 'category':
      title = row.name;
      body = row.description || '';
      url = `/#resources`;
      break;
    case 'chatbox':
      title = row.title;
      body = row.description || '';
      url = '#';
      break;
    case 'nav':
      title = row.label;
      body = row.description || '';
      url = row.url || '#';
      break;
  }
  const normalized = normalizeText([title, body].filter(Boolean).join(' '));
  return { type, rowref: row.id, title, body, normalized, image: image || null, url, access_level };
}

// Re-fetch a single source row and sync it into the search index (insert/update/remove)
async function syncSearchEntry(type, id) {
  const fetcher = FETCHERS[type];
  if (!fetcher) return;
  const row = await fetcher(id);
  if (!isRowActive(type, row)) {
    await pgRun('DELETE FROM search_index WHERE type = ? AND rowref = ?', [type, id]);
    return;
  }
  const e = buildEntry(type, row);
  await pgRun(
    `INSERT INTO search_index (type, rowref, title, body, normalized, image, url, access_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (type, rowref) DO UPDATE SET
       title=excluded.title, body=excluded.body, normalized=excluded.normalized,
       image=excluded.image, url=excluded.url, access_level=excluded.access_level`,
    [e.type, e.rowref, e.title, e.body, e.normalized, e.image, e.url, e.access_level]
  );
}

// Full rebuild from all source tables (run on startup to guarantee consistency)
async function rebuildSearchIndex() {
  await pgRun('DELETE FROM search_index');
  const sources = {
    resource: 'SELECT id FROM resources',
    post: 'SELECT id FROM posts',
    video: 'SELECT id FROM videos',
    teacher: 'SELECT id FROM teacher_profiles',
    album: 'SELECT id FROM albums',
    category: 'SELECT id FROM resource_categories',
    chatbox: 'SELECT id FROM chatbox_links',
    nav: 'SELECT id FROM nav_buttons',
  };
  for (const [type, sql] of Object.entries(sources)) {
    const rows = await pgAll(sql);
    for (const r of rows) await syncSearchEntry(type, r.id);
  }
}

// Return candidate index rows whose `normalized` text contains ALL query terms.
async function searchRows(normalizedQuery, type = 'all', limit = 300) {
  const terms = normalizedQuery.split(' ').filter(Boolean);
  if (terms.length === 0) return [];
  const where = terms.map(() => 'normalized LIKE ?').join(' AND ');
  const params = terms.map(t => `%${t}%`);
  let sql = `SELECT type, rowref, title, body, normalized, image, url, access_level FROM search_index WHERE ${where}`;
  if (type !== 'all') { sql += ' AND type = ?'; params.push(type); }
  sql += ` LIMIT ${Number(limit) || 300}`;
  return pgAll(sql, params);
}

// ==================== Continuous Learning (Phase 3) ====================
async function trackSearchEvent({ session_id, query: q, intent, result_id, result_type, position, time_to_click_ms, used_ai_assistant }) {
  await pgRun(
    `INSERT INTO search_analytics
       (session_id, query, normalized_query, intent, result_clicked_id, result_clicked_type, result_position, time_to_click_ms, used_ai_assistant)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session_id || null,
      q || '',
      normalizeText(q),
      intent || null,
      result_id != null ? String(result_id) : null,
      result_type || null,
      position != null ? Number(position) : null,
      time_to_click_ms != null ? Number(time_to_click_ms) : null,
      used_ai_assistant ? 1 : 0,
    ]
  );
}

// Recompute boost_score = log(1 + click_count) * recency_factor / sqrt(avg_position)
// recency_factor decays clicks older than 30 days (half-life ~30 days)
async function recalculateBoosts() {
  const rows = await pgAll(`
    SELECT
      normalized_query,
      result_clicked_type AS result_type,
      result_clicked_id AS result_id,
      COUNT(*) AS click_count,
      AVG(result_position) AS avg_position,
      AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0) AS avg_age_days
    FROM search_analytics
    WHERE result_clicked_id IS NOT NULL AND result_clicked_type IS NOT NULL AND normalized_query != ''
    GROUP BY normalized_query, result_clicked_type, result_clicked_id
  `);

  for (const r of rows) {
    const clickCount = Number(r.click_count) || 0;
    const avgAge = Number(r.avg_age_days) || 0;
    const recencyFactor = Math.pow(0.5, avgAge / 30);
    const avgPos = Math.max(1, Number(r.avg_position) || 1);
    const boostScore = Math.log(1 + clickCount) * recencyFactor / Math.sqrt(avgPos);
    await pgRun(
      `INSERT INTO search_query_boost (normalized_query, result_type, result_id, boost_score, click_count, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON CONFLICT (normalized_query, result_type, result_id) DO UPDATE SET
         boost_score = excluded.boost_score,
         click_count = excluded.click_count,
         updated_at = NOW()`,
      [r.normalized_query, r.result_type, r.result_id, boostScore, clickCount]
    );
  }
  return rows.length;
}

async function getBoostMap(normalizedQuery) {
  const rows = await pgAll(
    `SELECT result_type, result_id, boost_score FROM search_query_boost WHERE normalized_query = ?`,
    [normalizedQuery]
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.result_type}:${r.result_id}`, Number(r.boost_score));
  return map;
}

module.exports = {
  normalizeText, initSearchIndex, rebuildSearchIndex, syncSearchEntry,
  searchRows, trackSearchEvent, recalculateBoosts, getBoostMap,
};

const { db } = require('./schema');

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

function initSearchIndex() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    -- Continuous Learning (Phase 3)
    CREATE TABLE IF NOT EXISTS search_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      query TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      intent TEXT,
      result_clicked_id TEXT,
      result_clicked_type TEXT,
      result_position INTEGER,
      time_to_click_ms INTEGER,
      used_ai_assistant INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_search_analytics_normalized_query ON search_analytics(normalized_query);

    CREATE TABLE IF NOT EXISTS search_query_boost (
      normalized_query TEXT NOT NULL,
      result_type TEXT NOT NULL,
      result_id TEXT NOT NULL,
      boost_score REAL DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (normalized_query, result_type, result_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      title, body, normalized,
      content='search_index', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
      INSERT INTO search_fts(rowid, title, body, normalized) VALUES (new.id, new.title, new.body, new.normalized);
    END;
    CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
      INSERT INTO search_fts(search_fts, rowid, title, body, normalized) VALUES ('delete', old.id, old.title, old.body, old.normalized);
    END;
    CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
      INSERT INTO search_fts(search_fts, rowid, title, body, normalized) VALUES ('delete', old.id, old.title, old.body, old.normalized);
      INSERT INTO search_fts(rowid, title, body, normalized) VALUES (new.id, new.title, new.body, new.normalized);
    END;
  `);
}

initSearchIndex();

const upsertStmt = db.prepare(`
  INSERT INTO search_index (type, rowref, title, body, normalized, image, url, access_level)
  VALUES (@type, @rowref, @title, @body, @normalized, @image, @url, @access_level)
  ON CONFLICT(type, rowref) DO UPDATE SET
    title=excluded.title, body=excluded.body, normalized=excluded.normalized,
    image=excluded.image, url=excluded.url, access_level=excluded.access_level
`);
const deleteStmt = db.prepare(`DELETE FROM search_index WHERE type = ? AND rowref = ?`);

// Source table fetchers, one per searchable "type"
const FETCHERS = {
  resource: id => db.prepare('SELECT * FROM resources WHERE id = ?').get(id),
  post: id => db.prepare('SELECT * FROM posts WHERE id = ?').get(id),
  video: id => db.prepare('SELECT * FROM videos WHERE id = ?').get(id),
  teacher: id => db.prepare('SELECT * FROM teacher_profiles WHERE id = ?').get(id),
  album: id => db.prepare('SELECT * FROM albums WHERE id = ?').get(id),
  category: id => db.prepare('SELECT * FROM resource_categories WHERE id = ?').get(id),
  chatbox: id => db.prepare('SELECT * FROM chatbox_links WHERE id = ?').get(id),
  nav: id => db.prepare('SELECT * FROM nav_buttons WHERE id = ?').get(id),
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
function syncSearchEntry(type, id) {
  const fetcher = FETCHERS[type];
  if (!fetcher) return;
  const row = fetcher(id);
  if (!isRowActive(type, row)) {
    deleteStmt.run(type, id);
    return;
  }
  upsertStmt.run(buildEntry(type, row));
}

// Full rebuild from all source tables (run on startup to guarantee consistency)
function rebuildSearchIndex() {
  db.exec('DELETE FROM search_index');
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
    for (const r of db.prepare(sql).all()) syncSearchEntry(type, r.id);
  }
}

// ==================== Continuous Learning (Phase 3) ====================
const trackStmt = db.prepare(`
  INSERT INTO search_analytics
    (session_id, query, normalized_query, intent, result_clicked_id, result_clicked_type, result_position, time_to_click_ms, used_ai_assistant)
  VALUES (@session_id, @query, @normalized_query, @intent, @result_clicked_id, @result_clicked_type, @result_position, @time_to_click_ms, @used_ai_assistant)
`);

function trackSearchEvent({ session_id, query, intent, result_id, result_type, position, time_to_click_ms, used_ai_assistant }) {
  trackStmt.run({
    session_id: session_id || null,
    query: query || '',
    normalized_query: normalizeText(query),
    intent: intent || null,
    result_clicked_id: result_id != null ? String(result_id) : null,
    result_clicked_type: result_type || null,
    result_position: position != null ? Number(position) : null,
    time_to_click_ms: time_to_click_ms != null ? Number(time_to_click_ms) : null,
    used_ai_assistant: used_ai_assistant ? 1 : 0,
  });
}

const boostUpsertStmt = db.prepare(`
  INSERT INTO search_query_boost (normalized_query, result_type, result_id, boost_score, click_count, updated_at)
  VALUES (@normalized_query, @result_type, @result_id, @boost_score, @click_count, CURRENT_TIMESTAMP)
  ON CONFLICT(normalized_query, result_type, result_id) DO UPDATE SET
    boost_score = @boost_score,
    click_count = @click_count,
    updated_at = CURRENT_TIMESTAMP
`);

// Recompute boost_score = log(1 + click_count) * recency_factor / sqrt(avg_position)
// recency_factor decays clicks older than 30 days (half-life ~30 days)
function recalculateBoosts() {
  const rows = db.prepare(`
    SELECT
      normalized_query,
      result_clicked_type AS result_type,
      result_clicked_id AS result_id,
      COUNT(*) AS click_count,
      AVG(result_position) AS avg_position,
      AVG((julianday('now') - julianday(created_at))) AS avg_age_days
    FROM search_analytics
    WHERE result_clicked_id IS NOT NULL AND result_clicked_type IS NOT NULL AND normalized_query != ''
    GROUP BY normalized_query, result_clicked_type, result_clicked_id
  `).all();

  const tx = db.transaction((items) => {
    for (const r of items) {
      const recencyFactor = Math.pow(0.5, (r.avg_age_days || 0) / 30);
      const avgPos = Math.max(1, r.avg_position || 1);
      const boostScore = Math.log(1 + r.click_count) * recencyFactor / Math.sqrt(avgPos);
      boostUpsertStmt.run({
        normalized_query: r.normalized_query,
        result_type: r.result_type,
        result_id: r.result_id,
        boost_score: boostScore,
        click_count: r.click_count,
      });
    }
  });
  tx(rows);
  return rows.length;
}

function getBoostMap(normalizedQuery) {
  const rows = db.prepare(`SELECT result_type, result_id, boost_score FROM search_query_boost WHERE normalized_query = ?`).all(normalizedQuery);
  const map = new Map();
  for (const r of rows) map.set(`${r.result_type}:${r.result_id}`, r.boost_score);
  return map;
}

module.exports = { normalizeText, initSearchIndex, rebuildSearchIndex, syncSearchEntry, trackSearchEvent, recalculateBoosts, getBoostMap };

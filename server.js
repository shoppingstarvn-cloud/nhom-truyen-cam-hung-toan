require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { randomUUID: uuidv4 } = require('crypto');
const { query, pgAll, pgGet, pgRun } = require('./database/db');
const { initPostgresDatabase } = require('./database/pgSchema');
const {
  normalizeText, initSearchIndex, rebuildSearchIndex, syncSearchEntry,
  searchRows, trackSearchEvent, recalculateBoosts, getBoostMap,
} = require('./database/search');
const { uploadBuffer, isConfigured: storageConfigured } = require('./database/storage');
const cron = require('node-cron');
const { analyzeQuery, explainResults } = require('./services/aiSearch');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'edu_secret_key_2024_nexus';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Uploads go to Supabase Storage (Koyeb has no persistent disk). Files are kept
// in memory just long enough to forward them to the storage bucket.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Upload a single multer (memory) file to Supabase Storage and return its public URL.
async function storeUpload(folder, file) {
  if (!file) return null;
  return uploadBuffer(folder, file.originalname, file.buffer, file.mimetype);
}

// Auth Middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) { req.user = null; return next(); }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch { req.user = null; }
  next();
}

function requireAuth(roles = []) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Không có quyền truy cập' });
    next();
  };
}

const ROLE_LEVEL = { public: 0, student: 1, teacher: 2, admin2: 3, admin1: 4, superadmin: 5 };
function hasAccess(userRole, requiredLevel) {
  const userLvl = ROLE_LEVEL[userRole] ?? 0;
  const reqLvl = ROLE_LEVEL[requiredLevel] ?? 0;
  return userLvl >= reqLvl;
}

// Wrap async route handlers so rejected promises become 500s instead of hanging.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(authMiddleware);

// ==================== AUTH ====================

// ---- CAPTCHA (self-hosted SVG) ----
const captchaStore = new Map(); // id -> { code, expires }
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCaptchaSvg(code) {
  const colors = ['#1e3a5f', '#7c3aed', '#dc2626', '#059669', '#d97706'];
  let chars = '';
  for (let i = 0; i < code.length; i++) {
    const x = 16 + i * 27 + (Math.random() * 6 - 3);
    const y = 30 + (Math.random() * 8 - 4);
    const rot = (Math.random() * 40 - 20).toFixed(0);
    const c = colors[Math.floor(Math.random() * colors.length)];
    chars += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" font-size="26" font-weight="bold" font-family="Verdana, sans-serif" fill="${c}">${code[i]}</text>`;
  }
  let noise = '';
  for (let i = 0; i < 5; i++) {
    noise += `<line x1="${(Math.random() * 160).toFixed(0)}" y1="${(Math.random() * 44).toFixed(0)}" x2="${(Math.random() * 160).toFixed(0)}" y2="${(Math.random() * 44).toFixed(0)}" stroke="#94a3b8" stroke-width="1" opacity="0.6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="44" style="background:#f1f5f9;border-radius:8px">${noise}${chars}</svg>`;
}

app.get('/api/auth/captcha', (req, res) => {
  // prune expired
  const now = Date.now();
  for (const [k, v] of captchaStore) if (v.expires < now) captchaStore.delete(k);
  let code = '';
  for (let i = 0; i < 5; i++) code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  const id = uuidv4();
  captchaStore.set(id, { code, expires: now + 10 * 60 * 1000 });
  res.json({ id, svg: genCaptchaSvg(code) });
});

function verifyCaptcha(id, text) {
  if (!id || !text) return false;
  const entry = captchaStore.get(id);
  captchaStore.delete(id); // one-time use
  if (!entry || entry.expires < Date.now()) return false;
  return entry.code.toUpperCase() === String(text).trim().toUpperCase();
}

function signUserToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: '24h' });
}
function publicUser(user) {
  return {
    id: user.id, username: user.username, role: user.role, full_name: user.full_name,
    avatar: user.avatar, email: user.email, birth_date: user.birth_date, zalo_phone: user.zalo_phone,
    workplace: user.workplace, ward: user.ward, profile_completed: user.profile_completed
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password, captchaId, captchaText } = req.body;
  if (!verifyCaptcha(captchaId, captchaText))
    return res.status(400).json({ error: 'Mã captcha không đúng hoặc đã hết hạn' });
  const { rows } = await query('SELECT * FROM users WHERE username = $1 AND is_active = 1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  res.json({ token: signUserToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  const { rows } = await query(
    'SELECT id, username, full_name, email, role, avatar, bio, birth_date, zalo_phone, workplace, ward, profile_completed FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json(rows[0]);
});

const PROFILE_FIELDS = ['full_name', 'birth_date', 'zalo_phone', 'email', 'user_type', 'workplace', 'ward'];
function validateProfile(body) {
  for (const f of PROFILE_FIELDS) {
    if (!body[f] || !String(body[f]).trim()) return `Vui lòng nhập đầy đủ thông tin bắt buộc`;
  }
  if (!['teacher', 'student'].includes(body.user_type)) return 'Vui lòng chọn Giáo viên hoặc Học sinh';
  if (!/^\S+@\S+\.\S+$/.test(body.email)) return 'Email không hợp lệ';
  if (!/^0\d{8,10}$/.test(String(body.zalo_phone).replace(/\s/g, ''))) return 'Số điện thoại Zalo không hợp lệ';
  return null;
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || String(username).trim().length < 4) return res.status(400).json({ error: 'Tên đăng nhập tối thiểu 4 ký tự' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  const pErr = validateProfile(req.body);
  if (pErr) return res.status(400).json({ error: pErr });
  const { full_name, birth_date, zalo_phone, email, user_type, workplace, ward } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const inserted = await query(`
      INSERT INTO users (username, password, full_name, email, role, birth_date, zalo_phone, workplace, ward, profile_completed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING id
    `, [String(username).trim(), hash, full_name, email, user_type, birth_date, zalo_phone, workplace, ward]);
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [inserted.rows[0].id]);
    const user = rows[0];
    res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    console.error('register error:', e);
    res.status(500).json({ error: 'Lỗi đăng ký, vui lòng thử lại' });
  }
});

// ---- GOOGLE SIGN-IN (verify ID token server-side) ----
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Thiếu thông tin xác thực Google' });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Đăng nhập Google chưa được cấu hình' });
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'Xác minh Google thất bại' });
    const p = await r.json();
    if (p.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Token Google không hợp lệ' });
    if (p.email_verified !== 'true' && p.email_verified !== true) return res.status(401).json({ error: 'Email Google chưa được xác minh' });

    let user = (await query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [p.sub, p.email])).rows[0];
    if (user && !user.is_active) return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
    if (!user) {
      // create new account, pending profile completion
      let base = (p.email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 20) || 'user';
      let username = base, n = 0;
      while ((await query('SELECT id FROM users WHERE username = $1', [username])).rows.length) username = base + (++n);
      const randomPw = bcrypt.hashSync(uuidv4(), 10);
      const inserted = await query(`
        INSERT INTO users (username, password, full_name, email, role, avatar, google_id, profile_completed)
        VALUES ($1, $2, $3, $4, 'student', $5, $6, 0) RETURNING id
      `, [username, randomPw, p.name || '', p.email, p.picture || null, p.sub]);
      user = (await query('SELECT * FROM users WHERE id = $1', [inserted.rows[0].id])).rows[0];
    } else if (!user.google_id) {
      await query('UPDATE users SET google_id = $1 WHERE id = $2', [p.sub, user.id]);
    }
    res.json({ token: signUserToken(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi xác thực Google' });
  }
});

// ---- COMPLETE / UPDATE PROFILE ----
app.post('/api/auth/complete-profile', requireAuth(), async (req, res) => {
  const pErr = validateProfile(req.body);
  if (pErr) return res.status(400).json({ error: pErr });
  const { full_name, birth_date, zalo_phone, email, user_type, workplace, ward } = req.body;
  const me = (await query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
  if (!me) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
  // only switch role between student/teacher for normal users (never touch admin roles)
  const newRole = ['student', 'teacher'].includes(me.role) ? user_type : me.role;
  await query(`
    UPDATE users SET full_name=$1, birth_date=$2, zalo_phone=$3, email=$4, role=$5, workplace=$6, ward=$7, profile_completed=1 WHERE id=$8
  `, [full_name, birth_date, zalo_phone, email, newRole, workplace, ward, req.user.id]);
  const user = (await query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
  res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
});

// ==================== SITE SETTINGS ====================
app.get('/api/settings', wrap(async (req, res) => {
  const settings = await pgAll('SELECT key, value FROM site_settings');
  const obj = {};
  settings.forEach(s => obj[s.key] = s.value);
  obj.google_client_id = GOOGLE_CLIENT_ID; // public OAuth client id for Google Sign-In button
  res.json(obj);
}));

app.put('/api/settings', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await pgRun(`INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [k, v]);
  }
  res.json({ success: true });
}));

// ==================== SLIDER ====================
app.get('/api/slider/photos', wrap(async (req, res) => {
  const settings = await pgGet('SELECT * FROM slider_settings LIMIT 1');
  const max = parseInt(req.query.limit) || settings?.max_slides || 0;
  const sql = `SELECT * FROM photos WHERE is_slider = 1 AND is_active = 1 ORDER BY display_order ASC, id ASC${max > 0 ? ' LIMIT ' + max : ''}`;
  res.json(await pgAll(sql));
}));

app.get('/api/slider/settings', wrap(async (req, res) => {
  res.json(await pgGet('SELECT * FROM slider_settings LIMIT 1'));
}));

app.put('/api/slider/settings', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { auto_play, interval_ms, show_arrows, show_dots, max_slides } = req.body;
  await pgRun(`UPDATE slider_settings SET auto_play=?, interval_ms=?, show_arrows=?, show_dots=?, max_slides=?`,
    [auto_play ? 1 : 0, parseInt(interval_ms) || 4000, show_arrows ? 1 : 0, show_dots ? 1 : 0, parseInt(max_slides) || 0]);
  res.json({ success: true });
}));

// ==================== PHOTOS ====================
app.get('/api/photos', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const { album_id, limit = 50, offset = 0 } = req.query;
  let sql = `SELECT p.*, a.name as album_name FROM photos p LEFT JOIN albums a ON p.album_id = a.id WHERE p.is_active = 1`;
  const params = [];
  if (album_id) { sql += ` AND p.album_id = ?`; params.push(album_id); }
  const rows = await pgAll(sql + ` ORDER BY p.display_order, p.id DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
}));

app.get('/api/albums', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const albums = await pgAll(`SELECT a.*, (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.is_active = 1) as photo_count FROM albums a WHERE a.is_active = 1 ORDER BY a.display_order, a.event_date DESC`);
  res.json(albums.filter(a => hasAccess(userRole, a.access_level)));
}));

app.post('/api/photos/upload', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.array('photos', 50), wrap(async (req, res) => {
  const { album_id, access_level = 'public', is_slider = 0, title } = req.body;
  const inserted = [];
  for (const f of (req.files || [])) {
    const url = await storeUpload('photos', f);
    const r = await pgRun(`INSERT INTO photos (title, file_path, album_id, access_level, is_slider, uploaded_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [title || f.originalname, url, album_id || null, access_level, is_slider ? 1 : 0, req.user.id]);
    inserted.push(r.rows[0].id);
  }
  res.json({ success: true, ids: inserted });
}));

app.delete('/api/photos/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE photos SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

app.put('/api/photos/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { title, description, access_level, is_slider, display_order, album_id } = req.body;
  await pgRun(`UPDATE photos SET title=?, description=?, access_level=?, is_slider=?, display_order=?, album_id=? WHERE id=?`,
    [title, description, access_level, is_slider ? 1 : 0, display_order, album_id, req.params.id]);
  res.json({ success: true });
}));

// Albums CRUD
app.post('/api/albums', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { name, description, event_date, access_level = 'public' } = req.body;
  const r = await pgRun(`INSERT INTO albums (name, description, event_date, access_level) VALUES (?, ?, ?, ?) RETURNING id`,
    [name, description, event_date || null, access_level]);
  await syncSearchEntry('album', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/albums/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { name, description, event_date, access_level, display_order } = req.body;
  await pgRun(`UPDATE albums SET name=?, description=?, event_date=?, access_level=?, display_order=? WHERE id=?`,
    [name, description, event_date || null, access_level, display_order, req.params.id]);
  await syncSearchEntry('album', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/albums/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE albums SET is_active = 0 WHERE id = ?', [req.params.id]);
  await syncSearchEntry('album', req.params.id);
  res.json({ success: true });
}));

// ==================== VIDEOS ====================
app.get('/api/videos', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const { limit = 20, offset = 0 } = req.query;
  const videos = await pgAll(`SELECT * FROM videos WHERE is_active = 1 ORDER BY is_featured DESC, id DESC LIMIT ? OFFSET ?`, [Number(limit), Number(offset)]);
  res.json(videos.filter(v => hasAccess(userRole, v.access_level)));
}));

app.post('/api/videos', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), wrap(async (req, res) => {
  const { title, description, youtube_url, thumbnail, access_level = 'public', is_featured = 0 } = req.body;
  const r = await pgRun(`INSERT INTO videos (title, description, youtube_url, thumbnail, access_level, is_featured, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [title, description, youtube_url, thumbnail, access_level, is_featured ? 1 : 0, req.user.id]);
  await syncSearchEntry('video', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/videos/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { title, description, youtube_url, thumbnail, access_level, is_featured } = req.body;
  await pgRun(`UPDATE videos SET title=?, description=?, youtube_url=?, thumbnail=?, access_level=?, is_featured=? WHERE id=?`,
    [title, description, youtube_url, thumbnail, access_level, is_featured ? 1 : 0, req.params.id]);
  await syncSearchEntry('video', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/videos/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE videos SET is_active = 0 WHERE id = ?', [req.params.id]);
  await syncSearchEntry('video', req.params.id);
  res.json({ success: true });
}));

// ==================== NAV BUTTONS ====================
app.get('/api/nav-buttons', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const buttons = await pgAll(`SELECT * FROM nav_buttons WHERE is_active = 1 ORDER BY display_order, id`);
  res.json(buttons.filter(b => hasAccess(userRole, b.access_level)));
}));

app.post('/api/nav-buttons', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { label, icon, url, description, category, access_level, color, display_order } = req.body;
  const r = await pgRun(`INSERT INTO nav_buttons (label, icon, url, description, category, access_level, color, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [label, icon, url, description, category, access_level || 'public', color || '#2563eb', display_order || 0]);
  await syncSearchEntry('nav', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/nav-buttons/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { label, icon, url, description, category, access_level, color, display_order, is_active } = req.body;
  await pgRun(`UPDATE nav_buttons SET label=?, icon=?, url=?, description=?, category=?, access_level=?, color=?, display_order=?, is_active=? WHERE id=?`,
    [label, icon, url, description, category, access_level, color, display_order, is_active ? 1 : 0, req.params.id]);
  await syncSearchEntry('nav', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/nav-buttons/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('DELETE FROM nav_buttons WHERE id = ?', [req.params.id]);
  await syncSearchEntry('nav', req.params.id);
  res.json({ success: true });
}));

// ==================== RESOURCE CATEGORIES ====================
app.get('/api/resource-categories', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const cats = await pgAll(`SELECT * FROM resource_categories WHERE is_active = 1 ORDER BY display_order, id`);
  res.json(cats.filter(c => hasAccess(userRole, c.access_level)));
}));

app.post('/api/resource-categories', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { name, slug, description, icon, color, access_level, parent_id, display_order } = req.body;
  const r = await pgRun(`INSERT INTO resource_categories (name, slug, description, icon, color, access_level, parent_id, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [name, slug, description, icon, color, access_level || 'public', parent_id || null, display_order || 0]);
  await syncSearchEntry('category', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/resource-categories/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { name, slug, description, icon, color, access_level, display_order, is_active } = req.body;
  await pgRun(`UPDATE resource_categories SET name=?, slug=?, description=?, icon=?, color=?, access_level=?, display_order=?, is_active=? WHERE id=?`,
    [name, slug, description, icon, color, access_level, display_order, is_active ? 1 : 0, req.params.id]);
  await syncSearchEntry('category', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/resource-categories/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE resource_categories SET is_active = 0 WHERE id = ?', [req.params.id]);
  await syncSearchEntry('category', req.params.id);
  res.json({ success: true });
}));

// ==================== RESOURCES ====================
app.get('/api/resources', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const { category_id, search, limit = 30, offset = 0 } = req.query;
  let sql = `SELECT r.*, c.name as category_name, u.full_name as uploader_name FROM resources r LEFT JOIN resource_categories c ON r.category_id = c.id LEFT JOIN users u ON r.uploaded_by = u.id WHERE r.is_active = 1`;
  const params = [];
  if (category_id) { sql += ` AND r.category_id = ?`; params.push(category_id); }
  if (search) { sql += ` AND (r.title ILIKE ? OR r.description ILIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  const rows = await pgAll(sql + ` ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
}));

app.post('/api/resources/upload', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('file'), wrap(async (req, res) => {
  const { title, description, category_id, access_level = 'public', tags, external_url } = req.body;
  const filePath = await storeUpload('resources', req.file);
  const r = await pgRun(`INSERT INTO resources (title, description, category_id, file_path, file_type, file_size, external_url, access_level, tags, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [title, description, category_id || null, filePath, req.file?.mimetype, req.file?.size, external_url, access_level, tags, req.user.id]);
  await syncSearchEntry('resource', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/resources/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { title, description, access_level, tags, external_url, category_id } = req.body;
  await pgRun(`UPDATE resources SET title=?, description=?, access_level=?, tags=?, external_url=?, category_id=? WHERE id=?`,
    [title, description, access_level, tags, external_url, category_id || null, req.params.id]);
  await syncSearchEntry('resource', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/resources/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE resources SET is_active = 0 WHERE id = ?', [req.params.id]);
  await syncSearchEntry('resource', req.params.id);
  res.json({ success: true });
}));

app.get('/api/resources/:id/download', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const resource = await pgGet('SELECT * FROM resources WHERE id = ? AND is_active = 1', [req.params.id]);
  if (!resource) return res.status(404).json({ error: 'Không tìm thấy' });
  if (!hasAccess(userRole, resource.access_level)) return res.status(403).json({ error: 'Không có quyền truy cập' });
  await pgRun('UPDATE resources SET download_count = download_count + 1 WHERE id = ?', [req.params.id]);
  // file_path is now a Supabase Storage public URL; external_url is an external link.
  if (resource.file_path) return res.redirect(resource.file_path);
  if (resource.external_url) return res.redirect(resource.external_url);
  res.status(404).json({ error: 'Tài nguyên không có file' });
}));

// ==================== POSTS / NEWS ====================
app.get('/api/posts', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const { category, limit = 20, offset = 0 } = req.query;
  let sql = `SELECT p.*, u.full_name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.is_active = 1`;
  const params = [];
  if (category) { sql += ` AND p.category = ?`; params.push(category); }
  const rows = await pgAll(sql + ` ORDER BY p.is_pinned DESC, p.published_at DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
}));

app.post('/api/posts', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('featured_image'), wrap(async (req, res) => {
  const { title, content, excerpt, category = 'news', access_level = 'public', is_pinned = 0 } = req.body;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  const img = req.file ? await storeUpload('posts', req.file) : req.body.featured_image;
  const r = await pgRun(`INSERT INTO posts (title, slug, content, excerpt, featured_image, category, access_level, is_pinned, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [title, slug, content, excerpt, img, category, access_level, is_pinned ? 1 : 0, req.user.id]);
  await syncSearchEntry('post', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/posts/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { title, content, excerpt, category, access_level, is_pinned, featured_image } = req.body;
  await pgRun(`UPDATE posts SET title=?, content=?, excerpt=?, category=?, access_level=?, is_pinned=?, featured_image=? WHERE id=?`,
    [title, content, excerpt, category, access_level, is_pinned ? 1 : 0, featured_image, req.params.id]);
  await syncSearchEntry('post', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/posts/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('UPDATE posts SET is_active = 0 WHERE id = ?', [req.params.id]);
  await syncSearchEntry('post', req.params.id);
  res.json({ success: true });
}));

// ==================== TEACHER PROFILES ====================
app.get('/api/teachers', wrap(async (req, res) => {
  const teachers = await pgAll(`SELECT * FROM teacher_profiles WHERE is_public = 1 ORDER BY display_order, id`);
  res.json(teachers);
}));

app.post('/api/teachers', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('avatar'), wrap(async (req, res) => {
  const { display_name, title, subject, school, bio, email, phone, achievements, is_public = 1 } = req.body;
  const avatar = req.file ? await storeUpload('teachers', req.file) : req.body.avatar;
  const r = await pgRun(`INSERT INTO teacher_profiles (display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public ? 1 : 0, req.user.id]);
  await syncSearchEntry('teacher', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/teachers/:id', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const { display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public, display_order } = req.body;
  await pgRun(`UPDATE teacher_profiles SET display_name=?, title=?, subject=?, school=?, bio=?, email=?, phone=?, avatar=?, achievements=?, is_public=?, display_order=? WHERE id=?`,
    [display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public ? 1 : 0, display_order, req.params.id]);
  await syncSearchEntry('teacher', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/teachers/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('DELETE FROM teacher_profiles WHERE id = ?', [req.params.id]);
  await syncSearchEntry('teacher', req.params.id);
  res.json({ success: true });
}));

// ==================== CHATBOX LINKS ====================
app.get('/api/chatbox-links', wrap(async (req, res) => {
  const userRole = req.user?.role || 'public';
  const links = await pgAll(`SELECT * FROM chatbox_links WHERE is_active = 1 ORDER BY display_order, id`);
  res.json(links.filter(l => hasAccess(userRole, l.access_level)));
}));

app.post('/api/chatbox-links', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { title, url, description, platform, access_level = 'student', display_order = 0 } = req.body;
  const r = await pgRun(`INSERT INTO chatbox_links (title, url, description, platform, access_level, display_order) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [title, url, description, platform, access_level, display_order]);
  await syncSearchEntry('chatbox', r.rows[0].id);
  res.json({ success: true, id: r.rows[0].id });
}));

app.put('/api/chatbox-links/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { title, url, description, platform, access_level, display_order, is_active } = req.body;
  await pgRun(`UPDATE chatbox_links SET title=?, url=?, description=?, platform=?, access_level=?, display_order=?, is_active=? WHERE id=?`,
    [title, url, description, platform, access_level, display_order, is_active ? 1 : 0, req.params.id]);
  await syncSearchEntry('chatbox', req.params.id);
  res.json({ success: true });
}));

app.delete('/api/chatbox-links/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  await pgRun('DELETE FROM chatbox_links WHERE id = ?', [req.params.id]);
  await syncSearchEntry('chatbox', req.params.id);
  res.json({ success: true });
}));

// ==================== USER MANAGEMENT ====================
app.get('/api/users', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const users = await pgAll(`SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY created_at DESC`);
  res.json(users);
}));

app.post('/api/users', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  if (req.user.role !== 'superadmin' && role === 'admin1') return res.status(403).json({ error: 'Không có quyền' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = await pgRun(`INSERT INTO users (username, password, full_name, email, role) VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [username, hash, full_name, email, role || 'student']);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
}));

app.put('/api/users/:id', requireAuth(['superadmin', 'admin1']), wrap(async (req, res) => {
  const { full_name, email, role, is_active, password } = req.body;
  if (req.user.role !== 'superadmin' && role === 'superadmin') return res.status(403).json({ error: 'Không có quyền' });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await pgRun(`UPDATE users SET full_name=?, email=?, role=?, is_active=?, password=? WHERE id=?`,
      [full_name, email, role, is_active ? 1 : 0, hash, req.params.id]);
  } else {
    await pgRun(`UPDATE users SET full_name=?, email=?, role=?, is_active=? WHERE id=?`,
      [full_name, email, role, is_active ? 1 : 0, req.params.id]);
  }
  res.json({ success: true });
}));

app.delete('/api/users/:id', requireAuth(['superadmin']), wrap(async (req, res) => {
  await pgRun('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== DASHBOARD STATS ====================
app.get('/api/admin/stats', requireAuth(['superadmin', 'admin1', 'admin2']), wrap(async (req, res) => {
  const one = async (sql) => Number((await pgGet(sql)).c);
  res.json({
    users: await one('SELECT COUNT(*) as c FROM users WHERE is_active = 1'),
    photos: await one('SELECT COUNT(*) as c FROM photos WHERE is_active = 1'),
    videos: await one('SELECT COUNT(*) as c FROM videos WHERE is_active = 1'),
    resources: await one('SELECT COUNT(*) as c FROM resources WHERE is_active = 1'),
    posts: await one('SELECT COUNT(*) as c FROM posts WHERE is_active = 1'),
    teachers: await one('SELECT COUNT(*) as c FROM teacher_profiles WHERE is_public = 1'),
    albums: await one('SELECT COUNT(*) as c FROM albums WHERE is_active = 1'),
  });
}));

// ==================== SMART SEARCH (Phase 1: Fast Search) ====================
const suggestCache = new Map(); // cacheKey -> { data, expires }

// Score a candidate row (higher = more relevant): title hits weigh more than body hits.
function scoreRow(row, terms) {
  const titleNorm = normalizeText(row.title || '');
  let score = 0;
  for (const t of terms) {
    if (titleNorm.includes(t)) score += 2;
    else if ((row.normalized || '').includes(t)) score += 1;
  }
  // small bonus for whole-phrase match in the title
  if (titleNorm.includes(terms.join(' '))) score += 1;
  return score;
}

async function performSearch(userRole, q, type = 'all', page = 1, limit = 20) {
  const normalized = normalizeText(q);
  const terms = normalized.split(' ').filter(Boolean);
  if (terms.length === 0) return { results: [], total: 0, page: Number(page), limit: Number(limit) };

  let rows;
  try {
    rows = await searchRows(normalized, type, 300);
  } catch (e) {
    console.error('search error:', e.message);
    return { results: [], total: 0, page: Number(page), limit: Number(limit) };
  }

  let filtered = rows.filter(r => hasAccess(userRole, r.access_level));
  filtered.forEach(r => { r.relScore = scoreRow(r, terms); });

  // Apply continuous-learning boost: final = relevance_norm * 0.6 + boost_norm * 0.4
  const boostMap = await getBoostMap(normalized);
  if (boostMap.size > 0 && filtered.length > 0) {
    const maxRel = Math.max(...filtered.map(r => r.relScore), 0.0001);
    const maxBoost = Math.max(...filtered.map(r => boostMap.get(`${r.type}:${r.rowref}`) || 0), 0.0001);
    filtered.forEach(r => {
      const relNorm = r.relScore / maxRel;
      const boostNorm = (boostMap.get(`${r.type}:${r.rowref}`) || 0) / maxBoost;
      r.finalScore = relNorm * 0.6 + boostNorm * 0.4;
    });
    filtered.sort((a, b) => b.finalScore - a.finalScore);
  } else {
    filtered.sort((a, b) => b.relScore - a.relScore);
  }

  const total = filtered.length;
  const offset = (Number(page) - 1) * Number(limit);
  const results = filtered.slice(offset, offset + Number(limit)).map(r => ({
    type: r.type,
    id: r.rowref,
    title: r.title,
    snippet: (r.body || '').slice(0, 160),
    image: r.image,
    url: r.url,
  }));

  return { results, total, page: Number(page), limit: Number(limit) };
}

app.get('/api/search', wrap(async (req, res) => {
  const start = Date.now();
  const userRole = req.user?.role || 'public';
  const { q = '', type = 'all', page = 1, limit = 20 } = req.query;
  const result = await performSearch(userRole, q, type, page, limit);
  const time_ms = Date.now() - start;
  console.log(`🔍 GET /api/search q="${q}" type=${type} -> ${result.total} results in ${time_ms}ms`);
  res.json({ ...result, time_ms });
}));

app.get('/api/search/suggest', wrap(async (req, res) => {
  const start = Date.now();
  const userRole = req.user?.role || 'public';
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const normalized = normalizeText(q);
  const cacheKey = `${userRole}:${normalized}`;
  const cached = suggestCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.json(cached.data);
  if (!normalized) return res.json([]);

  let rows;
  try {
    rows = await searchRows(normalized, 'all', 30);
  } catch (e) {
    return res.json([]);
  }

  const terms = normalized.split(' ').filter(Boolean);
  const data = rows
    .filter(r => hasAccess(userRole, r.access_level))
    .map(r => ({ ...r, relScore: scoreRow(r, terms) }))
    .sort((a, b) => b.relScore - a.relScore)
    .slice(0, 8)
    .map(r => ({ type: r.type, id: r.rowref, title: r.title, url: r.url }));

  suggestCache.set(cacheKey, { data, expires: Date.now() + 30000 });
  console.log(`💡 GET /api/search/suggest q="${q}" -> ${data.length} suggestions in ${Date.now() - start}ms`);
  res.json(data);
}));

// ==================== SMART SEARCH (Phase 3: Continuous Learning) ====================
app.post('/api/search/track', wrap(async (req, res) => {
  const { session_id, query: q, intent, result_id, result_type, result_position, time_to_click_ms, used_ai_assistant } = req.body || {};
  if (!q || result_id == null || !result_type) return res.status(400).json({ error: 'Thiếu dữ liệu' });

  await trackSearchEvent({
    session_id,
    query: q,
    intent,
    result_id,
    result_type,
    position: result_position,
    time_to_click_ms,
    used_ai_assistant,
  });
  res.json({ ok: true });
}));

// Recalculate search boost scores hourly from click analytics
cron.schedule('0 * * * *', async () => {
  const start = Date.now();
  try {
    const updated = await recalculateBoosts();
    console.log(`📈 Search boost recalculated: ${updated} entries in ${Date.now() - start}ms`);
  } catch (e) {
    console.error('boost recalculation error:', e.message);
  }
});

// ==================== SMART SEARCH (Phase 2: AI Search Assistant) ====================
app.post('/api/search/ai-assistant', async (req, res) => {
  const start = Date.now();
  const userRole = req.user?.role || 'public';
  const { query: q = '', conversation_history = [] } = req.body || {};

  if (!q.trim()) {
    return res.json({ needs_clarification: true, clarification_question: 'Bạn muốn tìm tài liệu gì? Hãy cho biết môn học, lớp hoặc loại tài liệu nhé.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallback = await performSearch(userRole, q, 'all', 1, 5);
    const time_ms = Date.now() - start;
    console.log(`🤖 POST /api/search/ai-assistant (no API key, fallback search) q="${q}" -> ${fallback.total} results in ${time_ms}ms`);
    return res.json({
      needs_clarification: false,
      explanation: 'Trợ lý AI chưa được cấu hình (thiếu ANTHROPIC_API_KEY) nên em đã tìm nhanh theo từ khóa bạn nhập.',
      results: fallback.results,
      follow_up_question: '',
      intent: { search_query: q },
      response_time_ms: time_ms,
    });
  }

  try {
    const analysis = await analyzeQuery(apiKey, q, conversation_history);

    if (analysis.needs_clarification) {
      const time_ms = Date.now() - start;
      console.log(`🤖 POST /api/search/ai-assistant q="${q}" -> needs clarification in ${time_ms}ms`);
      return res.json({
        needs_clarification: true,
        clarification_question: analysis.clarification_question || 'Bạn có thể nói rõ hơn không?',
        intent: analysis,
        response_time_ms: time_ms,
      });
    }

    const searchResult = await performSearch(userRole, analysis.search_query || q, 'all', 1, 5);
    const explained = await explainResults(apiKey, q, searchResult.results, analysis);

    const time_ms = Date.now() - start;
    console.log(`🤖 POST /api/search/ai-assistant q="${q}" -> ${searchResult.total} results in ${time_ms}ms`);
    res.json({
      needs_clarification: false,
      explanation: explained.explanation,
      follow_up_question: explained.follow_up_question || '',
      results: searchResult.results,
      intent: analysis,
      response_time_ms: time_ms,
    });
  } catch (e) {
    const time_ms = Date.now() - start;
    console.error(`🤖 POST /api/search/ai-assistant error: ${e.message}`);
    const fallback = await performSearch(userRole, q, 'all', 1, 5);
    res.json({
      needs_clarification: false,
      explanation: 'Trợ lý AI gặp lỗi tạm thời, em đã tìm nhanh theo từ khóa bạn nhập.',
      results: fallback.results,
      follow_up_question: '',
      intent: { search_query: q },
      response_time_ms: time_ms,
    });
  }
});

// Serve main pages
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler (for wrapped async routes)
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

// ==================== BOOT ====================
(async () => {
  try {
    await initPostgresDatabase();
    await initSearchIndex();
    const t = Date.now();
    await rebuildSearchIndex();
    console.log(`🔎 Search index built in ${Date.now() - t}ms`);
    if (!storageConfigured()) {
      console.warn('⚠️  Supabase Storage CHƯA cấu hình — upload ảnh/file sẽ lỗi. Cần SUPABASE_URL + SUPABASE_SERVICE_KEY + bucket "uploads".');
    }
    app.listen(PORT, () => {
      console.log(`\n🚀 Server chạy tại: http://localhost:${PORT}`);
      console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
      console.log(`🔑 Tài khoản Admin: superadmin / Admin@2024!`);
    });
  } catch (err) {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  }
})();

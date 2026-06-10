require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { db, initDatabase } = require('./database/schema');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'edu_secret_key_2024_nexus';

// Init DB
initDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || 'general';
    const dir = path.join(__dirname, 'uploads', type);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

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

app.use(authMiddleware);

// ==================== AUTH ====================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, avatar: user.avatar } });
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
  const user = db.prepare('SELECT id, username, full_name, email, role, avatar, bio FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, full_name, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users (username, password, full_name, email, role) VALUES (?, ?, ?, ?, 'student')`).run(username, hash, full_name, email);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
});

// ==================== SITE SETTINGS ====================
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT key, value FROM site_settings').all();
  const obj = {};
  settings.forEach(s => obj[s.key] = s.value);
  res.json(obj);
});

app.put('/api/settings', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const stmt = db.prepare(`INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)`);
  Object.entries(req.body).forEach(([k, v]) => stmt.run(k, v));
  res.json({ success: true });
});

// ==================== SLIDER ====================
app.get('/api/slider/photos', (req, res) => {
  const settings = db.prepare('SELECT * FROM slider_settings LIMIT 1').get();
  const max = parseInt(req.query.limit) || settings?.max_slides || 0;
  const query = `SELECT * FROM photos WHERE is_slider = 1 AND is_active = 1 ORDER BY display_order ASC, id ASC${max > 0 ? ' LIMIT ' + max : ''}`;
  res.json(db.prepare(query).all());
});

app.get('/api/slider/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM slider_settings LIMIT 1').get());
});

app.put('/api/slider/settings', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { auto_play, interval_ms, show_arrows, show_dots, max_slides } = req.body;
  db.prepare(`UPDATE slider_settings SET auto_play=?, interval_ms=?, show_arrows=?, show_dots=?, max_slides=?`)
    .run(auto_play ? 1 : 0, parseInt(interval_ms)||4000, show_arrows ? 1 : 0, show_dots ? 1 : 0, parseInt(max_slides)||0);
  res.json({ success: true });
});

// ==================== PHOTOS ====================
app.get('/api/photos', (req, res) => {
  const userRole = req.user?.role || 'public';
  const { album_id, limit = 50, offset = 0 } = req.query;
  let query = `SELECT p.*, a.name as album_name FROM photos p LEFT JOIN albums a ON p.album_id = a.id WHERE p.is_active = 1`;
  const params = [];
  if (album_id) { query += ` AND p.album_id = ?`; params.push(album_id); }
  const rows = db.prepare(query + ` ORDER BY p.display_order, p.id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
});

app.get('/api/albums', (req, res) => {
  const userRole = req.user?.role || 'public';
  const albums = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.is_active = 1) as photo_count FROM albums a WHERE a.is_active = 1 ORDER BY a.display_order, a.event_date DESC`).all();
  res.json(albums.filter(a => hasAccess(userRole, a.access_level)));
});

app.post('/api/photos/upload', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.array('photos', 50), (req, res) => {
  const { album_id, access_level = 'public', is_slider = 0, title } = req.body;
  const inserted = [];
  req.files.forEach((f, i) => {
    const r = db.prepare(`INSERT INTO photos (title, file_path, album_id, access_level, is_slider, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`).run(
      title || f.originalname, '/uploads/photos/' + f.filename, album_id || null, access_level, is_slider ? 1 : 0, req.user.id
    );
    inserted.push(r.lastInsertRowid);
  });
  res.json({ success: true, ids: inserted });
});

app.delete('/api/photos/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE photos SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.put('/api/photos/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { title, description, access_level, is_slider, display_order, album_id } = req.body;
  db.prepare(`UPDATE photos SET title=?, description=?, access_level=?, is_slider=?, display_order=?, album_id=? WHERE id=?`).run(title, description, access_level, is_slider ? 1 : 0, display_order, album_id, req.params.id);
  res.json({ success: true });
});

// Albums CRUD
app.post('/api/albums', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { name, description, event_date, access_level = 'public' } = req.body;
  const r = db.prepare(`INSERT INTO albums (name, description, event_date, access_level) VALUES (?, ?, ?, ?)`).run(name, description, event_date, access_level);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/albums/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { name, description, event_date, access_level, display_order } = req.body;
  db.prepare(`UPDATE albums SET name=?, description=?, event_date=?, access_level=?, display_order=? WHERE id=?`).run(name, description, event_date, access_level, display_order, req.params.id);
  res.json({ success: true });
});

app.delete('/api/albums/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE albums SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== VIDEOS ====================
app.get('/api/videos', (req, res) => {
  const userRole = req.user?.role || 'public';
  const { limit = 20, offset = 0 } = req.query;
  const videos = db.prepare(`SELECT * FROM videos WHERE is_active = 1 ORDER BY is_featured DESC, id DESC LIMIT ? OFFSET ?`).all(Number(limit), Number(offset));
  res.json(videos.filter(v => hasAccess(userRole, v.access_level)));
});

app.post('/api/videos', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), (req, res) => {
  const { title, description, youtube_url, thumbnail, access_level = 'public', is_featured = 0 } = req.body;
  const r = db.prepare(`INSERT INTO videos (title, description, youtube_url, thumbnail, access_level, is_featured, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(title, description, youtube_url, thumbnail, access_level, is_featured ? 1 : 0, req.user.id);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/videos/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { title, description, youtube_url, thumbnail, access_level, is_featured } = req.body;
  db.prepare(`UPDATE videos SET title=?, description=?, youtube_url=?, thumbnail=?, access_level=?, is_featured=? WHERE id=?`).run(title, description, youtube_url, thumbnail, access_level, is_featured ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/videos/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE videos SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== NAV BUTTONS ====================
app.get('/api/nav-buttons', (req, res) => {
  const userRole = req.user?.role || 'public';
  const buttons = db.prepare(`SELECT * FROM nav_buttons WHERE is_active = 1 ORDER BY display_order, id`).all();
  res.json(buttons.filter(b => hasAccess(userRole, b.access_level)));
});

app.post('/api/nav-buttons', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { label, icon, url, description, category, access_level, color, display_order } = req.body;
  const r = db.prepare(`INSERT INTO nav_buttons (label, icon, url, description, category, access_level, color, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(label, icon, url, description, category, access_level || 'public', color || '#2563eb', display_order || 0);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/nav-buttons/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { label, icon, url, description, category, access_level, color, display_order, is_active } = req.body;
  db.prepare(`UPDATE nav_buttons SET label=?, icon=?, url=?, description=?, category=?, access_level=?, color=?, display_order=?, is_active=? WHERE id=?`).run(label, icon, url, description, category, access_level, color, display_order, is_active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/nav-buttons/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('DELETE FROM nav_buttons WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== RESOURCE CATEGORIES ====================
app.get('/api/resource-categories', (req, res) => {
  const userRole = req.user?.role || 'public';
  const cats = db.prepare(`SELECT * FROM resource_categories WHERE is_active = 1 ORDER BY display_order, id`).all();
  res.json(cats.filter(c => hasAccess(userRole, c.access_level)));
});

app.post('/api/resource-categories', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { name, slug, description, icon, color, access_level, parent_id, display_order } = req.body;
  const r = db.prepare(`INSERT INTO resource_categories (name, slug, description, icon, color, access_level, parent_id, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(name, slug, description, icon, color, access_level || 'public', parent_id || null, display_order || 0);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/resource-categories/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { name, slug, description, icon, color, access_level, display_order, is_active } = req.body;
  db.prepare(`UPDATE resource_categories SET name=?, slug=?, description=?, icon=?, color=?, access_level=?, display_order=?, is_active=? WHERE id=?`).run(name, slug, description, icon, color, access_level, display_order, is_active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/resource-categories/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE resource_categories SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== RESOURCES ====================
app.get('/api/resources', (req, res) => {
  const userRole = req.user?.role || 'public';
  const { category_id, search, limit = 30, offset = 0 } = req.query;
  let query = `SELECT r.*, c.name as category_name, u.full_name as uploader_name FROM resources r LEFT JOIN resource_categories c ON r.category_id = c.id LEFT JOIN users u ON r.uploaded_by = u.id WHERE r.is_active = 1`;
  const params = [];
  if (category_id) { query += ` AND r.category_id = ?`; params.push(category_id); }
  if (search) { query += ` AND (r.title LIKE ? OR r.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  const rows = db.prepare(query + ` ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
});

app.post('/api/resources/upload', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('file'), (req, res) => {
  const { title, description, category_id, access_level = 'public', tags, external_url } = req.body;
  const filePath = req.file ? '/uploads/resources/' + req.file.filename : null;
  const r = db.prepare(`INSERT INTO resources (title, description, category_id, file_path, file_type, file_size, external_url, access_level, tags, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    title, description, category_id, filePath,
    req.file?.mimetype, req.file?.size,
    external_url, access_level, tags, req.user.id
  );
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/resources/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { title, description, access_level, tags, external_url, category_id } = req.body;
  db.prepare(`UPDATE resources SET title=?, description=?, access_level=?, tags=?, external_url=?, category_id=? WHERE id=?`).run(title, description, access_level, tags, external_url, category_id, req.params.id);
  res.json({ success: true });
});

app.delete('/api/resources/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE resources SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/resources/:id/download', (req, res) => {
  const userRole = req.user?.role || 'public';
  const resource = db.prepare('SELECT * FROM resources WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Không tìm thấy' });
  if (!hasAccess(userRole, resource.access_level)) return res.status(403).json({ error: 'Không có quyền truy cập' });
  db.prepare('UPDATE resources SET download_count = download_count + 1 WHERE id = ?').run(req.params.id);
  if (resource.file_path) {
    const filePath = path.join(__dirname, resource.file_path);
    res.download(filePath);
  } else if (resource.external_url) {
    res.redirect(resource.external_url);
  }
});

// ==================== POSTS / NEWS ====================
app.get('/api/posts', (req, res) => {
  const userRole = req.user?.role || 'public';
  const { category, limit = 20, offset = 0 } = req.query;
  let query = `SELECT p.*, u.full_name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.is_active = 1`;
  const params = [];
  if (category) { query += ` AND p.category = ?`; params.push(category); }
  const rows = db.prepare(query + ` ORDER BY p.is_pinned DESC, p.published_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  res.json(rows.filter(r => hasAccess(userRole, r.access_level)));
});

app.post('/api/posts', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('featured_image'), (req, res) => {
  const { title, content, excerpt, category = 'news', access_level = 'public', is_pinned = 0 } = req.body;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  const img = req.file ? '/uploads/posts/' + req.file.filename : req.body.featured_image;
  const r = db.prepare(`INSERT INTO posts (title, slug, content, excerpt, featured_image, category, access_level, is_pinned, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, slug, content, excerpt, img, category, access_level, is_pinned ? 1 : 0, req.user.id);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/posts/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { title, content, excerpt, category, access_level, is_pinned, featured_image } = req.body;
  db.prepare(`UPDATE posts SET title=?, content=?, excerpt=?, category=?, access_level=?, is_pinned=?, featured_image=? WHERE id=?`).run(title, content, excerpt, category, access_level, is_pinned ? 1 : 0, featured_image, req.params.id);
  res.json({ success: true });
});

app.delete('/api/posts/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('UPDATE posts SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== TEACHER PROFILES ====================
app.get('/api/teachers', (req, res) => {
  const teachers = db.prepare(`SELECT * FROM teacher_profiles WHERE is_public = 1 ORDER BY display_order, id`).all();
  res.json(teachers);
});

app.post('/api/teachers', requireAuth(['superadmin', 'admin1', 'admin2', 'teacher']), upload.single('avatar'), (req, res) => {
  const { display_name, title, subject, school, bio, email, phone, achievements, is_public = 1 } = req.body;
  const avatar = req.file ? '/uploads/teachers/' + req.file.filename : req.body.avatar;
  const r = db.prepare(`INSERT INTO teacher_profiles (display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public ? 1 : 0, req.user.id);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/teachers/:id', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  const { display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public, display_order } = req.body;
  db.prepare(`UPDATE teacher_profiles SET display_name=?, title=?, subject=?, school=?, bio=?, email=?, phone=?, avatar=?, achievements=?, is_public=?, display_order=? WHERE id=?`).run(display_name, title, subject, school, bio, email, phone, avatar, achievements, is_public ? 1 : 0, display_order, req.params.id);
  res.json({ success: true });
});

app.delete('/api/teachers/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('DELETE FROM teacher_profiles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== CHATBOX LINKS ====================
app.get('/api/chatbox-links', (req, res) => {
  const userRole = req.user?.role || 'public';
  const links = db.prepare(`SELECT * FROM chatbox_links WHERE is_active = 1 ORDER BY display_order, id`).all();
  res.json(links.filter(l => hasAccess(userRole, l.access_level)));
});

app.post('/api/chatbox-links', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { title, url, description, platform, access_level = 'student', display_order = 0 } = req.body;
  const r = db.prepare(`INSERT INTO chatbox_links (title, url, description, platform, access_level, display_order) VALUES (?, ?, ?, ?, ?, ?)`).run(title, url, description, platform, access_level, display_order);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/chatbox-links/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { title, url, description, platform, access_level, display_order, is_active } = req.body;
  db.prepare(`UPDATE chatbox_links SET title=?, url=?, description=?, platform=?, access_level=?, display_order=?, is_active=? WHERE id=?`).run(title, url, description, platform, access_level, display_order, is_active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/chatbox-links/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  db.prepare('DELETE FROM chatbox_links WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== USER MANAGEMENT ====================
app.get('/api/users', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const users = db.prepare(`SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY created_at DESC`).all();
  res.json(users);
});

app.post('/api/users', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  const allowedRoles = ['student', 'teacher', 'admin2', 'admin1'];
  if (req.user.role !== 'superadmin' && role === 'admin1') return res.status(403).json({ error: 'Không có quyền' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(`INSERT INTO users (username, password, full_name, email, role) VALUES (?, ?, ?, ?, ?)`).run(username, hash, full_name, email, role || 'student');
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
});

app.put('/api/users/:id', requireAuth(['superadmin', 'admin1']), (req, res) => {
  const { full_name, email, role, is_active, password } = req.body;
  if (req.user.role !== 'superadmin' && role === 'superadmin') return res.status(403).json({ error: 'Không có quyền' });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE users SET full_name=?, email=?, role=?, is_active=?, password=? WHERE id=?`).run(full_name, email, role, is_active ? 1 : 0, hash, req.params.id);
  } else {
    db.prepare(`UPDATE users SET full_name=?, email=?, role=?, is_active=? WHERE id=?`).run(full_name, email, role, is_active ? 1 : 0, req.params.id);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth(['superadmin']), (req, res) => {
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== DASHBOARD STATS ====================
app.get('/api/admin/stats', requireAuth(['superadmin', 'admin1', 'admin2']), (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get().c,
    photos: db.prepare('SELECT COUNT(*) as c FROM photos WHERE is_active = 1').get().c,
    videos: db.prepare('SELECT COUNT(*) as c FROM videos WHERE is_active = 1').get().c,
    resources: db.prepare('SELECT COUNT(*) as c FROM resources WHERE is_active = 1').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_active = 1').get().c,
    teachers: db.prepare('SELECT COUNT(*) as c FROM teacher_profiles WHERE is_public = 1').get().c,
    albums: db.prepare('SELECT COUNT(*) as c FROM albums WHERE is_active = 1').get().c,
  });
});

// Serve main pages
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 Server chạy tại: http://localhost:${PORT}`);
  console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`🔑 Tài khoản Admin: superadmin / Admin@2024!`);
});

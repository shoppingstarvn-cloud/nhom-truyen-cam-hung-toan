const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'edu_database.db'));

function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- Users & Roles
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      email TEXT,
      role TEXT DEFAULT 'student', -- superadmin, admin1, admin2, teacher, student, public
      avatar TEXT,
      bio TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Teacher Profiles (public)
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      display_name TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      school TEXT,
      bio TEXT,
      email TEXT,
      phone TEXT,
      avatar TEXT,
      cv_file TEXT,
      achievements TEXT,
      is_public INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Navigation Buttons
    CREATE TABLE IF NOT EXISTS nav_buttons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      icon TEXT,
      url TEXT,
      description TEXT,
      category TEXT,
      access_level TEXT DEFAULT 'public', -- public, student, teacher, admin1, admin2, superadmin
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      color TEXT DEFAULT '#2563eb',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Resource Categories / Repositories
    CREATE TABLE IF NOT EXISTS resource_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      icon TEXT,
      color TEXT DEFAULT '#2563eb',
      access_level TEXT DEFAULT 'public', -- public, student, teacher, admin1, superadmin
      parent_id INTEGER,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES resource_categories(id)
    );

    -- Resources (documents, files, links)
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      file_type TEXT,
      file_size INTEGER,
      external_url TEXT,
      thumbnail TEXT,
      access_level TEXT DEFAULT 'public',
      tags TEXT,
      view_count INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      uploaded_by INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES resource_categories(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    -- Photo Gallery
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      album_id INTEGER,
      tags TEXT,
      access_level TEXT DEFAULT 'public',
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_slider INTEGER DEFAULT 0,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Photo Albums
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      cover_photo TEXT,
      event_date DATE,
      access_level TEXT DEFAULT 'public',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Videos
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      youtube_url TEXT,
      file_path TEXT,
      thumbnail TEXT,
      duration TEXT,
      album_id INTEGER,
      access_level TEXT DEFAULT 'public',
      is_featured INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- News / Announcements
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      content TEXT,
      excerpt TEXT,
      featured_image TEXT,
      category TEXT DEFAULT 'news',
      access_level TEXT DEFAULT 'public',
      is_pinned INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      author_id INTEGER,
      is_active INTEGER DEFAULT 1,
      published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    -- Slider Settings
    CREATE TABLE IF NOT EXISTS slider_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auto_play INTEGER DEFAULT 1,
      interval_ms INTEGER DEFAULT 4000,
      show_arrows INTEGER DEFAULT 1,
      show_dots INTEGER DEFAULT 1,
      transition TEXT DEFAULT 'slide',
      max_slides INTEGER DEFAULT 10
    );

    -- Site Settings
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      description TEXT
    );

    -- Access Logs
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      resource TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Chatbox Links
    CREATE TABLE IF NOT EXISTS chatbox_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      platform TEXT,
      access_level TEXT DEFAULT 'student',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert default superadmin
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('superadmin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('Admin@2024!', 10);
    db.prepare(`INSERT INTO users (username, password, full_name, email, role) VALUES (?, ?, ?, ?, ?)`).run(
      'superadmin', hash, 'Quản Trị Viên Hệ Thống', 'admin@edu.vn', 'superadmin'
    );
  }

  // Default site settings
  const settings = [
    ['site_name', 'NHÓM TRUYỀN CẢM HỨNG TOÁN', 'Tên website'],
    ['site_tagline', 'Kho Tài Nguyên Giáo Dục Chất Lượng Cao', 'Slogan'],
    ['site_logo', '', 'Logo URL'],
    ['contact_email', 'contact@edu.vn', 'Email liên hệ'],
    ['contact_phone', '0123456789', 'Số điện thoại'],
    ['facebook_url', '', 'Facebook URL'],
    ['youtube_url', '', 'YouTube URL'],
    ['zalo_url', '', 'Zalo URL'],
    ['primary_color', '#1e3a5f', 'Màu chính'],
    ['accent_color', '#f59e0b', 'Màu nhấn'],
    ['footer_text', '© 2024 Nhóm Học Liệu Giáo Viên. All rights reserved.', 'Footer text'],
    ['neon_cycle', '3', 'Chu kỳ neon (giây)'],
  ];
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, description) VALUES (?, ?, ?)`);
  settings.forEach(s => insertSetting.run(...s));

  // Default resource categories
  const cats = [
    ['Tài liệu giảng dạy', 'tai-lieu-giang-day', '📚', '#1e40af', 'teacher'],
    ['Đề thi học kỳ & giữa kỳ', 'de-thi-hoc-ky', '📝', '#7c3aed', 'teacher'],
    ['Sáng kiến kinh nghiệm', 'sang-kien-kinh-nghiem', '💡', '#059669', 'teacher'],
    ['Đề thi vào 10 & Quốc gia', 'de-thi-vao-10', '🎯', '#dc2626', 'public'],
    ['Đề thi học sinh giỏi', 'de-thi-hsg', '🏆', '#d97706', 'public'],
    ['Infographic dạy học', 'infographic', '🖼️', '#0891b2', 'public'],
    ['Sách viết của nhóm', 'sach-viet', '📖', '#7c3aed', 'public'],
    ['Phần mềm & Ứng dụng', 'phan-mem-ung-dung', '💻', '#065f46', 'public'],
    ['Tài liệu nội bộ', 'tai-lieu-noi-bo', '🔒', '#991b1b', 'admin1'],
  ];
  const insertCat = db.prepare(`INSERT OR IGNORE INTO resource_categories (name, slug, icon, color, access_level) VALUES (?, ?, ?, ?, ?)`);
  cats.forEach(c => insertCat.run(...c));

  // Default slider settings
  const sliderExists = db.prepare('SELECT id FROM slider_settings').get();
  if (!sliderExists) {
    db.prepare(`INSERT INTO slider_settings (auto_play, interval_ms, show_arrows, show_dots) VALUES (1, 4000, 1, 1)`).run();
  }

  console.log('✅ Database initialized successfully');
}

module.exports = { db, initDatabase };

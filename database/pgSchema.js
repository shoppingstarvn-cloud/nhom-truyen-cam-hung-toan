const bcrypt = require('bcryptjs');
const { query } = require('./db');

// Postgres schema for Supabase. Mirrors database/schema.js (SQLite) table-for-table.
// During the migration, this coexists with the legacy SQLite schema (database/schema.js):
// endpoints are converted group by group to use this Postgres database instead.
async function initPostgresDatabase() {
  await query(`
    -- Users & Roles
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      email TEXT,
      role TEXT DEFAULT 'student',
      avatar TEXT,
      bio TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      birth_date TEXT,
      zalo_phone TEXT,
      workplace TEXT,
      ward TEXT,
      google_id TEXT,
      profile_completed INTEGER DEFAULT 1
    );

    -- Teacher Profiles (public)
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Navigation Buttons
    CREATE TABLE IF NOT EXISTS nav_buttons (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT,
      url TEXT,
      description TEXT,
      category TEXT,
      access_level TEXT DEFAULT 'public',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      color TEXT DEFAULT '#2563eb',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Resource Categories / Repositories
    CREATE TABLE IF NOT EXISTS resource_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      icon TEXT,
      color TEXT DEFAULT '#2563eb',
      access_level TEXT DEFAULT 'public',
      parent_id INTEGER REFERENCES resource_categories(id),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Resources (documents, files, links)
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES resource_categories(id),
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
      uploaded_by INTEGER REFERENCES users(id),
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Photo Gallery
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Photo Albums
    CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cover_photo TEXT,
      event_date DATE,
      access_level TEXT DEFAULT 'public',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Videos
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- News / Announcements
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      content TEXT,
      excerpt TEXT,
      featured_image TEXT,
      category TEXT DEFAULT 'news',
      access_level TEXT DEFAULT 'public',
      is_pinned INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      author_id INTEGER REFERENCES users(id),
      is_active INTEGER DEFAULT 1,
      published_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Slider Settings
    CREATE TABLE IF NOT EXISTS slider_settings (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT,
      resource TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Chatbox Links
    CREATE TABLE IF NOT EXISTS chatbox_links (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      platform TEXT,
      access_level TEXT DEFAULT 'student',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Insert default superadmin
  const adminExists = await query('SELECT id FROM users WHERE role = $1', ['superadmin']);
  if (adminExists.rows.length === 0) {
    const hash = bcrypt.hashSync('Admin@2024!', 10);
    await query(
      `INSERT INTO users (username, password, full_name, email, role) VALUES ($1, $2, $3, $4, $5)`,
      ['superadmin', hash, 'Quản Trị Viên Hệ Thống', 'admin@edu.vn', 'superadmin']
    );
  }

  // Default site settings
  const settings = [
    ['site_name', 'NHÓM TRUYỀN CẢM HỨNG TOÁN', 'Tên website'],
    ['site_tagline', 'Kho Tài Nguyên Giáo Dục Chất Lượng Cao', 'Slogan'],
    ['site_logo', '', 'Logo URL'],
    ['contact_email', 'truyencamhungtoan@gmail.com', 'Email liên hệ'],
    ['contact_phone', '0348156998', 'Số điện thoại'],
    ['facebook_url', '', 'Facebook URL'],
    ['youtube_url', '', 'YouTube URL'],
    ['zalo_url', '', 'Zalo URL'],
    ['primary_color', '#1e3a5f', 'Màu chính'],
    ['accent_color', '#f59e0b', 'Màu nhấn'],
    ['footer_text', '© 2024 Nhóm Học Liệu Giáo Viên. All rights reserved.', 'Footer text'],
    ['neon_cycle', '3', 'Chu kỳ neon (giây)'],
  ];
  for (const s of settings) {
    await query(`INSERT INTO site_settings (key, value, description) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`, s);
  }

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
  for (const c of cats) {
    await query(
      `INSERT INTO resource_categories (name, slug, icon, color, access_level) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
      c
    );
  }

  // Default slider settings
  const sliderExists = await query('SELECT id FROM slider_settings');
  if (sliderExists.rows.length === 0) {
    await query(`INSERT INTO slider_settings (auto_play, interval_ms, show_arrows, show_dots) VALUES (1, 4000, 1, 1)`);
  }

  console.log('✅ Postgres (Supabase) database initialized successfully');
}

module.exports = { initPostgresDatabase };

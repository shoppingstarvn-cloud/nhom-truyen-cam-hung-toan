const bcrypt = require('bcryptjs');
const { query } = require('./db');

async function initPostgresDatabase() {
  // BƯỚC 1: KIỂM TRA VÀ TỰ ĐỘNG DỌN DẸP BẢNG CŨ BỊ LỖI
  // Vợ cho code tự động soi xem bảng users hiện tại có cột password không
  const checkPasswordCol = await query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='users' AND column_name='password'
  `);
  
  // Nếu bảng users tồn tại mà KHÔNG có cột password (do tàn dư cũ), hệ thống sẽ tự động đập bỏ để xây lại
  if (checkPasswordCol.rows.length === 0) {
    console.log('🔄 Hệ thống đang tự động dọn dẹp bảng tài khoản cũ bị lỗi...');
    await query('DROP TABLE IF EXISTS videos CASCADE;');
    await query('DROP TABLE IF EXISTS resources CASCADE;');
    await query('DROP TABLE IF EXISTS users CASCADE;');
  }

  // BƯỚC 2: KHỞI TẠO LẠI CÁC BẢNG CHUẨN XÁC 100%
  await query(`
    -- BẢNG TÀI KHOẢN (Đã dọn sạch và tạo mới chuẩn)
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      full_name TEXT, email TEXT, role TEXT DEFAULT 'user', avatar TEXT,
      is_active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW(),
      google_id TEXT, profile_completed INTEGER DEFAULT 1
    );

    -- BẢNG VIDEO (Bảo tồn tính năng Upload Video, bỏ móc nối rườm rà)
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      youtube_url TEXT, file_path TEXT, thumbnail TEXT, duration TEXT,
      view_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- BẢNG TÌM KIẾM THÔNG MINH
    CREATE TABLE IF NOT EXISTS resource_categories (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE,
      icon TEXT, color TEXT DEFAULT '#2563eb', is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES resource_categories(id),
      title TEXT NOT NULL, description TEXT, file_path TEXT, external_url TEXT,
      view_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- BẢNG SẢN PHẨM BÊ TÔNG ĐỘNG (Thêm/Sửa/Xóa mượt mà)
    CREATE TABLE IF NOT EXISTS concrete_products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      mac_grade TEXT, slump TEXT, description TEXT, image_url TEXT,
      is_active INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- CẤU HÌNH WEBSITE & SLIDER
    CREATE TABLE IF NOT EXISTS slider_settings (
      id SERIAL PRIMARY KEY, auto_play INTEGER DEFAULT 1, interval_ms INTEGER DEFAULT 4000
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY, value TEXT, description TEXT
    );
  `);

  // BƯỚC 3: TẠO TÀI KHOẢN QUẢN TRỊ VIÊN CỬA ÂU
  const adminExists = await query('SELECT id FROM users WHERE role = $1', ['superadmin']);
  if (adminExists.rows.length === 0) {
    const hash = bcrypt.hashSync('Admin@8386!', 10);
    await query(
      `INSERT INTO users (username, password, full_name, email, role) VALUES ($1, $2, $3, $4, $5)`,
      ['admincuaau', hash, 'Giám Đốc Cửa Âu', 'congtycuaau8386@gmail.com', 'superadmin']
    );
  }

  console.log('✅ Hoàn tất khởi tạo Database Postgres siêu mạnh cho Website Bê Tông Cửa Âu!');
}

module.exports = { initPostgresDatabase };
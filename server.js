require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors'); // Thêm bảo mật CORS
const { randomUUID } = require('crypto');
const { query, pgAll, pgGet, pgRun } = require('./database/db');
const { initPostgresDatabase } = require('./database/pgSchema');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'shoppingstar_super_secret_2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// Middleware thiết yếu
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Kiểm tra biến môi trường
app.get('/debug-env', (req, res) => {
    res.send('Client ID is: ' + (process.env.GOOGLE_CLIENT_ID ? 'Đã nhận' : 'Chưa nhận'));
});

// Phục vụ file tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình Upload bộ nhớ tạm
const upload = multer({ storage: multer.memoryStorage() });

// --- CÁC HÀM HỖ TRỢ CHUẨN ---
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) { req.user = null; }
    }
    next();
};
app.use(authMiddleware);

// --- ROUTE GỐC ---
// API test
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// API trả về cấu hình website cho frontend, lấy GOOGLE_CLIENT_ID từ biến môi trường Vercel
app.get('/api/settings', wrap(async (req, res) => {
    const rows = await pgAll('SELECT key, value FROM site_settings');
    const settings = {};
    rows.forEach(row => {
        settings[row.key] = row.value;
    });
    // Gửi Client ID từ Vercel xuống cho Frontend sử dụng
    settings.google_client_id = process.env.GOOGLE_CLIENT_ID || '';
    res.json(settings);
}));

// API Xử lý đăng nhập Google
app.post('/api/auth/google', wrap(async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Thiếu thông tin xác thực' });

    // Giải mã token từ Google
    const payload = jwt.decode(credential);
    if (!payload) return res.status(400).json({ error: 'Token không hợp lệ' });

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const avatar = payload.picture;

    // Kiểm tra user trong Postgres
    let user = await pgGet('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email]);

    if (!user) {
        // Tự động tạo tài khoản mới nếu chưa tồn tại
        const username = 'google_' + googleId.substring(0, 10);
        const result = await query(
            'INSERT INTO users (username, password, full_name, email, google_id, avatar, role, profile_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [username, 'google_auth_placeholder', name, email, googleId, avatar, 'student', 0]
        );
        user = result.rows[0];
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
}));

// --- ĐIỀU HƯỚNG FRONTEND (REACT ROUTER) ---
// Đảm bảo mọi đường dẫn không thuộc /api đều trỏ về index.html để React Router xử lý
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- XỬ LÝ LỖI TRUNG TÂM ---
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ error: 'Máy chủ đang bảo trì, anh yêu chờ em một chút nhé!' });
});

// --- KHỞI TẠO HỆ THỐNG ---
(async () => {
    try {
        await initPostgresDatabase();
        app.listen(PORT, () => {
            console.log(`🚀 Đế chế AI của anh Linh đang chạy tại: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Lỗi khởi tạo DB:', err);
    }
})();

module.exports = app;
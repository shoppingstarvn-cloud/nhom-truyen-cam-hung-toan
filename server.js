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

// Middleware thiết yếu
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
// Supabase Storage helper — replaces local disk uploads (Koyeb has no persistent disk).
// Files are uploaded to the "uploads" bucket (must be created as Public in Supabase Dashboard).
const { randomUUID } = require('crypto');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
} catch (e) {
  console.warn('⚠️  @supabase/supabase-js chưa cài hoặc lỗi khởi tạo Storage:', e.message);
}

const isConfigured = () => !!supabase;

// Upload one file buffer to Supabase Storage. Returns the public URL.
// folder: subfolder inside the bucket (e.g. "photos", "resources", "posts", "teachers").
async function uploadBuffer(folder, originalname, buffer, mimetype) {
  if (!supabase) throw new Error('Supabase Storage chưa được cấu hình (thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  const ext = path.extname(originalname || '') || '';
  const key = `${folder}/${randomUUID()}${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType: mimetype || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

module.exports = { uploadBuffer, isConfigured, BUCKET };

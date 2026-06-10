// ===== STATE =====
let aToken = localStorage.getItem('edu_admin_token');
let aUser = null;
let currentPage = 'dashboard';

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  if (aToken) tryAutoLogin();
  else showLoginScreen();
});

// ===== API =====
async function aApi(path, options = {}) {
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (aToken) headers['Authorization'] = 'Bearer ' + aToken;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function tryAutoLogin() {
  try {
    aUser = await aApi('/api/auth/me');
    if (!['superadmin','admin1','admin2'].includes(aUser.role)) {
      throw new Error('Không có quyền admin');
    }
    showAdminPanel();
  } catch {
    aToken = null; localStorage.removeItem('edu_admin_token');
    showLoginScreen();
  }
}

// ===== AUTH =====
function showLoginScreen() {
  document.getElementById('admin-login').style.display = 'flex';
  document.getElementById('admin-panel').style.display = 'none';
}

function showAdminPanel() {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'flex';
  document.getElementById('a-user-name').textContent = aUser.full_name || aUser.username;
  document.getElementById('a-user-role').textContent = roleLabel(aUser.role);
  document.getElementById('topbar-name').textContent = aUser.full_name || aUser.username;
  document.getElementById('admin-role-badge').textContent = roleLabel(aUser.role);
  // Hide superadmin-only items for lower roles
  if (!['superadmin','admin1'].includes(aUser.role)) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  showPage('dashboard');
}

async function adminLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('a-login-btn');
  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  const errEl = document.getElementById('a-login-error');
  errEl.style.display = 'none';
  try {
    const data = await aApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: document.getElementById('a-username').value, password: document.getElementById('a-password').value })
    });
    if (!['superadmin','admin1','admin2'].includes(data.user.role)) throw new Error('Tài khoản không có quyền quản trị');
    aToken = data.token; aUser = data.user;
    localStorage.setItem('edu_admin_token', aToken);
    showAdminPanel();
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
}

function adminLogout() {
  aToken = null; aUser = null;
  localStorage.removeItem('edu_admin_token');
  showLoginScreen();
}

// ===== NAVIGATION =====
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navItem = [...document.querySelectorAll('.nav-item')].find(el => el.getAttribute('onclick')?.includes(`'${page}'`));
  if (navItem) navItem.classList.add('active');
  // Close sidebar on mobile
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  const titles = { dashboard:'Dashboard', posts:'Bài viết & Tin tức', photos:'Quản lý Hình ảnh', albums:'Quản lý Album', videos:'Quản lý Video', resources:'Kho Tài liệu', categories:'Danh mục Tài nguyên', 'nav-buttons':'Phím Truy cập', chatbox:'ChatBox Links', teachers:'Hồ sơ Thầy Cô', users:'Quản lý Users', slider:'Slider & Ảnh bìa', settings:'Cài đặt Website' };
  document.getElementById('page-title').textContent = titles[page] || page;
  const pages = { dashboard: pageDashboard, posts: pagePosts, photos: pagePhotos, albums: pageAlbums, videos: pageVideos, resources: pageResources, categories: pageCategories, 'nav-buttons': pageNavButtons, chatbox: pageChatbox, teachers: pageTeachers, users: pageUsers, slider: pageSlider, settings: pageSettings };
  const fn = pages[page];
  if (fn) fn();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('open');
  sb.classList.toggle('collapsed');
}

// ===== TOAST =====
function toast(msg, type = 'success') {
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ===== MODAL =====
function openAModal(title, bodyHtml, wide = false) {
  document.getElementById('a-modal-title').textContent = title;
  document.getElementById('a-modal-body').innerHTML = bodyHtml;
  document.getElementById('a-modal-box').style.maxWidth = wide ? '800px' : '600px';
  document.getElementById('a-modal').classList.add('active');
}
function closeAModal(e) {
  if (!e || e.target === document.getElementById('a-modal')) {
    document.getElementById('a-modal').classList.remove('active');
  }
}

// ===== CONFIRM =====
function confirmAction(msg, fn) {
  openAModal('⚠️ Xác nhận', `
    <p style="font-size:15px;color:#374151;margin-bottom:24px">${msg}</p>
    <div class="a-modal-footer">
      <button class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button>
      <button class="a-btn a-btn-danger" onclick="closeAModal();(${fn.toString()})()">Xác nhận xóa</button>
    </div>
  `);
}

// ===== HELPERS =====
function roleLabel(r) { return {superadmin:'⚡ Super Admin', admin1:'🔑 Admin Cấp 1', admin2:'🔑 Admin Cấp 2', teacher:'👨‍🏫 Giáo viên', student:'👤 Học sinh'}[r] || r; }
function roleClass(r) { return `role-${r}`; }
function accessBadge(lvl) {
  const labels = { public:'🌐 Công khai', student:'👤 Học sinh', teacher:'👨‍🏫 Giáo viên', admin2:'🔑 Admin 2', admin1:'🔑 Admin 1', superadmin:'⚡ Super' };
  const cls = { public:'badge-public', student:'badge-student', teacher:'badge-teacher', admin2:'badge-admin', admin1:'badge-admin', superadmin:'badge-superadmin' };
  return `<span class="badge ${cls[lvl]||'badge-public'}">${labels[lvl]||lvl}</span>`;
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
function fmtSize(b) { if (!b) return ''; if (b<1024) return b+'B'; if (b<1048576) return (b/1024).toFixed(1)+'KB'; return (b/1048576).toFixed(1)+'MB'; }
function el(id) { return document.getElementById(id); }
function pc() { return el('page-content'); }
function accessOptions(selected='public') {
  return ['public','student','teacher','admin2','admin1','superadmin'].map(v =>
    `<option value="${v}"${v===selected?' selected':''}>${roleLabel2(v)}</option>`).join('');
}
function roleLabel2(v) { return {public:'Công khai',student:'Học sinh',teacher:'Giáo viên',admin2:'Admin Cấp 2',admin1:'Admin Cấp 1',superadmin:'Super Admin'}[v]||v; }

// ===== DASHBOARD =====
async function pageDashboard() {
  pc().innerHTML = `<div class="loading" style="text-align:center;padding:48px"><i class="fas fa-spinner" style="font-size:30px;animation:spin 1s linear infinite"></i></div>`;
  try {
    const stats = await aApi('/api/admin/stats');
    const cards = [
      { label:'Bài viết', num: stats.posts, icon:'fa-newspaper', color:'#3b82f6', bg:'#dbeafe' },
      { label:'Hình ảnh', num: stats.photos, icon:'fa-images', color:'#8b5cf6', bg:'#ede9fe' },
      { label:'Video', num: stats.videos, icon:'fa-video', color:'#ec4899', bg:'#fce7f3' },
      { label:'Tài liệu', num: stats.resources, icon:'fa-book', color:'#059669', bg:'#d1fae5' },
      { label:'Thầy Cô', num: stats.teachers, icon:'fa-chalkboard-teacher', color:'#f59e0b', bg:'#fef3c7' },
      { label:'Album', num: stats.albums, icon:'fa-folder-open', color:'#0891b2', bg:'#cffafe' },
      { label:'Users', num: stats.users, icon:'fa-users', color:'#dc2626', bg:'#fee2e2' },
    ];
    pc().innerHTML = `
      <div class="page-header"><h2>📊 Dashboard Tổng quan</h2><span style="color:#6b7280;font-size:13px">Xin chào, ${aUser.full_name||aUser.username}!</span></div>
      <div class="stats-cards">
        ${cards.map(c => `
          <div class="stat-card" style="--card-color:${c.color}">
            <div class="stat-card-icon" style="background:${c.bg};color:${c.color}"><i class="fas ${c.icon}"></i></div>
            <div><div class="stat-card-num">${c.num}</div><div class="stat-card-label">${c.label}</div></div>
          </div>
        `).join('')}
      </div>
      <div class="chart-grid">
        <div class="chart-card">
          <h4>⚡ Truy cập nhanh</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${[['Thêm bài viết','posts','fa-plus','#3b82f6'],['Upload ảnh','photos','fa-upload','#8b5cf6'],['Thêm video','videos','fa-video','#ec4899'],['Thêm tài liệu','resources','fa-book','#059669'],['Quản lý users','users','fa-users','#dc2626'],['Cài đặt','settings','fa-cog','#6b7280']].map(([l,p,i,c]) =>
              `<button class="a-btn" style="background:${c};color:#fff;justify-content:center" onclick="showPage('${p}')"><i class="fas ${i}"></i> ${l}</button>`
            ).join('')}
          </div>
        </div>
        <div class="chart-card">
          <h4>ℹ️ Thông tin hệ thống</h4>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
            <div style="display:flex;justify-content:space-between"><span>Vai trò:</span><strong class="${roleClass(aUser.role)}">${roleLabel(aUser.role)}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Username:</span><strong>${aUser.username}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Phiên bản:</span><strong>v1.0.0</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Database:</span><strong style="color:#059669">✅ Online</strong></div>
          </div>
        </div>
      </div>
    `;
  } catch (e) { pc().innerHTML = `<div class="a-error">${e.message}</div>`; }
}

// ===== POSTS =====
async function pagePosts() {
  pc().innerHTML = `<div class="page-header"><h2>📰 Bài viết & Tin tức</h2><button class="a-btn a-btn-primary" onclick="openPostForm()"><i class="fas fa-plus"></i> Thêm bài viết</button></div><div class="a-table-wrap"><div class="a-table-header"><h3>Danh sách bài viết</h3><div class="a-search"><input type="text" placeholder="🔍 Tìm kiếm..." oninput="filterTable(this,'posts-tbody')"></div></div><div style="overflow-x:auto"><table><thead><tr><th>Tiêu đề</th><th>Danh mục</th><th>Quyền</th><th>Ghim</th><th>Ngày</th><th>Thao tác</th></tr></thead><tbody id="posts-tbody"><tr><td colspan="6" class="a-table-empty"><i class="fas fa-spinner" style="animation:spin 1s linear infinite"></i></td></tr></tbody></table></div></div>`;
  try {
    const posts = await aApi('/api/posts?limit=100');
    const tb = el('posts-tbody');
    if (!posts.length) { tb.innerHTML = `<tr><td colspan="6" class="a-table-empty"><i class="fas fa-newspaper"></i><p>Chưa có bài viết</p></td></tr>`; return; }
    const cats = { news:'Tin tức', announcement:'Thông báo', event:'Sự kiện', other:'Khác' };
    tb.innerHTML = posts.map(p => `
      <tr>
        <td><strong>${p.title}</strong><br><small style="color:#9ca3af">${p.excerpt||''}</small></td>
        <td>${cats[p.category]||p.category}</td>
        <td>${accessBadge(p.access_level)}</td>
        <td>${p.is_pinned ? '📌' : '—'}</td>
        <td>${fmtDate(p.published_at)}</td>
        <td style="white-space:nowrap">
          <button class="a-btn a-btn-warning a-btn-sm" onclick="openPostForm(${JSON.stringify(p).replace(/"/g,'&quot;')})"><i class="fas fa-edit"></i></button>
          <button class="a-btn a-btn-danger a-btn-sm" onclick="deletePost(${p.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  } catch (e) { toast(e.message, 'error'); }
}

function openPostForm(post = null) {
  openAModal(post ? '✏️ Sửa bài viết' : '➕ Thêm bài viết', `
    <form onsubmit="savePost(event, ${post?.id||'null'})">
      <div class="a-form-group"><label>Tiêu đề *</label><input type="text" id="pf-title" value="${post?.title||''}" required></div>
      <div class="form-row">
        <div class="a-form-group"><label>Danh mục</label><select id="pf-category"><option value="news"${post?.category==='news'?' selected':''}>Tin tức</option><option value="announcement"${post?.category==='announcement'?' selected':''}>Thông báo</option><option value="event"${post?.category==='event'?' selected':''}>Sự kiện</option><option value="other"${post?.category==='other'?' selected':''}>Khác</option></select></div>
        <div class="a-form-group"><label>Quyền truy cập</label><select id="pf-access">${accessOptions(post?.access_level)}</select></div>
      </div>
      <div class="a-form-group"><label>Tóm tắt</label><textarea id="pf-excerpt" rows="2">${post?.excerpt||''}</textarea></div>
      <div class="a-form-group"><label>Nội dung</label><textarea id="pf-content" rows="6">${post?.content||''}</textarea></div>
      <div class="a-form-group"><label>Ảnh bìa (URL)</label><input type="url" id="pf-image" value="${post?.featured_image||''}"></div>
      <div class="a-form-group"><label><input type="checkbox" id="pf-pinned"${post?.is_pinned?' checked':''}> 📌 Ghim bài viết</label></div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function savePost(e, id) {
  e.preventDefault();
  const body = { title: el('pf-title').value, excerpt: el('pf-excerpt').value, content: el('pf-content').value, category: el('pf-category').value, access_level: el('pf-access').value, is_pinned: el('pf-pinned').checked ? 1 : 0, featured_image: el('pf-image').value };
  try {
    if (id) await aApi(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await aApi('/api/posts', { method: 'POST', body: JSON.stringify(body) });
    toast('Lưu bài viết thành công!'); closeAModal(); pagePosts();
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePost(id) {
  confirmAction('Bạn có chắc muốn xóa bài viết này?', async () => {
    try { await aApi(`/api/posts/${id}`, { method: 'DELETE' }); toast('Đã xóa!'); pagePosts(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== PHOTOS =====
async function pagePhotos() {
  pc().innerHTML = `
    <div class="page-header"><h2>📸 Quản lý Hình ảnh</h2>
      <button class="a-btn a-btn-primary" onclick="openUploadPhotos()"><i class="fas fa-upload"></i> Upload ảnh</button>
    </div>
    <div class="a-table-wrap">
      <div class="a-table-header"><h3>Tất cả hình ảnh</h3>
        <div class="a-search"><input type="text" placeholder="🔍 Tìm..."></div>
      </div>
      <div id="photos-grid" class="admin-photo-grid"><div style="text-align:center;padding:40px;grid-column:1/-1"><i class="fas fa-spinner" style="font-size:30px;animation:spin 1s linear infinite"></i></div></div>
    </div>`;
  loadAdminPhotos();
}

async function loadAdminPhotos() {
  try {
    const photos = await aApi('/api/photos?limit=100');
    const grid = el('photos-grid');
    if (!photos.length) { grid.innerHTML = `<div style="text-align:center;padding:40px;grid-column:1/-1;color:#9ca3af"><i class="fas fa-images" style="font-size:36px;display:block;margin-bottom:10px"></i>Chưa có ảnh nào</div>`; return; }
    grid.innerHTML = photos.map(p => `
      <div class="admin-photo-item">
        <img src="${p.file_path}" alt="${p.title||''}" loading="lazy" onerror="this.src='/images/placeholder.png'">
        ${p.is_slider ? `<span class="slider-tag">Slider</span>` : ''}
        <div class="admin-photo-overlay">
          <button class="a-btn a-btn-warning a-btn-sm a-btn-icon" onclick='editPhoto(${JSON.stringify(p).replace(/'/g,"&#39;")})'><i class="fas fa-edit"></i></button>
          <button class="a-btn a-btn-danger a-btn-sm a-btn-icon" onclick="deletePhoto(${p.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openUploadPhotos() {
  openAModal('📤 Upload Hình ảnh', `
    <form onsubmit="uploadPhotos(event)">
      <div class="a-form-group"><label>Chọn album</label><select id="up-album"><option value="">-- Không có album --</option></select></div>
      <div class="a-form-group"><label>Quyền truy cập</label><select id="up-access">${accessOptions()}</select></div>
      <div class="a-form-group"><label><input type="checkbox" id="up-slider"> Thêm vào Slider trang chủ</label></div>
      <div class="a-form-group">
        <label>Chọn ảnh (nhiều ảnh)</label>
        <input type="file" id="up-files" multiple accept="image/*" onchange="previewFiles(this)" style="display:block;margin-top:6px">
        <div id="up-preview" class="file-preview"></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary"><i class="fas fa-upload"></i> Upload</button></div>
    </form>
  `);
  loadAlbumSelect('up-album');
}

async function loadAlbumSelect(selectId) {
  try {
    const albums = await aApi('/api/albums');
    const sel = el(selectId);
    if (!sel) return;
    albums.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

function previewFiles(input) {
  const preview = el('up-preview');
  if (!preview) return;
  preview.innerHTML = '';
  [...input.files].forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      const div = document.createElement('div');
      div.className = 'file-preview-item';
      div.innerHTML = `<img src="${e.target.result}" alt="">`;
      preview.appendChild(div);
    };
    reader.readAsDataURL(f);
  });
}

async function uploadPhotos(e) {
  e.preventDefault();
  const files = el('up-files').files;
  if (!files.length) { toast('Vui lòng chọn ảnh','error'); return; }
  const fd = new FormData();
  [...files].forEach(f => fd.append('photos', f));
  const albumVal = el('up-album').value;
  if (albumVal) fd.append('album_id', albumVal);
  fd.append('access_level', el('up-access').value);
  fd.append('is_slider', el('up-slider').checked ? '1' : '0');
  try {
    await fetch('/api/photos/upload?type=photos', { method: 'POST', headers: { Authorization: 'Bearer '+aToken }, body: fd });
    toast(`Upload ${files.length} ảnh thành công!`); closeAModal(); loadAdminPhotos();
  } catch (err) { toast(err.message,'error'); }
}

function editPhoto(photo) {
  openAModal('✏️ Sửa thông tin ảnh', `
    <form onsubmit="savePhoto(event,${photo.id})">
      <div class="a-form-group"><label>Tiêu đề</label><input type="text" id="ep-title" value="${photo.title||''}"></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="ep-desc" rows="2">${photo.description||''}</textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Quyền truy cập</label><select id="ep-access">${accessOptions(photo.access_level)}</select></div>
        <div class="a-form-group"><label>Thứ tự</label><input type="number" id="ep-order" value="${photo.display_order||0}"></div>
      </div>
      <div class="a-form-group"><label><input type="checkbox" id="ep-slider"${photo.is_slider?' checked':''}> Thêm vào Slider</label></div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function savePhoto(e, id) {
  e.preventDefault();
  const body = { title: el('ep-title').value, description: el('ep-desc').value, access_level: el('ep-access').value, display_order: parseInt(el('ep-order').value)||0, is_slider: el('ep-slider').checked };
  try { await aApi(`/api/photos/${id}`, { method:'PUT', body: JSON.stringify(body) }); toast('Đã lưu!'); closeAModal(); loadAdminPhotos(); }
  catch (err) { toast(err.message,'error'); }
}

async function deletePhoto(id) {
  confirmAction('Xóa ảnh này?', async () => {
    try { await aApi(`/api/photos/${id}`, { method:'DELETE' }); toast('Đã xóa!'); loadAdminPhotos(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== ALBUMS =====
async function pageAlbums() {
  pc().innerHTML = `<div class="page-header"><h2>📁 Quản lý Album</h2><button class="a-btn a-btn-primary" onclick="openAlbumForm()"><i class="fas fa-plus"></i> Thêm album</button></div><div class="a-table-wrap"><div class="a-table-header"><h3>Danh sách album</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Tên album</th><th>Ngày sự kiện</th><th>Số ảnh</th><th>Quyền</th><th>Thao tác</th></tr></thead><tbody id="albums-tbody"></tbody></table></div></div>`;
  try {
    const albums = await aApi('/api/albums');
    const tb = el('albums-tbody');
    if (!albums.length) { tb.innerHTML = `<tr><td colspan="5" class="a-table-empty"><i class="fas fa-folder-open"></i><p>Chưa có album</p></td></tr>`; return; }
    tb.innerHTML = albums.map(a => `<tr>
      <td><strong>${a.name}</strong><br><small style="color:#9ca3af">${a.description||''}</small></td>
      <td>${fmtDate(a.event_date)}</td>
      <td><span class="badge badge-public">${a.photo_count} ảnh</span></td>
      <td>${accessBadge(a.access_level)}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openAlbumForm(${JSON.stringify(a).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteAlbum(${a.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openAlbumForm(album=null) {
  openAModal(album?'✏️ Sửa album':'➕ Thêm album', `
    <form onsubmit="saveAlbum(event,${album?.id||'null'})">
      <div class="a-form-group"><label>Tên album *</label><input type="text" id="af-name" value="${album?.name||''}" required></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="af-desc" rows="2">${album?.description||''}</textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Ngày sự kiện</label><input type="date" id="af-date" value="${album?.event_date||''}"></div>
        <div class="a-form-group"><label>Quyền truy cập</label><select id="af-access">${accessOptions(album?.access_level)}</select></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveAlbum(e, id) {
  e.preventDefault();
  const body = { name: el('af-name').value, description: el('af-desc').value, event_date: el('af-date').value, access_level: el('af-access').value };
  try {
    if (id) await aApi(`/api/albums/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/albums', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu album thành công!'); closeAModal(); pageAlbums();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteAlbum(id) {
  confirmAction('Xóa album này?', async () => {
    try { await aApi(`/api/albums/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageAlbums(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== VIDEOS =====
async function pageVideos() {
  pc().innerHTML = `<div class="page-header"><h2>🎬 Quản lý Video</h2><button class="a-btn a-btn-primary" onclick="openVideoForm()"><i class="fas fa-plus"></i> Thêm video</button></div><div class="a-table-wrap"><div class="a-table-header"><h3>Danh sách video</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Thumbnail</th><th>Tiêu đề</th><th>Nổi bật</th><th>Quyền</th><th>Thao tác</th></tr></thead><tbody id="videos-tbody"></tbody></table></div></div>`;
  try {
    const videos = await aApi('/api/videos?limit=100');
    const tb = el('videos-tbody');
    if (!videos.length) { tb.innerHTML = `<tr><td colspan="5" class="a-table-empty"><i class="fas fa-video"></i><p>Chưa có video</p></td></tr>`; return; }
    tb.innerHTML = videos.map(v => {
      const ytId = v.youtube_url ? v.youtube_url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] : null;
      const thumb = v.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/default.jpg` : '');
      return `<tr>
        <td>${thumb ? `<img src="${thumb}" class="table-thumb" alt="">` : '🎬'}</td>
        <td><strong>${v.title}</strong><br><small style="color:#9ca3af">${v.description||''}</small></td>
        <td>${v.is_featured ? '⭐ Nổi bật' : '—'}</td>
        <td>${accessBadge(v.access_level)}</td>
        <td style="white-space:nowrap">
          <button class="a-btn a-btn-warning a-btn-sm" onclick='openVideoForm(${JSON.stringify(v).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
          <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteVideo(${v.id})"><i class="fas fa-trash"></i></button>
        </td></tr>`;
    }).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openVideoForm(video=null) {
  openAModal(video?'✏️ Sửa video':'➕ Thêm video', `
    <form onsubmit="saveVideo(event,${video?.id||'null'})">
      <div class="a-form-group"><label>Tiêu đề *</label><input type="text" id="vf-title" value="${video?.title||''}" required></div>
      <div class="a-form-group"><label>Link YouTube *</label><input type="url" id="vf-url" value="${video?.youtube_url||''}" placeholder="https://youtu.be/..."></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="vf-desc" rows="2">${video?.description||''}</textarea></div>
      <div class="a-form-group"><label>Thumbnail URL (tùy chọn)</label><input type="url" id="vf-thumb" value="${video?.thumbnail||''}"></div>
      <div class="form-row">
        <div class="a-form-group"><label>Quyền truy cập</label><select id="vf-access">${accessOptions(video?.access_level)}</select></div>
        <div class="a-form-group"><label><br><input type="checkbox" id="vf-featured"${video?.is_featured?' checked':''}> ⭐ Video nổi bật</label></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveVideo(e, id) {
  e.preventDefault();
  const body = { title: el('vf-title').value, youtube_url: el('vf-url').value, description: el('vf-desc').value, thumbnail: el('vf-thumb').value, access_level: el('vf-access').value, is_featured: el('vf-featured').checked };
  try {
    if (id) await aApi(`/api/videos/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/videos', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu video thành công!'); closeAModal(); pageVideos();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteVideo(id) {
  confirmAction('Xóa video này?', async () => {
    try { await aApi(`/api/videos/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageVideos(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== RESOURCES =====
async function pageResources() {
  pc().innerHTML = `<div class="page-header"><h2>📚 Kho Tài liệu</h2><button class="a-btn a-btn-primary" onclick="openResourceForm()"><i class="fas fa-plus"></i> Thêm tài liệu</button></div>
    <div class="a-table-wrap"><div class="a-table-header"><h3>Danh sách tài liệu</h3><div class="a-search"><input type="text" placeholder="🔍 Tìm..." oninput="filterTable(this,'res-tbody')"></div></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Tiêu đề</th><th>Danh mục</th><th>Loại</th><th>Kích thước</th><th>Quyền</th><th>Thao tác</th></tr></thead><tbody id="res-tbody"></tbody></table></div></div>`;
  try {
    const resources = await aApi('/api/resources?limit=100');
    const tb = el('res-tbody');
    if (!resources.length) { tb.innerHTML = `<tr><td colspan="6" class="a-table-empty"><i class="fas fa-book"></i><p>Chưa có tài liệu</p></td></tr>`; return; }
    tb.innerHTML = resources.map(r => `<tr>
      <td><strong>${r.title}</strong><br><small style="color:#9ca3af">${r.description||''}</small></td>
      <td>${r.category_name||'—'}</td>
      <td>${r.file_type ? `<span class="badge badge-student">${r.file_type.split('/')[1]||r.file_type}</span>` : (r.external_url ? '🔗 Link' : '—')}</td>
      <td>${fmtSize(r.file_size)}</td>
      <td>${accessBadge(r.access_level)}</td>
      <td style="white-space:nowrap">
        ${r.file_path||r.external_url ? `<a href="${r.file_path||r.external_url}" target="_blank" class="a-btn a-btn-outline a-btn-sm"><i class="fas fa-eye"></i></a>` : ''}
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openResourceEdit(${JSON.stringify(r).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteResource(${r.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openResourceForm() {
  openAModal('➕ Thêm tài liệu', `
    <form onsubmit="uploadResource(event)">
      <div class="a-form-group"><label>Tiêu đề *</label><input type="text" id="rf-title" required></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="rf-desc" rows="2"></textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Danh mục</label><select id="rf-cat"><option value="">-- Chọn danh mục --</option></select></div>
        <div class="a-form-group"><label>Quyền truy cập</label><select id="rf-access">${accessOptions()}</select></div>
      </div>
      <div class="a-form-group"><label>Tags (phân cách bằng dấu phẩy)</label><input type="text" id="rf-tags" placeholder="Toán, THPT, 2024"></div>
      <div class="a-tabs" style="margin-bottom:12px">
        <button type="button" class="a-tab active" onclick="switchResTab('file',this)">📁 Upload file</button>
        <button type="button" class="a-tab" onclick="switchResTab('link',this)">🔗 Link ngoài</button>
      </div>
      <div id="res-tab-file"><div class="a-form-group"><label>Chọn file</label><input type="file" id="rf-file"></div></div>
      <div id="res-tab-link" style="display:none"><div class="a-form-group"><label>URL liên kết</label><input type="url" id="rf-url" placeholder="https://drive.google.com/..."></div></div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary"><i class="fas fa-upload"></i> Lưu</button></div>
    </form>
  `);
  loadCatSelect('rf-cat');
}

async function loadCatSelect(selectId) {
  try {
    const cats = await aApi('/api/resource-categories');
    const sel = el(selectId); if (!sel) return;
    cats.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
  } catch (e) {}
}

function switchResTab(tab, btn) {
  document.querySelectorAll('.a-tab').forEach(t => t.classList.remove('active')); btn.classList.add('active');
  el('res-tab-file').style.display = tab==='file' ? '' : 'none';
  el('res-tab-link').style.display = tab==='link' ? '' : 'none';
}

async function uploadResource(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('title', el('rf-title').value);
  fd.append('description', el('rf-desc').value || '');
  fd.append('category_id', el('rf-cat').value || '');
  fd.append('access_level', el('rf-access').value);
  fd.append('tags', el('rf-tags').value || '');
  const fileInput = el('rf-file');
  if (fileInput && fileInput.files.length) fd.append('file', fileInput.files[0]);
  const urlInput = el('rf-url');
  if (urlInput) fd.append('external_url', urlInput.value || '');
  try {
    await fetch('/api/resources/upload?type=resources', { method:'POST', headers:{ Authorization:'Bearer '+aToken }, body: fd });
    toast('Thêm tài liệu thành công!'); closeAModal(); pageResources();
  } catch (err) { toast(err.message,'error'); }
}

function openResourceEdit(r) {
  openAModal('✏️ Sửa tài liệu', `
    <form onsubmit="saveResource(event,${r.id})">
      <div class="a-form-group"><label>Tiêu đề</label><input type="text" id="re-title" value="${r.title||''}"></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="re-desc" rows="2">${r.description||''}</textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Quyền truy cập</label><select id="re-access">${accessOptions(r.access_level)}</select></div>
        <div class="a-form-group"><label>Tags</label><input type="text" id="re-tags" value="${r.tags||''}"></div>
      </div>
      <div class="a-form-group"><label>Link ngoài (nếu có)</label><input type="url" id="re-url" value="${r.external_url||''}"></div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveResource(e, id) {
  e.preventDefault();
  const body = { title: el('re-title').value, description: el('re-desc').value, access_level: el('re-access').value, tags: el('re-tags').value, external_url: el('re-url').value };
  try { await aApi(`/api/resources/${id}`, { method:'PUT', body: JSON.stringify(body) }); toast('Đã lưu!'); closeAModal(); pageResources(); }
  catch (err) { toast(err.message,'error'); }
}

async function deleteResource(id) {
  confirmAction('Xóa tài liệu này?', async () => {
    try { await aApi(`/api/resources/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageResources(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== CATEGORIES =====
async function pageCategories() {
  pc().innerHTML = `<div class="page-header"><h2>📂 Danh mục Tài nguyên</h2><button class="a-btn a-btn-primary" onclick="openCatForm()"><i class="fas fa-plus"></i> Thêm danh mục</button></div><div class="a-table-wrap"><div style="overflow-x:auto"><table><thead><tr><th>Icon</th><th>Tên danh mục</th><th>Slug</th><th>Quyền</th><th>Thứ tự</th><th>Thao tác</th></tr></thead><tbody id="cats-tbody"></tbody></table></div></div>`;
  try {
    const cats = await aApi('/api/resource-categories');
    const tb = el('cats-tbody');
    if (!cats.length) { tb.innerHTML = `<tr><td colspan="6" class="a-table-empty"><i class="fas fa-folder"></i><p>Chưa có danh mục</p></td></tr>`; return; }
    tb.innerHTML = cats.map(c => `<tr>
      <td style="font-size:24px">${c.icon||'📁'}</td>
      <td><strong style="color:${c.color}">${c.name}</strong><br><small style="color:#9ca3af">${c.description||''}</small></td>
      <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px">${c.slug}</code></td>
      <td>${accessBadge(c.access_level)}</td>
      <td>${c.display_order}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openCatForm(${JSON.stringify(c).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteCat(${c.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openCatForm(cat=null) {
  openAModal(cat?'✏️ Sửa danh mục':'➕ Thêm danh mục', `
    <form onsubmit="saveCat(event,${cat?.id||'null'})">
      <div class="form-row">
        <div class="a-form-group"><label>Tên danh mục *</label><input type="text" id="cf-name" value="${cat?.name||''}" required></div>
        <div class="a-form-group"><label>Slug *</label><input type="text" id="cf-slug" value="${cat?.slug||''}" required placeholder="tai-lieu-giang-day"></div>
      </div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="cf-desc" rows="2">${cat?.description||''}</textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Icon (emoji)</label><input type="text" id="cf-icon" value="${cat?.icon||'📁'}" placeholder="📚"></div>
        <div class="a-form-group"><label>Màu sắc</label><input type="color" id="cf-color" value="${cat?.color||'#2563eb'}"></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Quyền truy cập</label><select id="cf-access">${accessOptions(cat?.access_level)}</select></div>
        <div class="a-form-group"><label>Thứ tự hiển thị</label><input type="number" id="cf-order" value="${cat?.display_order||0}"></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
  // Auto-slug from name
  el('cf-name').addEventListener('input', function() {
    if (!cat) el('cf-slug').value = this.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  });
}

async function saveCat(e, id) {
  e.preventDefault();
  const body = { name: el('cf-name').value, slug: el('cf-slug').value, description: el('cf-desc').value, icon: el('cf-icon').value, color: el('cf-color').value, access_level: el('cf-access').value, display_order: parseInt(el('cf-order').value)||0, is_active: 1 };
  try {
    if (id) await aApi(`/api/resource-categories/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/resource-categories', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu danh mục thành công!'); closeAModal(); pageCategories();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteCat(id) {
  confirmAction('Xóa danh mục này?', async () => {
    try { await aApi(`/api/resource-categories/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageCategories(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== NAV BUTTONS =====
async function pageNavButtons() {
  pc().innerHTML = `<div class="page-header"><h2>🔗 Phím Truy cập</h2><button class="a-btn a-btn-primary" onclick="openNavBtnForm()"><i class="fas fa-plus"></i> Thêm phím</button></div><div class="a-table-wrap"><div style="overflow-x:auto"><table><thead><tr><th>Icon</th><th>Nhãn</th><th>URL</th><th>Danh mục</th><th>Quyền</th><th>Thứ tự</th><th>Thao tác</th></tr></thead><tbody id="navbtn-tbody"></tbody></table></div></div>`;
  try {
    const buttons = await aApi('/api/nav-buttons');
    const tb = el('navbtn-tbody');
    if (!buttons.length) { tb.innerHTML = `<tr><td colspan="7" class="a-table-empty"><i class="fas fa-th-large"></i><p>Chưa có phím nào</p></td></tr>`; return; }
    tb.innerHTML = buttons.map(b => `<tr>
      <td><i class="${b.icon||'fas fa-link'}" style="color:${b.color};font-size:20px"></i></td>
      <td><strong>${b.label}</strong><br><small style="color:#9ca3af">${b.description||''}</small></td>
      <td><a href="${b.url||'#'}" target="_blank" style="color:#3b82f6;font-size:12px;max-width:180px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.url||'—'}</a></td>
      <td>${b.category||'—'}</td>
      <td>${accessBadge(b.access_level)}</td>
      <td>${b.display_order}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openNavBtnForm(${JSON.stringify(b).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteNavBtn(${b.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openNavBtnForm(btn=null) {
  openAModal(btn?'✏️ Sửa phím truy cập':'➕ Thêm phím truy cập', `
    <form onsubmit="saveNavBtn(event,${btn?.id||'null'})">
      <div class="form-row">
        <div class="a-form-group"><label>Nhãn phím *</label><input type="text" id="nb-label" value="${btn?.label||''}" required></div>
        <div class="a-form-group"><label>Icon (Font Awesome class)</label><input type="text" id="nb-icon" value="${btn?.icon||'fas fa-link'}" placeholder="fas fa-book"></div>
      </div>
      <div class="a-form-group"><label>URL liên kết</label><input type="text" id="nb-url" value="${btn?.url||''}" placeholder="https://... hoặc #section"></div>
      <div class="a-form-group"><label>Mô tả ngắn</label><input type="text" id="nb-desc" value="${btn?.description||''}"></div>
      <div class="form-row">
        <div class="a-form-group"><label>Danh mục</label><input type="text" id="nb-cat" value="${btn?.category||''}" placeholder="Tài nguyên, Công cụ..."></div>
        <div class="a-form-group"><label>Màu sắc</label><input type="color" id="nb-color" value="${btn?.color||'#2563eb'}"></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Quyền truy cập</label><select id="nb-access">${accessOptions(btn?.access_level)}</select></div>
        <div class="a-form-group"><label>Thứ tự</label><input type="number" id="nb-order" value="${btn?.display_order||0}"></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveNavBtn(e, id) {
  e.preventDefault();
  const body = { label: el('nb-label').value, icon: el('nb-icon').value, url: el('nb-url').value, description: el('nb-desc').value, category: el('nb-cat').value, color: el('nb-color').value, access_level: el('nb-access').value, display_order: parseInt(el('nb-order').value)||0, is_active: 1 };
  try {
    if (id) await aApi(`/api/nav-buttons/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/nav-buttons', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu phím thành công!'); closeAModal(); pageNavButtons();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteNavBtn(id) {
  confirmAction('Xóa phím truy cập này?', async () => {
    try { await aApi(`/api/nav-buttons/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageNavButtons(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== CHATBOX =====
async function pageChatbox() {
  pc().innerHTML = `<div class="page-header"><h2>💬 ChatBox Links</h2><button class="a-btn a-btn-primary" onclick="openChatboxForm()"><i class="fas fa-plus"></i> Thêm chatbox</button></div><div class="a-table-wrap"><div style="overflow-x:auto"><table><thead><tr><th>Tiêu đề</th><th>Platform</th><th>URL</th><th>Quyền</th><th>Thao tác</th></tr></thead><tbody id="chatbox-tbody"></tbody></table></div></div>`;
  try {
    const links = await aApi('/api/chatbox-links');
    const tb = el('chatbox-tbody');
    if (!links.length) { tb.innerHTML = `<tr><td colspan="5" class="a-table-empty"><i class="fas fa-comments"></i><p>Chưa có chatbox nào</p></td></tr>`; return; }
    tb.innerHTML = links.map(l => `<tr>
      <td><strong>${l.title}</strong><br><small style="color:#9ca3af">${l.description||''}</small></td>
      <td>${l.platform||'—'}</td>
      <td><a href="${l.url}" target="_blank" style="color:#3b82f6;font-size:12px">${l.url.substring(0,50)}...</a></td>
      <td>${accessBadge(l.access_level)}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openChatboxForm(${JSON.stringify(l).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteChatbox(${l.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openChatboxForm(link=null) {
  openAModal(link?'✏️ Sửa chatbox':'➕ Thêm chatbox', `
    <form onsubmit="saveChatbox(event,${link?.id||'null'})">
      <div class="a-form-group"><label>Tiêu đề *</label><input type="text" id="cb-title" value="${link?.title||''}" required></div>
      <div class="a-form-group"><label>URL *</label><input type="url" id="cb-url" value="${link?.url||''}" required placeholder="https://..."></div>
      <div class="a-form-group"><label>Mô tả</label><textarea id="cb-desc" rows="2">${link?.description||''}</textarea></div>
      <div class="form-row">
        <div class="a-form-group"><label>Platform</label><select id="cb-platform"><option value="zalo"${link?.platform==='zalo'?' selected':''}>Zalo</option><option value="facebook"${link?.platform==='facebook'?' selected':''}>Facebook</option><option value="telegram"${link?.platform==='telegram'?' selected':''}>Telegram</option><option value="google"${link?.platform==='google'?' selected':''}>Google Form</option><option value="other"${link?.platform==='other'?' selected':''}>Khác</option></select></div>
        <div class="a-form-group"><label>Quyền truy cập</label><select id="cb-access">${accessOptions(link?.access_level||'student')}</select></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveChatbox(e, id) {
  e.preventDefault();
  const body = { title: el('cb-title').value, url: el('cb-url').value, description: el('cb-desc').value, platform: el('cb-platform').value, access_level: el('cb-access').value };
  try {
    if (id) await aApi(`/api/chatbox-links/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/chatbox-links', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu chatbox thành công!'); closeAModal(); pageChatbox();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteChatbox(id) {
  confirmAction('Xóa chatbox này?', async () => {
    try { await aApi(`/api/chatbox-links/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageChatbox(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== TEACHERS =====
async function pageTeachers() {
  pc().innerHTML = `<div class="page-header"><h2>👨‍🏫 Hồ sơ Thầy Cô</h2><button class="a-btn a-btn-primary" onclick="openTeacherForm()"><i class="fas fa-plus"></i> Thêm hồ sơ</button></div><div class="a-table-wrap"><div style="overflow-x:auto"><table><thead><tr><th>Ảnh</th><th>Tên</th><th>Chức danh</th><th>Môn học</th><th>Trường</th><th>Hiển thị</th><th>Thao tác</th></tr></thead><tbody id="teachers-tbody"></tbody></table></div></div>`;
  try {
    const teachers = await aApi('/api/teachers');
    const tb = el('teachers-tbody');
    if (!teachers.length) { tb.innerHTML = `<tr><td colspan="7" class="a-table-empty"><i class="fas fa-chalkboard-teacher"></i><p>Chưa có hồ sơ</p></td></tr>`; return; }
    tb.innerHTML = teachers.map(t => `<tr>
      <td><img src="${t.avatar||'/images/default-avatar.png'}" class="table-avatar" onerror="this.src='/images/default-avatar.png'"></td>
      <td><strong>${t.display_name}</strong></td>
      <td>${t.title||'—'}</td>
      <td>${t.subject||'—'}</td>
      <td>${t.school||'—'}</td>
      <td>${t.is_public ? '<span class="badge badge-public">✅ Hiện</span>' : '<span class="badge badge-inactive">🚫 Ẩn</span>'}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openTeacherForm(${JSON.stringify(t).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        <button class="a-btn a-btn-danger a-btn-sm" onclick="deleteTeacher(${t.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openTeacherForm(teacher=null) {
  openAModal(teacher?'✏️ Sửa hồ sơ Thầy/Cô':'➕ Thêm hồ sơ Thầy/Cô', `
    <form onsubmit="saveTeacher(event,${teacher?.id||'null'})">
      <div class="form-row">
        <div class="a-form-group"><label>Tên hiển thị *</label><input type="text" id="tf-name" value="${teacher?.display_name||''}" required></div>
        <div class="a-form-group"><label>Chức danh</label><input type="text" id="tf-title" value="${teacher?.title||''}" placeholder="Giáo viên, Thạc sĩ..."></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Môn dạy</label><input type="text" id="tf-subject" value="${teacher?.subject||''}"></div>
        <div class="a-form-group"><label>Trường</label><input type="text" id="tf-school" value="${teacher?.school||''}"></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Email</label><input type="email" id="tf-email" value="${teacher?.email||''}"></div>
        <div class="a-form-group"><label>Số điện thoại</label><input type="text" id="tf-phone" value="${teacher?.phone||''}"></div>
      </div>
      <div class="a-form-group"><label>Ảnh đại diện (URL)</label><input type="url" id="tf-avatar" value="${teacher?.avatar||''}" placeholder="https://..."></div>
      <div class="a-form-group"><label>Giới thiệu bản thân</label><textarea id="tf-bio" rows="3">${teacher?.bio||''}</textarea></div>
      <div class="a-form-group"><label>Thành tích</label><textarea id="tf-achieve" rows="2">${teacher?.achievements||''}</textarea></div>
      <div class="a-form-group"><label><input type="checkbox" id="tf-public"${!teacher||teacher?.is_public?' checked':''}> 🌐 Hiển thị công khai</label></div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveTeacher(e, id) {
  e.preventDefault();
  const body = { display_name: el('tf-name').value, title: el('tf-title').value, subject: el('tf-subject').value, school: el('tf-school').value, email: el('tf-email').value, phone: el('tf-phone').value, avatar: el('tf-avatar').value, bio: el('tf-bio').value, achievements: el('tf-achieve').value, is_public: el('tf-public').checked };
  try {
    if (id) await aApi(`/api/teachers/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else await aApi('/api/teachers', { method:'POST', body: JSON.stringify(body) });
    toast('Lưu hồ sơ thành công!'); closeAModal(); pageTeachers();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteTeacher(id) {
  confirmAction('Xóa hồ sơ thầy/cô này?', async () => {
    try { await aApi(`/api/teachers/${id}`, { method:'DELETE' }); toast('Đã xóa!'); pageTeachers(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== USERS =====
async function pageUsers() {
  pc().innerHTML = `<div class="page-header"><h2>👥 Quản lý Users</h2><button class="a-btn a-btn-primary" onclick="openUserForm()"><i class="fas fa-plus"></i> Thêm user</button></div><div class="a-table-wrap"><div class="a-table-header"><h3>Danh sách tài khoản</h3><div class="a-search"><input type="text" placeholder="🔍 Tìm..." oninput="filterTable(this,'users-tbody')"></div></div><div style="overflow-x:auto"><table><thead><tr><th>Username</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody id="users-tbody"></tbody></table></div></div>`;
  try {
    const users = await aApi('/api/users');
    const tb = el('users-tbody');
    if (!users.length) { tb.innerHTML = `<tr><td colspan="7" class="a-table-empty"><i class="fas fa-users"></i><p>Chưa có user</p></td></tr>`; return; }
    tb.innerHTML = users.map(u => `<tr>
      <td><strong>${u.username}</strong></td>
      <td>${u.full_name||'—'}</td>
      <td>${u.email||'—'}</td>
      <td><span class="${roleClass(u.role)}">${roleLabel(u.role)}</span></td>
      <td>${u.is_active ? '<span class="badge badge-active">✅ Hoạt động</span>' : '<span class="badge badge-inactive">🚫 Khóa</span>'}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="a-btn a-btn-warning a-btn-sm" onclick='openUserForm(${JSON.stringify(u).replace(/"/g,"&quot;")})'><i class="fas fa-edit"></i></button>
        ${u.role!=='superadmin'?`<button class="a-btn a-btn-danger a-btn-sm" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>`:''}
      </td></tr>`).join('');
  } catch (e) { toast(e.message,'error'); }
}

function openUserForm(user=null) {
  const roleOptions = ['student','teacher','admin2',...(aUser.role==='superadmin'?['admin1','superadmin']:[])];
  openAModal(user?'✏️ Sửa tài khoản':'➕ Thêm tài khoản', `
    <form onsubmit="saveUser(event,${user?.id||'null'})">
      <div class="form-row">
        <div class="a-form-group"><label>Username *</label><input type="text" id="uf-username" value="${user?.username||''}"${user?' readonly':''}  required></div>
        <div class="a-form-group"><label>Mật khẩu${user?' (để trống giữ nguyên)':' *'}</label><input type="password" id="uf-password"${user?'':'required'} placeholder="${user?'Nhập nếu muốn đổi':''}"></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Họ tên</label><input type="text" id="uf-fullname" value="${user?.full_name||''}"></div>
        <div class="a-form-group"><label>Email</label><input type="email" id="uf-email" value="${user?.email||''}"></div>
      </div>
      <div class="form-row">
        <div class="a-form-group"><label>Vai trò</label><select id="uf-role">
          ${roleOptions.map(r => `<option value="${r}"${user?.role===r?' selected':''}>${roleLabel(r)}</option>`).join('')}
        </select></div>
        <div class="a-form-group"><label>Trạng thái</label><select id="uf-active">
          <option value="1"${user?.is_active!==0?' selected':''}>✅ Hoạt động</option>
          <option value="0"${user?.is_active===0?' selected':''}>🚫 Khóa</option>
        </select></div>
      </div>
      <div class="a-modal-footer"><button type="button" class="a-btn a-btn-outline" onclick="closeAModal()">Hủy</button><button type="submit" class="a-btn a-btn-primary">💾 Lưu</button></div>
    </form>
  `);
}

async function saveUser(e, id) {
  e.preventDefault();
  const body = { full_name: el('uf-fullname').value, email: el('uf-email').value, role: el('uf-role').value, is_active: parseInt(el('uf-active').value) };
  const pw = el('uf-password').value;
  if (pw) body.password = pw;
  try {
    if (id) await aApi(`/api/users/${id}`, { method:'PUT', body: JSON.stringify(body) });
    else { body.username = el('uf-username').value; body.password = pw; await aApi('/api/users', { method:'POST', body: JSON.stringify(body) }); }
    toast('Lưu tài khoản thành công!'); closeAModal(); pageUsers();
  } catch (err) { toast(err.message,'error'); }
}

async function deleteUser(id) {
  confirmAction('Khóa tài khoản này?', async () => {
    try { await aApi(`/api/users/${id}`, { method:'DELETE' }); toast('Đã khóa!'); pageUsers(); } catch (e) { toast(e.message,'error'); }
  });
}

// ===== SLIDER MANAGEMENT (FULL FEATURED) =====
let sliderDragSrcIndex = null;

async function pageSlider() {
  pc().innerHTML = `
    <div class="page-header">
      <h2>🖼️ Quản lý Slider Trang chủ</h2>
      <a href="/" target="_blank" class="a-btn a-btn-outline"><i class="fas fa-eye"></i> Xem trang chủ</a>
    </div>

    <!-- SETTINGS CARD -->
    <div class="a-table-wrap" style="margin-bottom:22px">
      <div class="a-table-header"><h3>⚙️ Cài đặt Slider</h3></div>
      <div style="padding:22px 24px" id="slider-settings-area">
        <div style="text-align:center;padding:20px"><i class="fas fa-spinner" style="font-size:24px;animation:spin 1s linear infinite"></i></div>
      </div>
    </div>

    <!-- UPLOAD CARD -->
    <div class="a-table-wrap" style="margin-bottom:22px">
      <div class="a-table-header">
        <h3>📤 Upload ảnh Slide</h3>
        <span style="font-size:12px;color:#9ca3af">Kéo thả hoặc chọn file (hỗ trợ JPG, PNG, WebP — nhiều ảnh cùng lúc)</span>
      </div>
      <div style="padding:20px 24px">
        <div class="sl-dropzone" id="sl-dropzone"
          ondragover="sliderDragOver(event)"
          ondragleave="sliderDragLeave(event)"
          ondrop="sliderDrop(event)"
          onclick="el('sl-file-input').click()">
          <i class="fas fa-cloud-upload-alt"></i>
          <p><strong>Kéo & thả ảnh vào đây</strong></p>
          <p style="font-size:12px;color:#9ca3af">hoặc <u>bấm để chọn ảnh</u> từ máy tính / điện thoại</p>
          <input type="file" id="sl-file-input" multiple accept="image/*"
            style="display:none" onchange="sliderFilesSelected(this.files)">
        </div>
        <!-- PENDING PREVIEWS (before upload) -->
        <div id="sl-pending-wrap" style="display:none;margin-top:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-weight:700;color:var(--a-primary)" id="sl-pending-count"></span>
            <div style="display:flex;gap:8px">
              <button class="a-btn a-btn-outline a-btn-sm" onclick="sliderClearPending()"><i class="fas fa-times"></i> Bỏ chọn</button>
              <button class="a-btn a-btn-primary" id="sl-upload-btn" onclick="sliderDoUpload()"><i class="fas fa-upload"></i> Upload tất cả</button>
            </div>
          </div>
          <div class="sl-pending-grid" id="sl-pending-grid"></div>
        </div>
      </div>
    </div>

    <!-- SLIDES LIST (reorder + manage) -->
    <div class="a-table-wrap">
      <div class="a-table-header">
        <h3>🗂️ Danh sách slide <span id="sl-count-badge" class="badge badge-public" style="margin-left:8px"></span></h3>
        <span style="font-size:12px;color:#9ca3af"><i class="fas fa-grip-vertical"></i> Kéo thả để sắp xếp thứ tự</span>
      </div>
      <div id="sl-list" style="padding:16px 20px;min-height:120px">
        <div style="text-align:center;padding:32px"><i class="fas fa-spinner" style="font-size:24px;animation:spin 1s linear infinite"></i></div>
      </div>
    </div>`;

  await loadSliderSettings();
  await loadSliderList();
}

async function loadSliderSettings() {
  try {
    const s = await aApi('/api/slider/settings');
    el('slider-settings-area').innerHTML = `
      <div class="form-row" style="margin-bottom:16px">
        <div class="a-form-group">
          <label>⏱️ Thời gian mỗi slide <small style="font-weight:400;color:#6b7280">(giây)</small></label>
          <div style="display:flex;align-items:center;gap:12px">
            <input type="range" id="sl-interval-range" min="1" max="15" step="0.5"
              value="${(s?.interval_ms||4000)/1000}"
              style="flex:1;accent-color:#f59e0b"
              oninput="el('sl-interval-num').value=this.value">
            <input type="number" id="sl-interval-num" min="1" max="15" step="0.5"
              value="${(s?.interval_ms||4000)/1000}"
              style="width:74px;padding:7px 10px;border:2px solid #e2e8f0;border-radius:8px;font-weight:700;text-align:center"
              oninput="el('sl-interval-range').value=this.value">
            <span style="color:#6b7280;font-size:13px">giây</span>
          </div>
        </div>
        <div class="a-form-group">
          <label>📊 Số slide hiển thị tối đa <small style="font-weight:400;color:#6b7280">(0 = không giới hạn)</small></label>
          <input type="number" id="sl-maxslides" min="0" step="1"
            value="${s?.max_slides||0}"
            style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;width:120px;font-weight:700;text-align:center">
        </div>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px;background:#f8fafc;padding:14px 18px;border-radius:10px">
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" id="sl-autoplay" style="width:16px;height:16px"${s?.auto_play!==0?' checked':''}>
          <span>▶️ Tự động chuyển slide</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" id="sl-arrows" style="width:16px;height:16px"${s?.show_arrows!==0?' checked':''}>
          <span>◀▶ Hiện nút mũi tên</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" id="sl-dots" style="width:16px;height:16px"${s?.show_dots!==0?' checked':''}>
          <span>⬤ Hiện chấm điều hướng</span>
        </label>
      </div>
      <button class="a-btn a-btn-primary" onclick="saveSliderSettings()">
        <i class="fas fa-save"></i> Lưu cài đặt
      </button>`;
  } catch (e) { toast(e.message,'error'); }
}

async function saveSliderSettings() {
  const body = {
    auto_play: el('sl-autoplay').checked ? 1 : 0,
    interval_ms: Math.round(parseFloat(el('sl-interval-num').value || 4) * 1000),
    show_arrows: el('sl-arrows').checked ? 1 : 0,
    show_dots: el('sl-dots').checked ? 1 : 0,
    max_slides: parseInt(el('sl-maxslides').value) || 0
  };
  try {
    await aApi('/api/slider/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('✅ Lưu cài đặt slider thành công!');
  } catch (err) { toast(err.message, 'error'); }
}

// --- DRAG & DROP UPLOAD ---
let sliderPendingFiles = [];

function sliderDragOver(e) {
  e.preventDefault();
  el('sl-dropzone').classList.add('dragover');
}
function sliderDragLeave(e) {
  el('sl-dropzone').classList.remove('dragover');
}
function sliderDrop(e) {
  e.preventDefault();
  el('sl-dropzone').classList.remove('dragover');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (!files.length) { toast('Vui lòng chọn file ảnh!', 'error'); return; }
  sliderFilesSelected(files);
}
function sliderFilesSelected(files) {
  const arr = [...files].filter(f => f.type.startsWith('image/'));
  if (!arr.length) { toast('Vui lòng chọn file ảnh!', 'error'); return; }
  sliderPendingFiles = arr;
  renderSliderPending();
}

function renderSliderPending() {
  const wrap = el('sl-pending-wrap');
  const grid = el('sl-pending-grid');
  const count = el('sl-pending-count');
  if (!sliderPendingFiles.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  count.textContent = `Đã chọn ${sliderPendingFiles.length} ảnh`;
  grid.innerHTML = '';
  sliderPendingFiles.forEach((f, i) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const div = document.createElement('div');
      div.className = 'sl-pending-item';
      div.innerHTML = `
        <img src="${ev.target.result}" alt="">
        <div class="sl-pending-name">${f.name}</div>
        <div class="sl-pending-size">${(f.size/1024).toFixed(0)} KB</div>
        <button class="sl-pending-remove" onclick="sliderRemovePending(${i})"><i class="fas fa-times"></i></button>`;
      grid.appendChild(div);
    };
    reader.readAsDataURL(f);
  });
}

function sliderRemovePending(i) {
  sliderPendingFiles.splice(i, 1);
  renderSliderPending();
}
function sliderClearPending() {
  sliderPendingFiles = [];
  el('sl-pending-wrap').style.display = 'none';
  el('sl-file-input').value = '';
}

async function sliderDoUpload() {
  if (!sliderPendingFiles.length) return;
  const btn = el('sl-upload-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner" style="animation:spin 1s linear infinite"></i> Đang upload...';
  let ok = 0, fail = 0;
  for (const f of sliderPendingFiles) {
    try {
      const fd = new FormData();
      fd.append('photos', f);
      fd.append('is_slider', '1');
      fd.append('access_level', 'public');
      await fetch('/api/photos/upload?type=photos', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + aToken },
        body: fd
      });
      ok++;
    } catch { fail++; }
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-upload"></i> Upload tất cả';
  if (ok) toast(`✅ Upload thành công ${ok} ảnh!`);
  if (fail) toast(`❌ Lỗi ${fail} ảnh`, 'error');
  sliderClearPending();
  await loadSliderList();
}

// --- SLIDE LIST WITH DRAG REORDER ---
async function loadSliderList() {
  const listEl = el('sl-list');
  if (!listEl) return;
  try {
    const photos = await aApi('/api/slider/photos?limit=999');
    const badge = el('sl-count-badge');
    if (badge) badge.textContent = photos.length + ' slide';
    if (!photos.length) {
      listEl.innerHTML = `<div style="text-align:center;padding:40px;color:#9ca3af"><i class="fas fa-images" style="font-size:40px;display:block;margin-bottom:12px;opacity:.4"></i><p>Chưa có ảnh slide nào. Upload ảnh ở trên nhé!</p></div>`;
      return;
    }
    listEl.innerHTML = `<div class="sl-sortable" id="sl-sortable">${photos.map((p, i) => `
      <div class="sl-slide-item" draggable="true" data-id="${p.id}" data-order="${i}"
        ondragstart="slReorderStart(event,${i})"
        ondragover="slReorderOver(event)"
        ondrop="slReorderDrop(event,${i})"
        ondragend="slReorderEnd(event)">
        <div class="sl-drag-handle"><i class="fas fa-grip-vertical"></i></div>
        <div class="sl-thumb">
          <img src="${p.file_path}" alt="${p.title||''}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
        </div>
        <div class="sl-info">
          <input class="sl-title-input" type="text" value="${(p.title||'').replace(/"/g,'&quot;')}"
            placeholder="Tiêu đề slide (tùy chọn)"
            onblur="sliderUpdateTitle(${p.id}, this.value)">
          <span class="sl-order-label">Thứ tự: <strong>${i+1}</strong></span>
        </div>
        <div class="sl-actions">
          <a href="${p.file_path}" target="_blank" class="a-btn a-btn-outline a-btn-sm" title="Xem ảnh gốc"><i class="fas fa-eye"></i></a>
          <button class="a-btn a-btn-danger a-btn-sm" onclick="sliderDeleteSlide(${p.id})" title="Xóa slide"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('')}</div>`;
  } catch (e) { toast(e.message, 'error'); }
}

// Drag-to-reorder
let slDragData = [];
function slReorderStart(e, fromIndex) {
  sliderDragSrcIndex = fromIndex;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function slReorderOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.sl-slide-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function slReorderEnd(e) {
  document.querySelectorAll('.sl-slide-item').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}
async function slReorderDrop(e, toIndex) {
  e.preventDefault();
  if (sliderDragSrcIndex === null || sliderDragSrcIndex === toIndex) return;
  const items = [...document.querySelectorAll('.sl-slide-item')];
  const ids = items.map(el => parseInt(el.dataset.id));
  // reorder
  const [moved] = ids.splice(sliderDragSrcIndex, 1);
  ids.splice(toIndex, 0, moved);
  // save order
  try {
    await Promise.all(ids.map((id, order) =>
      aApi(`/api/photos/${id}`, { method: 'PUT', body: JSON.stringify({ display_order: order, is_slider: true }) })
    ));
    toast('✅ Đã cập nhật thứ tự!');
    await loadSliderList();
  } catch (err) { toast(err.message, 'error'); }
  sliderDragSrcIndex = null;
}

async function sliderUpdateTitle(id, title) {
  try { await aApi(`/api/photos/${id}`, { method: 'PUT', body: JSON.stringify({ title, is_slider: true }) }); }
  catch (e) {}
}

async function sliderDeleteSlide(id) {
  confirmAction('Xóa slide này khỏi slider?', async () => {
    try {
      await aApi(`/api/photos/${id}`, { method: 'DELETE' });
      toast('Đã xóa slide!');
      await loadSliderList();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ===== SITE SETTINGS =====
async function pageSettings() {
  pc().innerHTML = `<div class="page-header"><h2>⚙️ Cài đặt Website</h2></div><div id="settings-content"><div class="loading" style="text-align:center;padding:48px"><i class="fas fa-spinner" style="font-size:30px;animation:spin 1s linear infinite"></i></div></div>`;
  try {
    const s = await aApi('/api/settings');
    el('settings-content').innerHTML = `
      <form onsubmit="saveSettings(event)">
        <div class="a-form-section"><h4>🏠 Thông tin cơ bản</h4>
          <div class="form-row">
            <div class="a-form-group"><label>Tên website</label><input type="text" id="s-name" value="${s.site_name||''}"></div>
            <div class="a-form-group"><label>Slogan / Tagline</label><input type="text" id="s-tagline" value="${s.site_tagline||''}"></div>
          </div>
          <div class="a-form-group"><label>Logo URL</label><input type="url" id="s-logo" value="${s.site_logo||''}" placeholder="https://..."></div>
          <div class="a-form-group"><label>Footer text</label><input type="text" id="s-footer" value="${s.footer_text||''}"></div>
        </div>
        <div class="a-form-section"><h4>📞 Thông tin liên hệ</h4>
          <div class="form-row">
            <div class="a-form-group"><label>Email liên hệ</label><input type="email" id="s-email" value="${s.contact_email||''}"></div>
            <div class="a-form-group"><label>Số điện thoại</label><input type="text" id="s-phone" value="${s.contact_phone||''}"></div>
          </div>
        </div>
        <div class="a-form-section"><h4>🔗 Mạng xã hội</h4>
          <div class="form-row">
            <div class="a-form-group"><label><i class="fab fa-facebook" style="color:#1877f2"></i> Facebook URL</label><input type="url" id="s-fb" value="${s.facebook_url||''}" placeholder="https://facebook.com/..."></div>
            <div class="a-form-group"><label><i class="fab fa-youtube" style="color:#ff0000"></i> YouTube URL</label><input type="url" id="s-yt" value="${s.youtube_url||''}" placeholder="https://youtube.com/..."></div>
          </div>
          <div class="a-form-group"><label><i class="fas fa-comment-dots" style="color:#0068ff"></i> Zalo URL</label><input type="url" id="s-zalo" value="${s.zalo_url||''}" placeholder="https://zalo.me/..."></div>
        </div>
        <div class="a-form-section"><h4>🎨 Màu sắc</h4>
          <div class="form-row">
            <div class="a-form-group"><label>Màu chính (Primary)</label><div style="display:flex;gap:10px;align-items:center"><input type="color" id="s-primary" value="${s.primary_color||'#1e3a5f'}"><input type="text" value="${s.primary_color||'#1e3a5f'}" style="width:100px" oninput="el('s-primary').value=this.value"></div></div>
            <div class="a-form-group"><label>Màu nhấn (Accent)</label><div style="display:flex;gap:10px;align-items:center"><input type="color" id="s-accent" value="${s.accent_color||'#f59e0b'}"><input type="text" value="${s.accent_color||'#f59e0b'}" style="width:100px" oninput="el('s-accent').value=this.value"></div></div>
          </div>
        </div>
        <div class="a-form-section">
          <h4>✨ Hiệu ứng Neon</h4>
          <div class="a-form-group">
            <label>⏱️ Chu kỳ nhấp nháy neon <small style="color:#6b7280;font-weight:400">(đơn vị: giây — càng lớn càng chậm)</small></label>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
              <input type="range" id="s-neon-range" min="1" max="10" step="0.5"
                value="${parseFloat(s.neon_cycle)||3}"
                style="flex:1;min-width:160px;accent-color:#f59e0b"
                oninput="
                  el('s-neon-num').value=this.value;
                  el('s-neon-preview').textContent=this.value+'s';
                  document.documentElement.style.setProperty('--neon-cycle',this.value+'s');
                ">
              <input type="number" id="s-neon-num" min="1" max="10" step="0.5"
                value="${parseFloat(s.neon_cycle)||3}"
                style="width:80px;padding:8px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;font-weight:700;text-align:center"
                oninput="
                  el('s-neon-range').value=this.value;
                  el('s-neon-preview').textContent=this.value+'s';
                  document.documentElement.style.setProperty('--neon-cycle',this.value+'s');
                ">
              <span style="font-size:13px;color:#6b7280">giây</span>
            </div>
            <div style="margin-top:12px;padding:14px 18px;background:#0f1f3a;border-radius:10px;display:inline-block">
              <span style="font-size:18px;font-weight:800;letter-spacing:0.5px;
                animation:neonPulse var(--neon-cycle,3s) ease-in-out infinite"
                id="s-neon-preview-wrap">
                ✨ NHÓM TRUYỀN CẢM HỨNG TOÁN
              </span>
              &nbsp;<span id="s-neon-preview" style="color:#f59e0b;font-size:12px">${parseFloat(s.neon_cycle)||3}s</span>
            </div>
            <div style="margin-top:6px;font-size:12px;color:#9ca3af">
              💡 Kéo thanh trượt để xem preview trực tiếp. Gợi ý: 2-4s là đẹp nhất.
            </div>
          </div>
        </div>
        <button type="submit" class="a-btn a-btn-primary a-btn" style="width:100%;justify-content:center;padding:12px;font-size:15px"><i class="fas fa-save"></i> Lưu tất cả cài đặt</button>
      </form>`;
  } catch (e) { toast(e.message,'error'); }
}

async function saveSettings(e) {
  e.preventDefault();
  const body = { site_name: el('s-name').value, site_tagline: el('s-tagline').value, site_logo: el('s-logo').value, footer_text: el('s-footer').value, contact_email: el('s-email').value, contact_phone: el('s-phone').value, facebook_url: el('s-fb').value, youtube_url: el('s-yt').value, zalo_url: el('s-zalo').value, primary_color: el('s-primary').value, accent_color: el('s-accent').value, neon_cycle: el('s-neon-num').value };
  try { await aApi('/api/settings', { method:'PUT', body: JSON.stringify(body) }); toast('Lưu cài đặt thành công!'); }
  catch (err) { toast(err.message,'error'); }
}

// ===== FILTER TABLE =====
function filterTable(input, tbodyId) {
  const q = input.value.toLowerCase();
  const rows = document.querySelectorAll(`#${tbodyId} tr`);
  rows.forEach(row => row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none');
}

// CSS animation for spinner
const style = document.createElement('style');
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

// ===== STATE =====
let token = localStorage.getItem('edu_token');
let currentUser = null;
let sliderInterval = null;
let currentSlide = 0;
let sliderPhotos = [];
let galleryPhotos = [];
let galleryOffset = 0;
let lightboxIndex = 0;
let currentAlbum = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkAuth();
  await Promise.all([
    loadSlider(),
    loadStats(),
    loadResourceCategories(),
    loadNavButtons(),
    loadAlbums(),
    loadPhotos(),
    loadVideos(),
    loadTeachers(),
    loadChatboxLinks(),
    loadNews(),
  ]);
  initScrollEffects();
});

// ===== API HELPER =====
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lỗi kết nối');
  }
  return res.json();
}

// ===== SETTINGS =====
async function loadSettings() {
  try {
    const s = await api('/api/settings');
    document.title = s.site_name || 'Nhóm Học Liệu Giáo Viên';
    setText('site-name', s.site_name);
    setText('hero-title', s.site_name);
    // Slogan: split into 2 lines (one idea per line)
    const tagline2Lines = (id) => {
      const tEl = getEl(id);
      if (tEl && s.site_tagline) {
        const parts = String(s.site_tagline).split(/\s*[-–—]\s*/).filter(Boolean);
        tEl.innerHTML = parts.map(t =>
          `<span class="tagline-line">${t.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
        ).join('');
      } else {
        setText(id, s.site_tagline);
      }
    };
    tagline2Lines('site-tagline');
    tagline2Lines('hero-tagline');
    setText('footer-site-name', s.site_name);
    setText('footer-tagline', s.site_tagline);
    setText('footer-text', s.footer_text);
    setText('footer-email', s.contact_email);
    setText('footer-phone', s.contact_phone);
    if (getEl('site-phone')) getEl('site-phone').textContent = s.contact_phone;
    if (getEl('site-email')) getEl('site-email').textContent = s.contact_email;
    // CSS custom props
    if (s.primary_color) document.documentElement.style.setProperty('--primary', s.primary_color);
    if (s.accent_color) document.documentElement.style.setProperty('--accent', s.accent_color);
    // Neon cycle duration
    const neonSec = parseFloat(s.neon_cycle) || 3;
    document.documentElement.style.setProperty('--neon-cycle', neonSec + 's');
    // Google Sign-In client id
    googleClientId = s.google_client_id || '';
    // Social
    const socials = [];
    if (s.facebook_url) socials.push(`<a href="${s.facebook_url}" target="_blank" title="Facebook"><i class="fab fa-facebook-f"></i></a>`);
    if (s.youtube_url) socials.push(`<a href="${s.youtube_url}" target="_blank" title="YouTube"><i class="fab fa-youtube"></i></a>`);
    if (s.zalo_url) socials.push(`<a href="${s.zalo_url}" target="_blank" title="Zalo"><i class="fas fa-comment-dots"></i></a>`);
    if (getEl('header-social')) getEl('header-social').innerHTML = socials.join('');
    if (getEl('footer-social')) getEl('footer-social').innerHTML = socials.join('');
  } catch (e) { console.log('Settings load error', e); }
}

// ===== AUTH =====
let googleClientId = '';
let googleInited = false;
const captchaIds = {};

async function checkAuth() {
  if (!token) { showGuestUI(); return; }
  try {
    currentUser = await api('/api/auth/me');
    showUserUI(currentUser);
    if (currentUser.profile_completed === 0) openProfileModal(currentUser);
  } catch { token = null; localStorage.removeItem('edu_token'); showGuestUI(); }
}

function showGuestUI() {
  getEl('auth-guest').style.display = 'block';
  getEl('auth-user').style.display = 'none';
}

function showUserUI(user) {
  getEl('auth-guest').style.display = 'none';
  getEl('auth-user').style.display = 'block';
  setText('user-name', user.full_name || user.username);
  if (user.avatar) getEl('user-avatar').src = user.avatar;
  const isAdmin = ['superadmin','admin1','admin2'].includes(user.role);
  if (getEl('admin-link')) getEl('admin-link').style.display = isAdmin ? 'flex' : 'none';
}

// ---- Captcha ----
async function loadCaptcha(which) {
  try {
    const d = await api('/api/auth/captcha');
    captchaIds[which] = d.id;
    const img = getEl(which + '-captcha-img');
    if (img) img.innerHTML = d.svg;
    const inp = getEl(which + '-captcha');
    if (inp) inp.value = '';
  } catch (e) {}
}

// ---- Google Sign-In ----
function initGoogleAuth() {
  if (googleInited || !googleClientId || !window.google?.accounts?.id) return;
  google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleCredential });
  googleInited = true;
}

function renderGoogleButtons() {
  initGoogleAuth();
  ['google-btn-login', 'google-btn-register'].forEach(id => {
    const el = getEl(id);
    if (!el) return;
    if (!googleClientId) {
      el.innerHTML = '<p class="auth-hint">⚙️ Đăng nhập Google đang được cấu hình…</p>';
      return;
    }
    if (googleInited && !el.dataset.rendered) {
      google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 300, text: id.includes('register') ? 'signup_with' : 'signin_with', locale: 'vi' });
      el.dataset.rendered = '1';
    }
  });
}

async function onGoogleCredential(response) {
  try {
    const data = await api('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('edu_token', token);
    closeLoginModal();
    showUserUI(currentUser);
    if (data.user.profile_completed === 0) {
      openProfileModal(data.user);
    } else {
      await Promise.all([loadResourceCategories(), loadNavButtons(), loadChatboxLinks(), loadNews()]);
    }
  } catch (err) {
    alert('Đăng nhập Google thất bại: ' + err.message);
  }
}

// ---- Auth modal ----
function openLoginModal() {
  getEl('login-modal').classList.add('active');
  loadCaptcha('login');
  renderGoogleButtons();
}
function closeLoginModal(e) {
  if (!e || e.target === getEl('login-modal') || e.type === 'click') {
    getEl('login-modal').classList.remove('active');
  }
}

function switchAuthTab(tab) {
  getEl('tab-login').classList.toggle('active', tab === 'login');
  getEl('tab-register').classList.toggle('active', tab === 'register');
  getEl('pane-login').style.display = tab === 'login' ? 'block' : 'none';
  getEl('pane-register').style.display = tab === 'register' ? 'block' : 'none';
  renderGoogleButtons();
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = getEl('login-btn');
  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  const errEl = getEl('login-error');
  errEl.style.display = 'none';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: getEl('login-username').value,
        password: getEl('login-password').value,
        captchaId: captchaIds.login,
        captchaText: getEl('login-captcha').value
      })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('edu_token', token);
    showUserUI(currentUser);
    closeLoginModal();
    if (data.user.profile_completed === 0) openProfileModal(data.user);
    // Reload protected content
    await Promise.all([loadResourceCategories(), loadNavButtons(), loadChatboxLinks(), loadNews()]);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    loadCaptcha('login');
  } finally {
    btn.disabled = false; btn.textContent = 'Đăng nhập';
  }
}

// ---- Register ----
function regTypeValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : '';
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = getEl('register-btn');
  btn.disabled = true; btn.textContent = 'Đang đăng ký...';
  const errEl = getEl('register-error');
  errEl.style.display = 'none';
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: getEl('reg-username').value.trim(),
        password: getEl('reg-password').value,
        full_name: getEl('reg-fullname').value.trim(),
        birth_date: getEl('reg-birthdate').value,
        zalo_phone: getEl('reg-zalo').value.trim(),
        email: getEl('reg-email').value.trim(),
        user_type: regTypeValue('reg-type'),
        workplace: getEl('reg-workplace').value.trim(),
        ward: getEl('reg-ward').value.trim()
      })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('edu_token', token);
    showUserUI(currentUser);
    closeLoginModal();
    alert('🎉 Đăng ký thành công! Chào mừng ' + (data.user.full_name || data.user.username));
    await Promise.all([loadResourceCategories(), loadNavButtons(), loadChatboxLinks(), loadNews()]);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Đăng ký tài khoản';
  }
}

// ---- Complete profile (after quick Google signup) ----
function openProfileModal(user) {
  getEl('pf-fullname').value = user.full_name || '';
  getEl('pf-birthdate').value = user.birth_date || '';
  getEl('pf-zalo').value = user.zalo_phone || '';
  getEl('pf-email').value = user.email || '';
  getEl('pf-workplace').value = user.workplace || '';
  getEl('pf-ward').value = user.ward || '';
  getEl('profile-modal').classList.add('active');
}

async function handleCompleteProfile(e) {
  e.preventDefault();
  const btn = getEl('profile-btn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const errEl = getEl('profile-error');
  errEl.style.display = 'none';
  try {
    const data = await api('/api/auth/complete-profile', {
      method: 'POST',
      body: JSON.stringify({
        full_name: getEl('pf-fullname').value.trim(),
        birth_date: getEl('pf-birthdate').value,
        zalo_phone: getEl('pf-zalo').value.trim(),
        email: getEl('pf-email').value.trim(),
        user_type: regTypeValue('pf-type'),
        workplace: getEl('pf-workplace').value.trim(),
        ward: getEl('pf-ward').value.trim()
      })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('edu_token', token);
    getEl('profile-modal').classList.remove('active');
    showUserUI(currentUser);
    openAccountModal();
    await Promise.all([loadResourceCategories(), loadNavButtons(), loadChatboxLinks(), loadNews()]);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu và tiếp tục';
  }
}

// ---- Account dashboard ----
function openAccountModal() {
  if (!currentUser) { openLoginModal(); return; }
  const u = currentUser;
  getEl('ac-fullname').value = u.full_name || '';
  getEl('ac-birthdate').value = u.birth_date || '';
  getEl('ac-zalo').value = u.zalo_phone || '';
  getEl('ac-email').value = u.email || '';
  getEl('ac-workplace').value = u.workplace || '';
  getEl('ac-ward').value = u.ward || '';
  const type = u.role === 'teacher' ? 'teacher' : 'student';
  const radio = document.querySelector(`input[name="ac-type"][value="${type}"]`);
  if (radio) radio.checked = true;
  const roleLabels = { superadmin: '⚡ Quản trị tối cao', admin1: '🔑 Admin 1', admin2: '🔑 Admin 2', teacher: '👨‍🏫 Giáo viên', student: '🎓 Học sinh' };
  setText('account-role-label', `${u.username} · ${roleLabels[u.role] || u.role}`);
  getEl('account-success').style.display = 'none';
  getEl('account-modal').classList.add('active');
}
function closeAccountModal(e) {
  if (!e || e.target === getEl('account-modal') || e.type === 'click') {
    getEl('account-modal').classList.remove('active');
  }
}

async function handleAccountSave(e) {
  e.preventDefault();
  const btn = getEl('account-btn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const errEl = getEl('account-error');
  errEl.style.display = 'none';
  getEl('account-success').style.display = 'none';
  try {
    const data = await api('/api/auth/complete-profile', {
      method: 'POST',
      body: JSON.stringify({
        full_name: getEl('ac-fullname').value.trim(),
        birth_date: getEl('ac-birthdate').value,
        zalo_phone: getEl('ac-zalo').value.trim(),
        email: getEl('ac-email').value.trim(),
        user_type: regTypeValue('ac-type'),
        workplace: getEl('ac-workplace').value.trim(),
        ward: getEl('ac-ward').value.trim()
      })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('edu_token', token);
    showUserUI(currentUser);
    getEl('account-success').style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu thay đổi';
  }
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('edu_token');
  showGuestUI();
  location.reload();
}

// ===== SLIDER =====
let sliderSettings = null;
let sliderProgressTimer = null;

async function loadSlider() {
  try {
    const [photos, settings] = await Promise.all([
      api('/api/slider/photos'),
      api('/api/slider/settings')
    ]);
    sliderPhotos = photos;
    sliderSettings = settings;
    const hero = document.getElementById('photo-slider') || document.querySelector('.hero-slider');
    const siteName = getEl('site-name')?.textContent || 'NHÓM TRUYỀN CẢM HỨNG TOÁN';
    const siteTag  = getEl('site-tagline')?.textContent || '';

    // Build track
    let trackEl = getEl('slider-track') || getEl('slider-container');
    if (!trackEl) return;

    if (!photos.length) {
      // No slides yet: hide the photo slider section (welcome hero is static above)
      if (hero) hero.style.display = 'none';
      return;
    }
    if (hero) hero.style.display = '';

    // Clean photo slides — full image visible (object-fit: contain) with blurred fill
    trackEl.innerHTML = photos.map((p) => `
      <div class="slide">
        <div class="slide-bg" style="background-image:url('${p.file_path}')"></div>
        <img class="slide-img" src="${p.file_path}" alt="${(p.title || '').replace(/"/g, '&quot;')}" loading="lazy">
      </div>
    `).join('');

    // Dots
    const dots = getEl('slider-dots');
    dots.innerHTML = photos.map((_, i) =>
      `<button class="slider-dot${i===0?' active':''}" onclick="goToSlide(${i})"></button>`
    ).join('');

    // Progress bar
    if (!getEl('slider-progress')) {
      const pb = document.createElement('div');
      pb.id = 'slider-progress'; pb.className = 'slider-progress';
      hero.appendChild(pb);
    }

    // Controls visibility
    const showArr = settings?.show_arrows !== 0;
    const showDots = settings?.show_dots !== 0;
    getEl('slider-prev').style.display = showArr ? '' : 'none';
    getEl('slider-next').style.display = showArr ? '' : 'none';
    getEl('slider-dots').style.display = showDots ? '' : 'none';

    // Touch swipe
    initSliderTouch();

    // Auto play
    if (settings?.auto_play !== 0) startSliderAuto();

  } catch (e) { console.log('Slider error', e); }
}

function startSliderAuto() {
  if (sliderInterval) clearInterval(sliderInterval);
  const ms = sliderSettings?.interval_ms || 4000;
  startProgressBar(ms);
  sliderInterval = setInterval(() => {
    changeSlide(1);
    startProgressBar(ms);
  }, ms);
}

function startProgressBar(ms) {
  const pb = getEl('slider-progress');
  if (!pb) return;
  pb.style.transition = 'none';
  pb.style.width = '0%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pb.style.transition = `width ${ms}ms linear`;
      pb.style.width = '100%';
    });
  });
}

function changeSlide(dir) {
  const total = sliderPhotos.length || 1;
  currentSlide = (currentSlide + dir + total) % total;
  goToSlide(currentSlide);
}

function goToSlide(index) {
  currentSlide = index;
  const track = getEl('slider-track') || getEl('slider-container');
  if (track) {
    // Pixel-perfect alignment: always center each slide exactly
    const hero = document.getElementById('photo-slider') || document.querySelector('.hero-slider');
    if (hero) hero.scrollLeft = 0; // neutralize any stray native scroll
    const w = (hero && hero.clientWidth) || track.clientWidth;
    track.style.transform = `translateX(-${index * w}px)`;
  }
  document.querySelectorAll('.slider-dot').forEach((d, i) => d.classList.toggle('active', i === index));
  if (sliderSettings?.auto_play !== 0) startProgressBar(sliderSettings?.interval_ms || 4000);
}

// Re-align current slide on resize / orientation change
window.addEventListener('resize', () => { if (sliderPhotos.length) goToSlide(currentSlide); });
window.addEventListener('orientationchange', () => { if (sliderPhotos.length) setTimeout(() => goToSlide(currentSlide), 300); });

function initSliderTouch() {
  const hero = document.getElementById('photo-slider') || document.querySelector('.hero-slider');
  if (!hero) return;
  let touchStartX = 0;
  hero.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) changeSlide(diff > 0 ? 1 : -1);
  }, { passive: true });
  // Keep slides perfectly centered: cancel any accidental native horizontal scroll
  hero.addEventListener('scroll', () => { if (hero.scrollLeft !== 0) hero.scrollLeft = 0; }, { passive: true });
}

// ===== STATS =====
async function loadStats() {
  try {
    const stats = await api('/api/admin/stats').catch(() => null);
    if (!stats) return;
    animateCount('stat-resources', stats.resources);
    animateCount('stat-photos', stats.photos);
    animateCount('stat-videos', stats.videos);
    animateCount('stat-teachers', stats.teachers);
  } catch (e) {}
}

function animateCount(id, target) {
  const el = getEl(id);
  if (!el) return;
  let current = 0;
  const step = Math.ceil(target / 40);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current.toLocaleString();
    if (current >= target) clearInterval(timer);
  }, 30);
}

// ===== RESOURCE CATEGORIES =====
async function loadResourceCategories() {
  try {
    const cats = await api('/api/resource-categories');
    const grid = getEl('resource-grid');
    if (!cats.length) { grid.innerHTML = emptyState('📂', 'Chưa có kho tài nguyên nào'); return; }

    grid.innerHTML = cats.map(c => `
      <div class="resource-card" style="border-left-color:${c.color};--card-color:${c.color}" onclick="openResourceCategory(${c.id}, '${esc(c.name)}', '${c.access_level}')">
        <span class="access-badge ${badgeClass(c.access_level)}">${accessLabel(c.access_level)}</span>
        <span class="resource-card-icon">${c.icon || '📁'}</span>
        <h3>${c.name}</h3>
        <p>${c.description || 'Kho tài liệu ' + c.name}</p>
      </div>
    `).join('');

    // Footer resource list
    const fl = getEl('footer-resources');
    if (fl) fl.innerHTML = cats.slice(0, 6).map(c => `<li><a href="#resources">${c.icon || '📁'} ${c.name}</a></li>`).join('');
  } catch (e) { console.log('Resource cats error', e); }
}

async function openResourceCategory(id, name, accessLevel) {
  const userRole = currentUser?.role || 'public';
  const roleLevel = { public: 0, student: 1, teacher: 2, admin2: 3, admin1: 4, superadmin: 5 };
  if ((roleLevel[userRole] || 0) < (roleLevel[accessLevel] || 0)) {
    openLoginModal();
    return;
  }
  // Show resource modal
  showResourceModal(id, name);
}

function showResourceModal(categoryId, categoryName) {
  const existing = document.getElementById('resource-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'resource-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:780px;width:95%">
      <button class="modal-close" onclick="document.getElementById('resource-modal').remove()"><i class="fas fa-times"></i></button>
      <h2 style="color:var(--primary);margin-bottom:6px">📂 ${categoryName}</h2>
      <div style="margin-bottom:20px"><input type="text" placeholder="🔍 Tìm kiếm tài liệu..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px" oninput="searchResources(${categoryId}, this.value)"></div>
      <div id="resource-list-content"><div class="loading"><i class="fas fa-spinner"></i></div></div>
    </div>
  `;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  fetchResources(categoryId, '');
}

let resourceSearchTimer;
function searchResources(categoryId, q) {
  clearTimeout(resourceSearchTimer);
  resourceSearchTimer = setTimeout(() => fetchResources(categoryId, q), 350);
}

async function fetchResources(categoryId, search = '') {
  const el = getEl('resource-list-content');
  if (!el) return;
  try {
    el.innerHTML = '<div class="loading"><i class="fas fa-spinner"></i></div>';
    const resources = await api(`/api/resources?category_id=${categoryId}&search=${encodeURIComponent(search)}&limit=50`);
    if (!resources.length) { el.innerHTML = emptyState('📄', 'Chưa có tài liệu nào'); return; }
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">` +
      resources.map(r => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
          <span style="font-size:28px">${fileIcon(r.file_type)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:var(--primary);font-size:14px;margin-bottom:2px">${r.title}</div>
            <div style="font-size:12px;color:#6b7280">${r.description || ''}</div>
            ${r.tags ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px">${r.tags}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            ${r.external_url ? `<a href="${r.external_url}" target="_blank" class="btn-submit" style="padding:6px 14px;font-size:12px;width:auto;display:inline-flex;align-items:center;gap:6px"><i class="fas fa-external-link-alt"></i> Mở</a>` : ''}
            ${r.file_path ? `<a href="/api/resources/${r.id}/download${token?'?token='+token:''}" class="btn-submit" style="padding:6px 14px;font-size:12px;width:auto;display:inline-flex;align-items:center;gap:6px;background:#059669"><i class="fas fa-download"></i> Tải</a>` : ''}
          </div>
        </div>
      `).join('') + '</div>';
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>${e.message}</p></div>`;
  }
}

// ===== NAV BUTTONS =====
async function loadNavButtons() {
  try {
    const buttons = await api('/api/nav-buttons');
    const grid = getEl('nav-buttons-grid');
    if (!buttons.length) { grid.parentElement.parentElement.style.display = 'none'; return; }
    grid.innerHTML = buttons.map(b => `
      <a href="${b.url || '#'}" ${b.url && !b.url.startsWith('#') ? 'target="_blank"' : ''} class="nav-btn-card" style="--btn-color:${b.color}">
        <i class="${b.icon || 'fas fa-link'}"></i>
        <span>${b.label}</span>
        ${b.description ? `<small style="color:#9ca3af;font-size:11px">${b.description}</small>` : ''}
      </a>
    `).join('');
  } catch (e) { console.log('Nav buttons error', e); }
}

// ===== ALBUMS =====
async function loadAlbums() {
  try {
    const albums = await api('/api/albums');
    const tabs = getEl('album-tabs');
    if (!tabs) return;
    tabs.innerHTML = `<button class="album-tab active" onclick="filterByAlbum(null, this)">Tất cả</button>` +
      albums.map(a => `<button class="album-tab" onclick="filterByAlbum(${a.id}, this)">${a.name} <small>(${a.photo_count})</small></button>`).join('');
  } catch (e) {}
}

function filterByAlbum(albumId, btn) {
  currentAlbum = albumId;
  galleryOffset = 0;
  galleryPhotos = [];
  document.querySelectorAll('.album-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadPhotos(true);
}

// ===== PHOTOS =====
async function loadPhotos(reset = false) {
  try {
    if (reset) { galleryOffset = 0; galleryPhotos = []; }
    const url = `/api/photos?limit=12&offset=${galleryOffset}${currentAlbum ? '&album_id=' + currentAlbum : ''}`;
    const photos = await api(url);
    galleryPhotos = [...galleryPhotos, ...photos];
    renderPhotos();
    galleryOffset += 12;
    const moreBtn = getEl('load-more-photos');
    if (moreBtn) moreBtn.style.display = photos.length < 12 ? 'none' : 'inline-flex';
  } catch (e) { console.log('Photos error', e); }
}

function renderPhotos() {
  const grid = getEl('photo-grid');
  if (!galleryPhotos.length) { grid.innerHTML = emptyState('📷', 'Chưa có hình ảnh nào'); return; }
  grid.innerHTML = galleryPhotos.map((p, i) => `
    <div class="photo-item" onclick="openLightbox(${i})">
      <img src="${p.file_path}" alt="${p.title || ''}" loading="lazy" onerror="this.src='/images/placeholder.png'">
      <div class="photo-overlay"><span>${p.title || ''}</span></div>
    </div>
  `).join('');
}

function loadMorePhotos() { loadPhotos(false); }

// ===== LIGHTBOX =====
function openLightbox(index) {
  lightboxIndex = index;
  updateLightbox();
  getEl('lightbox').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function updateLightbox() {
  const p = galleryPhotos[lightboxIndex];
  if (!p) return;
  getEl('lightbox-img').src = p.file_path;
  getEl('lightbox-caption').textContent = p.title || '';
}

function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + galleryPhotos.length) % galleryPhotos.length;
  updateLightbox();
}

function closeLightbox(e) {
  if (!e || e.target === getEl('lightbox')) {
    getEl('lightbox').classList.remove('active');
    document.body.style.overflow = '';
  }
}

document.addEventListener('keydown', e => {
  if (getEl('lightbox').classList.contains('active')) {
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
    if (e.key === 'Escape') closeLightbox();
  }
});

// ===== VIDEOS =====
async function loadVideos() {
  try {
    const videos = await api('/api/videos?limit=6');
    const grid = getEl('video-grid');
    if (!videos.length) { grid.innerHTML = emptyState('🎬', 'Chưa có video nào'); return; }
    grid.innerHTML = videos.map(v => {
      const ytId = extractYouTubeId(v.youtube_url);
      const thumb = v.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '');
      return `
        <div class="video-card" onclick="openVideo('${v.youtube_url || ''}', '${esc(v.title)}')">
          <div class="video-thumb">
            ${thumb ? `<img src="${thumb}" alt="${esc(v.title)}" loading="lazy">` : '<div style="width:100%;height:100%;background:#1a1a1a"></div>'}
            <div class="video-play-btn"><i class="fas fa-play-circle"></i></div>
          </div>
          <div class="video-info">
            <h3>${v.title}</h3>
            <p>${v.description || ''}</p>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) { console.log('Videos error', e); }
}

function openVideo(url, title) {
  if (!url) return;
  const ytId = extractYouTubeId(url);
  const embedUrl = ytId ? `https://www.youtube.com/embed/${ytId}?autoplay=1` : url;
  getEl('video-wrapper').innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay"></iframe>`;
  getEl('video-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeVideoModal(e) {
  if (!e || e.target === getEl('video-modal')) {
    getEl('video-modal').classList.remove('active');
    getEl('video-wrapper').innerHTML = '';
    document.body.style.overflow = '';
  }
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/user\/\S+\/\S+\/|\/shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ===== TEACHERS =====
async function loadTeachers() {
  try {
    const teachers = await api('/api/teachers');
    const grid = getEl('teachers-grid');
    if (!teachers.length) { grid.innerHTML = emptyState('👨‍🏫', 'Chưa có thông tin thành viên'); return; }
    grid.innerHTML = teachers.map(t => `
      <div class="teacher-card">
        <img class="teacher-avatar" src="${t.avatar || '/images/default-avatar.png'}" alt="${t.display_name}" onerror="this.src='/images/default-avatar.png'">
        <h3>${t.display_name}</h3>
        ${t.title ? `<div class="teacher-title">${t.title}</div>` : ''}
        ${t.subject ? `<div class="teacher-subject"><i class="fas fa-book"></i> ${t.subject}</div>` : ''}
        ${t.school ? `<div class="teacher-subject"><i class="fas fa-school"></i> ${t.school}</div>` : ''}
        ${t.bio ? `<p>${t.bio}</p>` : ''}
        <div class="teacher-contact">
          ${t.email ? `<a href="mailto:${t.email}" title="Email"><i class="fas fa-envelope"></i></a>` : ''}
          ${t.phone ? `<a href="tel:${t.phone}" title="Điện thoại"><i class="fas fa-phone"></i></a>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) { console.log('Teachers error', e); }
}

// ===== CHATBOX LINKS =====
async function loadChatboxLinks() {
  try {
    const links = await api('/api/chatbox-links');
    const grid = getEl('chatbox-grid');
    const section = document.getElementById('chatbox');
    if (!links.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    const icons = { zalo: 'fas fa-comment-dots', facebook: 'fab fa-facebook-messenger', telegram: 'fab fa-telegram', google: 'fab fa-google', default: 'fas fa-comments' };
    grid.innerHTML = links.map(l => {
      const icon = icons[(l.platform || '').toLowerCase()] || icons.default;
      return `
        <a href="${l.url}" target="_blank" class="chatbox-card">
          <i class="${icon}"></i>
          <div class="chatbox-card-info">
            <h3>${l.title}</h3>
            <p>${l.description || ''}</p>
            <span class="chatbox-card-btn">Truy cập <i class="fas fa-arrow-right"></i></span>
          </div>
        </a>
      `;
    }).join('');
  } catch (e) { console.log('Chatbox error', e); }
}

// ===== NEWS =====
async function loadNews() {
  try {
    const posts = await api('/api/posts?limit=6');
    const grid = getEl('news-grid');
    if (!posts.length) { grid.innerHTML = emptyState('📰', 'Chưa có bài viết nào'); return; }
    const cats = { news: 'Tin tức', announcement: 'Thông báo', event: 'Sự kiện', other: 'Khác' };
    grid.innerHTML = posts.map(p => `
      <div class="news-card">
        <div class="news-card-img">
          ${p.featured_image ? `<img src="${p.featured_image}" alt="${esc(p.title)}" loading="lazy">` : '📰'}
        </div>
        <div class="news-card-body">
          <span class="news-badge">${cats[p.category] || 'Tin tức'}</span>
          ${p.is_pinned ? '<span class="pinned-badge">📌 Ghim</span>' : ''}
          <h3>${p.title}</h3>
          <p>${p.excerpt || ''}</p>
          <div class="news-meta">
            <span><i class="fas fa-user"></i> ${p.author_name || 'Admin'}</span>
            <span><i class="fas fa-calendar"></i> ${formatDate(p.published_at)}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) { console.log('News error', e); }
}

// ===== SCROLL EFFECTS =====
function initScrollEffects() {
  window.addEventListener('scroll', () => {
    const btn = getEl('back-to-top');
    if (btn) btn.classList.toggle('visible', window.scrollY > 400);
  });
  initAutoHideHeader();
}

// ===== AUTO-HIDE HEADER ON MOBILE (hide on scroll down, show on scroll up) =====
function initAutoHideHeader() {
  const header = getEl('header');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const isMobile = window.innerWidth <= 768;
      if (!isMobile) {
        header.classList.remove('header-hidden');
      } else if (y > lastY + 4 && y > 120) {
        // scrolling down → hide header for easier reading
        header.classList.add('header-hidden');
        const nav = getEl('nav-list');
        if (nav) nav.classList.remove('open');
      } else if (y < lastY - 4 || y <= 120) {
        // scrolling up (or near top) → show header again
        header.classList.remove('header-hidden');
      }
      lastY = y;
      ticking = false;
    });
  }, { passive: true });
}

// ===== NAV TOGGLE =====
function toggleNav() {
  getEl('nav-list').classList.toggle('open');
}

// ===== HELPERS =====
function getEl(id) { return document.getElementById(id); }
function setText(id, text) { const el = getEl(id); if (el && text) el.textContent = text; }
function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function emptyState(icon, msg) { return `<div class="empty-state"><i>${icon}</i><p>${msg}</p></div>`; }
function badgeClass(level) { return { public: 'badge-public', student: 'badge-student', teacher: 'badge-teacher', admin1: 'badge-admin', admin2: 'badge-admin', superadmin: 'badge-admin' }[level] || 'badge-public'; }
function accessLabel(level) { return { public: '🌐 Công khai', student: '👤 Học sinh', teacher: '👨‍🏫 Giáo viên', admin1: '🔑 Admin 1', admin2: '🔑 Admin 2', superadmin: '⚡ Super' }[level] || level; }
function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📘';
  if (mime.includes('excel') || mime.includes('sheet')) return '📗';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📙';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('video')) return '🎬';
  if (mime.includes('audio')) return '🎵';
  if (mime.includes('zip') || mime.includes('rar')) return '📦';
  return '📄';
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ===== SMART SEARCH (Fast Search + AI Assistant) =====
const TYPE_META = {
  resource: { icon: 'fa-file-alt', label: 'Tài liệu' },
  post: { icon: 'fa-newspaper', label: 'Tin tức' },
  video: { icon: 'fa-video', label: 'Video' },
  teacher: { icon: 'fa-chalkboard-teacher', label: 'Thầy/Cô' },
  album: { icon: 'fa-images', label: 'Album ảnh' },
  category: { icon: 'fa-folder', label: 'Danh mục' },
  chatbox: { icon: 'fa-comments', label: 'Liên kết' },
  nav: { icon: 'fa-link', label: 'Liên kết' },
};

const searchInput = document.getElementById('search-input');
const searchDropdown = document.getElementById('search-dropdown');
const searchOverlay = document.getElementById('search-overlay');
const searchAiToggle = document.getElementById('search-ai-toggle');
const searchAiPanel = document.getElementById('search-ai-panel');
const searchAiClose = document.getElementById('search-ai-close');
const searchAiMessages = document.getElementById('search-ai-messages');
const searchAiForm = document.getElementById('search-ai-form');
const searchAiInput = document.getElementById('search-ai-input');

let aiSessionId = sessionStorage.getItem('search_ai_session');
if (!aiSessionId) {
  aiSessionId = crypto.randomUUID();
  sessionStorage.setItem('search_ai_session', aiSessionId);
}
let aiConversation = [];
let lastSearchQuery = '';

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function resultIconHtml(r) {
  if (r.image) return `<img src="${r.image}" alt="">`;
  const meta = TYPE_META[r.type] || { icon: 'fa-circle' };
  return `<i class="fas ${meta.icon}"></i>`;
}

function renderSkeleton() {
  let html = '<div class="search-dropdown-section">';
  for (let i = 0; i < 4; i++) {
    html += `<div class="search-skeleton">
      <div class="search-skeleton-box" style="width:38px;height:38px"></div>
      <div style="flex:1">
        <div class="search-skeleton-box" style="width:70%;height:14px;margin-bottom:6px"></div>
        <div class="search-skeleton-box" style="width:40%;height:11px"></div>
      </div>
    </div>`;
  }
  return html + '</div>';
}

function renderEmpty(query) {
  return `<div class="search-empty">
    Không tìm thấy kết quả cho "<strong>${escapeHtml(query)}</strong>"
    <br>
    <button class="btn-ask-ai" id="search-empty-ask-ai"><i class="fas fa-robot"></i> Hỏi trợ lý AI tìm giúp bạn</button>
  </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderResults(data, query) {
  if (!data.results || data.results.length === 0) {
    searchDropdown.innerHTML = renderEmpty(query);
    const btn = document.getElementById('search-empty-ask-ai');
    if (btn) btn.addEventListener('click', () => openAiPanel(query));
    return;
  }
  let html = `<div class="search-dropdown-section">
    <div class="search-dropdown-label">Kết quả (${data.total})</div>`;
  data.results.forEach((r, i) => {
    const meta = TYPE_META[r.type] || { label: r.type };
    html += `<div class="search-result-item" data-idx="${i}" data-type="${r.type}" data-id="${r.id}" data-url="${escapeHtml(r.url)}">
      <div class="search-result-icon">${resultIconHtml(r)}</div>
      <div class="search-result-text">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        ${r.snippet ? `<div class="search-result-snippet">${escapeHtml(r.snippet)}</div>` : ''}
      </div>
      <div class="search-result-type">${meta.label}</div>
    </div>`;
  });
  html += '</div>';
  searchDropdown.innerHTML = html;

  searchDropdown.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      trackClick(query, { type: el.dataset.type, id: el.dataset.id }, idx, false);
      closeDropdown();
      window.location.hash = '';
      window.location.href = el.dataset.url || '#';
    });
  });
}

const runFastSearch = debounce(async (query) => {
  if (!query.trim()) { closeDropdown(); return; }
  searchDropdown.innerHTML = renderSkeleton();
  openDropdown();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&limit=8`);
    lastSearchQuery = query;
    renderResults(data, query);
  } catch (e) {
    searchDropdown.innerHTML = `<div class="search-empty">Lỗi tìm kiếm, vui lòng thử lại.</div>`;
  }
}, 200);

function openDropdown() { searchDropdown.classList.add('open'); searchOverlay.classList.add('open'); }
function closeDropdown() { searchDropdown.classList.remove('open'); searchOverlay.classList.remove('open'); }

searchInput.addEventListener('input', (e) => runFastSearch(e.target.value));
searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) openDropdown(); });

searchOverlay.addEventListener('click', () => {
  closeDropdown();
  closeAiPanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDropdown(); closeAiPanel(); }
});

// ===== AI ASSISTANT =====
function openAiPanel(prefillQuery) {
  closeDropdown();
  searchAiPanel.classList.add('open');
  searchOverlay.classList.add('open');
  searchAiToggle.classList.add('active');
  if (prefillQuery) {
    searchAiInput.value = prefillQuery;
    sendAiQuery(prefillQuery);
  }
  searchAiInput.focus();
}

function closeAiPanel() {
  searchAiPanel.classList.remove('open');
  searchOverlay.classList.remove('open');
  searchAiToggle.classList.remove('active');
}

searchAiToggle.addEventListener('click', () => {
  if (searchAiPanel.classList.contains('open')) {
    closeAiPanel();
  } else {
    openAiPanel(searchInput.value.trim() || lastSearchQuery);
  }
});
searchAiClose.addEventListener('click', closeAiPanel);

function appendAiMessage(role, text) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  searchAiMessages.appendChild(div);
  searchAiMessages.scrollTop = searchAiMessages.scrollHeight;
  return div;
}

function appendAiResults(results, query) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg assistant';
  const list = document.createElement('div');
  list.className = 'ai-msg-results';
  results.slice(0, 5).forEach((r, i) => {
    const meta = TYPE_META[r.type] || { icon: 'fa-circle', label: r.type };
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `<div class="search-result-icon">${resultIconHtml(r)}</div>
      <div class="search-result-text">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        ${r.snippet ? `<div class="search-result-snippet">${escapeHtml(r.snippet)}</div>` : ''}
      </div>
      <div class="search-result-type">${meta.label}</div>`;
    item.addEventListener('click', () => {
      trackClick(query, { type: r.type, id: r.id }, i, true);
      closeAiPanel();
      window.location.hash = '';
      window.location.href = r.url || '#';
    });
    list.appendChild(item);
  });
  wrap.appendChild(list);
  searchAiMessages.appendChild(wrap);
  searchAiMessages.scrollTop = searchAiMessages.scrollHeight;
}

async function sendAiQuery(query) {
  if (!query || !query.trim()) return;
  appendAiMessage('user', query);
  aiConversation.push({ role: 'user', content: query });

  const spinner = document.createElement('div');
  spinner.className = 'ai-spinner';
  spinner.innerHTML = '<i class="fas fa-circle-notch"></i> Trợ lý AI đang suy nghĩ...';
  searchAiMessages.appendChild(spinner);
  searchAiMessages.scrollTop = searchAiMessages.scrollHeight;

  const start = performance.now();
  try {
    const data = await api('/api/search/ai-assistant', {
      method: 'POST',
      body: JSON.stringify({ query, session_id: aiSessionId, conversation_history: aiConversation }),
    });
    spinner.remove();

    if (data.needs_clarification) {
      appendAiMessage('assistant', data.clarification_question || 'Bạn có thể nói rõ hơn không?');
      aiConversation.push({ role: 'assistant', content: data.clarification_question || '' });
      return;
    }

    if (data.explanation) {
      appendAiMessage('assistant', data.explanation);
      aiConversation.push({ role: 'assistant', content: data.explanation });
    }
    if (data.results && data.results.length) {
      appendAiResults(data.results, data.intent?.search_query || query);
    } else {
      appendAiMessage('assistant', 'Không tìm thấy tài liệu phù hợp, bạn thử mô tả khác xem nhé.');
    }
    if (data.follow_up_question) {
      appendAiMessage('hint', data.follow_up_question);
    }
    const ms = Math.round(performance.now() - start);
    console.log(`🤖 AI search assistant responded in ${ms}ms`);
  } catch (e) {
    spinner.remove();
    appendAiMessage('assistant', 'Xin lỗi, trợ lý AI tạm thời không phản hồi được. Vui lòng thử lại sau.');
  }
}

searchAiForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchAiInput.value.trim();
  if (!query) return;
  searchAiInput.value = '';
  sendAiQuery(query);
});

// ===== CONTINUOUS LEARNING TRACKING =====
function trackClick(query, result, position, usedAi) {
  api('/api/search/track', {
    method: 'POST',
    body: JSON.stringify({
      session_id: aiSessionId,
      query,
      result_id: result.id,
      result_type: result.type,
      result_position: position,
      used_ai_assistant: usedAi,
    }),
  }).catch(() => {});
}

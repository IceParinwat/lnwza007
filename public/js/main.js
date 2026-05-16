// LIFF Init + Tab Manager + Flex Message sender

let LIFF_ID = '';
let lineProfile = null;
let chatInitialized = false;
let chatBusy = false;
let liffLoginInProgress = false;
let selectedAttachment = null;

function setEnterGameButtonState(isLoggedIn) {
  const btn = document.getElementById('enter-game-btn');
  if (!btn) return;
  btn.classList.remove('is-logged-in', 'is-logged-out');
  btn.classList.add(isLoggedIn ? 'is-logged-in' : 'is-logged-out');
}

async function refreshEnterGameButtonState() {
  const btn = document.getElementById('enter-game-btn');
  if (!btn) return;
  setEnterGameButtonState(false);
  try {
    if (!LIFF_ID) {
      const cfg = await fetch('/api/config').then(r => r.json());
      LIFF_ID = cfg.liffId || '';
    }
    if (!LIFF_ID || !window.liff) return;
    await liff.init({ liffId: LIFF_ID });
    setEnterGameButtonState(!!liff.isLoggedIn());
  } catch (e) {
    console.warn('refreshEnterGameButtonState failed:', e?.message || e);
    setEnterGameButtonState(false);
  }
}

function parseLiffStateTargetPath() {
  const params = new URLSearchParams(window.location.search || '');
  const raw = params.get('liff.state');
  if (!raw) return '';
  let decoded = String(raw);
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      break;
    }
  }

  if (/^https?:\/\//i.test(decoded)) {
    try {
      const u = new URL(decoded);
      if (u.origin !== window.location.origin) return '';
      decoded = `${u.pathname}${u.search || ''}${u.hash || ''}`;
    } catch (_) {
      return '';
    }
  }

  if (!decoded.startsWith('/')) {
    decoded = `/${decoded.replace(/^\.?\//, '')}`;
  }
  if (decoded.startsWith('//')) return '';
  if (decoded === '/' || decoded === '/chat') return '';
  return decoded;
}

async function resumePathFromLiffStateIfNeeded() {
  const isChatOnlyPage = !!document.body.classList.contains('chat-page');
  if (!isChatOnlyPage) return false;
  const targetPath = parseLiffStateTargetPath();
  if (!targetPath) return false;

  const currentPathWithQuery = window.location.pathname + (window.location.search || '');
  if (targetPath === currentPathWithQuery || targetPath === window.location.pathname) return false;

  try {
    if (!LIFF_ID) {
      const cfg = await fetch('/api/config').then(r => r.json());
      LIFF_ID = cfg.liffId || '';
    }
    if (LIFF_ID) {
      // Keep LIFF redirect params untouched until init is resolved.
      await liff.init({ liffId: LIFF_ID });
    }
  } catch (e) {
    console.warn('LIFF init before liff.state resume failed:', e?.message || e);
  }

  window.location.replace(targetPath);
  return true;
}

async function pingParinwatRoute() {
  try {
    await fetch('/parinwat', { method: 'GET', cache: 'no-store' });
  } catch (_) {}
}

async function ensureLineProfile(interactive = false) {
  if (lineProfile?.userId) return true;
  if (liffLoginInProgress) return false;

  try {
    if (!LIFF_ID) {
      const cfg = await fetch('/api/config').then(r => r.json());
      LIFF_ID = cfg.liffId || '';
    }
    if (!LIFF_ID) throw new Error('LIFF_ID is missing');

    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      if (!interactive) return false;
      liffLoginInProgress = true;
      const redirect = new URL(window.location.href);
      redirect.search = '';
      redirect.hash = '';
      liff.login({ redirectUri: redirect.toString() });
      return false;
    }

    lineProfile = await liff.getProfile();
    await saveProfile(lineProfile);
    renderProfile(lineProfile);
    setEnterGameButtonState(true);
    return true;
  } catch (e) {
    console.error('LIFF init/login failed:', e?.message || e);
    setEnterGameButtonState(false);
    if (interactive) {
      alert('กรุณา Login LINE ก่อนเข้าเกม');
    }
    return false;
  } finally {
    liffLoginInProgress = false;
  }
}

async function goToGameWithLogin(ev) {
  if (ev) ev.preventDefault();
  const gamePath = '/game';
  try {
    if (!LIFF_ID) {
      const cfg = await fetch('/api/config').then(r => r.json());
      LIFF_ID = cfg.liffId || '';
    }
    if (!LIFF_ID || !window.liff) {
      window.location.href = gamePath;
      return;
    }

    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      const redirect = new URL(window.location.origin);
      redirect.searchParams.set('liff.state', gamePath);
      liff.login({ redirectUri: redirect.toString() });
      return;
    }

    window.location.href = gamePath;
  } catch (e) {
    console.warn('goToGameWithLogin failed:', e?.message || e);
    window.location.href = gamePath;
  }
}

async function saveProfile(profile) {
  if (!profile?.userId || !profile?.displayName) return;
  await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || '',
      statusMessage: profile.statusMessage || '',
    }),
  }).catch(() => {});
}

function renderProfile(profile) {
  document.getElementById('profile-name').textContent = profile.displayName;
  if (profile.pictureUrl) {
    document.getElementById('profile-img').src = profile.pictureUrl;
  }
  document.getElementById('profile-json').textContent = profile.displayName;
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.placeholder = `${profile.displayName} ถามอะไร Gemini ได้เลย...`;
  }
  fetchHistory(profile.userId);
}

async function fetchHistory(userId) {
  const el = document.getElementById('history-list');
  if (!el) return;
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mine = await res.json();
    if (!mine.length) { el.innerHTML = '<div class="loading">NO HISTORY</div>'; return; }
    el.innerHTML = mine.slice(0, 10).map(r => `
      <div class="history-row">
        <span>${escHtml(r.display_name)}</span>
        <span class="h-score">SCORE: ${r.score}</span>
        <span class="h-date">${new Date(r.created_at).toLocaleString('th-TH')}</span>
      </div>`).join('');
  } catch (e) {
    el.innerHTML = '<div class="loading">LOAD HISTORY FAILED</div>';
  }
}

// Tab switching
async function setActiveTab(tab) {
  if ((tab === 'game' || tab === 'profile')) {
    const ok = await ensureLineProfile(true);
    if (!ok) return;
  }

  const currentTab = document.querySelector('.nav-btn.active')?.dataset?.tab || 'game';
  if (currentTab === 'game' && tab !== 'game' && typeof window.onGameTabHidden === 'function') {
    window.onGameTabHidden();
  }
  const targetTab = document.getElementById('tab-' + tab);
  if (!targetTab) return;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  targetTab.classList.remove('hidden');
  if (tab === 'leaderboard') fetchLeaderboard();
  if (tab === 'profile' && lineProfile?.userId) fetchHistory(lineProfile.userId);
  if (tab === 'chat') {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) setTimeout(() => chatInput.focus(), 50);
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
});

window.openGameHistoryTab = () => setActiveTab('profile');

function appendChatMessage(role, text) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  const row = document.createElement('div');
  row.className = `chat-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatFormBusy(isBusy) {
  chatBusy = isBusy;
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const attach = document.getElementById('chat-attach');
  if (input) input.disabled = isBusy;
  if (send) send.disabled = isBusy;
  if (attach) attach.disabled = isBusy;
}

function renderAttachmentInfo() {
  const info = document.getElementById('chat-attachment-info');
  if (!info) return;
  if (!selectedAttachment) {
    info.textContent = '';
    info.classList.add('hidden');
    return;
  }
  info.textContent = `แนบไฟล์: ${selectedAttachment.name} (${Math.ceil(selectedAttachment.size / 1024)} KB)`;
  info.classList.remove('hidden');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function askGeminiFromWebChat(userText, attachment = null) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: lineProfile?.userId || 'web-user',
      message: userText,
      attachment,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data.reply || 'ขออภัยครับ ยังไม่สามารถตอบได้ในตอนนี้';
}

async function onChatSubmit(ev) {
  ev.preventDefault();
  if (chatBusy) return;
  const input = document.getElementById('chat-input');
  const fileInput = document.getElementById('chat-file');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text && !selectedAttachment) return;

  input.value = '';
  const userPreviewText = text || (selectedAttachment ? `[แนบไฟล์] ${selectedAttachment.name}` : '');
  appendChatMessage('user', userPreviewText);
  setChatFormBusy(true);

  try {
    let attachmentPayload = null;
    if (selectedAttachment) {
      const dataUrl = await readFileAsDataUrl(selectedAttachment);
      const base64 = String(dataUrl).split(',')[1] || '';
      attachmentPayload = {
        name: selectedAttachment.name,
        mimeType: selectedAttachment.type || 'application/octet-stream',
        data: base64
      };
    }
    const reply = await askGeminiFromWebChat(text, attachmentPayload);
    appendChatMessage('bot', reply);
    selectedAttachment = null;
    if (fileInput) fileInput.value = '';
    renderAttachmentInfo();
  } catch (error) {
    appendChatMessage('bot', 'ระบบตอบช้าหรือมีปัญหาชั่วคราว ลองส่งอีกครั้งนะครับ');
    console.error('Web chat failed:', error?.message || error);
  } finally {
    setChatFormBusy(false);
    input.focus();
  }
}

function initChatTab() {
  if (chatInitialized) return;
  const chatForm = document.getElementById('chat-form');
  const attachBtn = document.getElementById('chat-attach');
  const fileInput = document.getElementById('chat-file');
  if (!chatForm) return;
  chatForm.addEventListener('submit', onChatSubmit);
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const maxBytes = 5 * 1024 * 1024;
      if (file.size > maxBytes) {
        alert('ไฟล์ใหญ่เกิน 5MB กรุณาเลือกไฟล์ที่เล็กลง');
        fileInput.value = '';
        selectedAttachment = null;
        renderAttachmentInfo();
        return;
      }
      selectedAttachment = file;
      renderAttachmentInfo();
    });
  }
  renderAttachmentInfo();
  appendChatMessage('bot', 'สวัสดีครับ พิมพ์ถามได้เลย');
  chatInitialized = true;
}

// Game over callback — send Flex Message + save score
async function handleGameOver(score, level, bugsDefeated, playedSeconds = 0) {
  let linePushSent = false;

  // Save to DB
  if (lineProfile) {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: lineProfile.userId,
        displayName: lineProfile.displayName,
        pictureUrl: lineProfile.pictureUrl || '',
        score, level, bugsDefeated, playedSeconds,
      }),
    }).catch(() => null);
    if (res) {
      const result = await res.json().catch(() => ({}));
      linePushSent = !!result.lineMessageSent;
      if (result && result.lineMessageSent === false) {
        console.warn('LINE push not sent:', result.lineError || 'unknown reason');
      }
    }
  }

  // Fallback: send via LIFF only when backend Messaging API push failed.
  if (!linePushSent && liff.isInClient && liff.isInClient()) {
    try {
      await liff.sendMessages([buildFlexMessage(score, level, bugsDefeated, playedSeconds)]);
    } catch (e) {
      console.warn('sendMessages failed:', e.message);
    }
  }
}

function buildFlexMessage(score, level, bugs, playedSeconds = 0) {
  const liffUrl = `https://liff.line.me/${LIFF_ID}`;
  const mins = Math.floor((playedSeconds || 0) / 60);
  const secs = (playedSeconds || 0) % 60;
  const playedText = `${mins}:${String(secs).padStart(2, '0')}`;
  return {
    type: 'flex',
    altText: `💀 SYSTEM CRASH — Score: ${score}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1a0000',
        contents: [{
          type: 'text', text: '🔴  CRITICAL ERROR',
          color: '#ff2222', size: 'sm', weight: 'bold',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        backgroundColor: '#0a0f0a',
        contents: [
          codeLine('process', 'memory_manager.exe'),
          codeLine('status', 'terminated'),
          codeLine('reason', 'ghost_collision'),
          codeLine('played_time', playedText),
          codeLine('score', String(score)),
          codeLine('level', String(level)),
          codeLine('bugs_defeated', String(bugs)),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'secondary',
          action: { type: 'uri', label: '↩  REBOOT SYSTEM', uri: liffUrl },
          color: '#001a00',
        }],
      },
      styles: { footer: { separator: true, separatorColor: '#003300' } },
    },
  };
}

function codeLine(key, val) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: key + ':', color: '#008f11', size: 'xs', flex: 2 },
      { type: 'text', text: val, color: '#00ff41',  size: 'xs', flex: 3 },
    ],
  };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  resumePathFromLiffStateIfNeeded().then((redirected) => {
    if (redirected) return;

    const enterGameBtn = document.getElementById('enter-game-btn');
    if (enterGameBtn) {
      enterGameBtn.addEventListener('click', goToGameWithLogin);
      refreshEnterGameButtonState();
    }

    pingParinwatRoute();
    initChatTab();
    if (typeof initLeaderboard === 'function') initLeaderboard();

    const isChatOnlyPage = !!document.body.classList.contains('chat-page');
    setActiveTab(isChatOnlyPage ? 'chat' : 'game');

    // Wire game-over callback (game page)
    window.onGameOver = handleGameOver;
  });
});

// LIFF Init + Tab Manager + Flex Message sender

let LIFF_ID = '';
let lineProfile = null;

async function pingParinwatRoute() {
  try {
    await fetch('/parinwat', { method: 'GET', cache: 'no-store' });
  } catch (_) {}
}

async function initLiff() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    LIFF_ID = cfg.liffId || '';
    if (!LIFF_ID) throw new Error('LIFF_ID is missing');
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      const redirect = new URL(window.location.href);
      redirect.search = '';
      redirect.hash = '';
      liff.login({ redirectUri: redirect.toString() });
      return;
    }
    lineProfile = await liff.getProfile();
    await saveProfile(lineProfile);
    renderProfile(lineProfile);
  } catch (e) {
    console.warn('LIFF init failed (dev mode):', e.message);
    lineProfile = { userId: 'dev_user', displayName: 'Dev Mode', pictureUrl: '' };
    await saveProfile(lineProfile);
    renderProfile(lineProfile);
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
function setActiveTab(tab) {
  const currentTab = document.querySelector('.nav-btn.active')?.dataset?.tab || 'game';
  if (currentTab === 'game' && tab !== 'game' && typeof window.onGameTabHidden === 'function') {
    window.onGameTabHidden();
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'leaderboard') fetchLeaderboard();
  if (tab === 'profile' && lineProfile?.userId) fetchHistory(lineProfile.userId);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
});

window.openGameHistoryTab = () => setActiveTab('profile');

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
  pingParinwatRoute();
  initLiff();
  initLeaderboard();
  // Wire game-over callback
  onGameOver = handleGameOver;
});

// Leaderboard — Matrix rain + polling

function initMatrixRain() {
  const canvas = document.getElementById('matrix-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = 80;
  const cols = Math.floor(canvas.width / 14);
  const drops = Array.from({ length: cols }, () => Math.random() * -20);

  function rain() {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff41';
    ctx.font = '13px monospace';
    drops.forEach((y, i) => {
      const char = String.fromCharCode(0x30A0 + Math.random() * 96);
      ctx.fillText(char, i * 14, y * 14);
      drops[i] = (y > canvas.height / 14 && Math.random() > 0.975) ? 0 : y + 0.5;
    });
  }
  setInterval(rain, 50);
}

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    renderLeaderboard(data);
  } catch (e) {
    document.getElementById('leaderboard-list').innerHTML =
      '<div class="loading">CONNECTION_REFUSED</div>';
  }
}

function renderLeaderboard(rows) {
  const el = document.getElementById('leaderboard-list');
  if (!rows.length) {
    el.innerHTML = '<div class="loading">NO RECORDS FOUND</div>';
    return;
  }
  el.innerHTML = rows.map((r, i) => {
    const rankClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const rankLabel = ['①','②','③'][i] || `#${i+1}`;
    const avatar = r.picture_url
      ? `<img class="lb-avatar" src="${r.picture_url}" onerror="this.style.display='none'">`
      : '<div class="lb-avatar" style="background:#0a2a0a;display:flex;align-items:center;justify-content:center;font-size:14px">☰</div>';
    return `<div class="lb-row">
      <span class="lb-rank ${rankClass}">${rankLabel}</span>
      ${avatar}
      <span class="lb-name">${escHtml(r.display_name)}</span>
      <span class="lb-score">${r.score}</span>
      <span class="lb-level">Lv${r.level}</span>
    </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function initLeaderboard() {
  initMatrixRain();
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 10000);
}

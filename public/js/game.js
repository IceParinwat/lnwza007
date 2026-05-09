const GRID = 28;
const GAME_W = 800;
const GAME_H = 625;

const LEVEL = [
  '#####################',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o###.###.#.###.###o#',
  '#...................#',
  '#.###.#.#####.#.###.#',
  '#.....#...#...#.....#',
  '#####.###...###.#####',
  '    #.#.......#.#    ',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o..#...........#..o#',
  '###.#.#.#####.#.#.###',
  '#.....#...#...#.....#',
  '#.###.###.#.###.###.#',
  '#...#.....P.....#...#',
  '#.###.#.#####.#.###.#',
  '#.........#.........#',
  '#####################',
];

const ROWS = LEVEL.length;
const COLS = LEVEL[0].length;
const BOARD_W = COLS * GRID;
const BOARD_H = ROWS * GRID;
const BOARD_X = Math.floor((GAME_W - BOARD_W) / 2);
const BOARD_Y = 20;
const TUNNEL_ROW = 8;

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
const OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };

let pendingDir = null;
let phaserGame = null;
let onGameOver = null;
let gameState = 'idle'; // idle | running | ended
let gameStartedAtMs = 0;

let sceneRef;
let mapGrid = [];
let player;
let ghosts = [];
let pellets = new Map();
let wallsGraphics;
let livesNodes = [];

(function initJoystick() {
  const base = document.getElementById('joystick-base');
  const thumb = document.getElementById('joystick-thumb');
  if (!base || !thumb) return;

  const DEAD = 12;
  let mcx = 0;
  let mcy = 0;
  let dragging = false;

  function setFromDelta(dx, dy) {
    if (Math.abs(dx) < DEAD && Math.abs(dy) < DEAD) {
      pendingDir = null;
      return;
    }
    pendingDir = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
  }

  function applyMove(cx, cy, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = base.offsetWidth / 2 - 8;
    const clamp = Math.min(dist, radius);
    const ang = Math.atan2(dy, dx);
    thumb.classList.remove('snapping');
    thumb.style.transform = `translate(calc(-50% + ${Math.cos(ang) * clamp}px), calc(-50% + ${Math.sin(ang) * clamp}px))`;
    setFromDelta(dx, dy);
  }

  function resetThumb() {
    thumb.classList.add('snapping');
    thumb.style.transform = 'translate(-50%, -50%)';
  }

  base.addEventListener('touchstart', e => {
    e.preventDefault();
    const r = base.getBoundingClientRect();
    applyMove(r.left + r.width / 2, r.top + r.height / 2, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  base.addEventListener('touchmove', e => {
    e.preventDefault();
    const r = base.getBoundingClientRect();
    applyMove(r.left + r.width / 2, r.top + r.height / 2, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  base.addEventListener('touchend', e => {
    e.preventDefault();
    pendingDir = null;
    resetThumb();
  }, { passive: false });

  base.addEventListener('mousedown', e => {
    dragging = true;
    const r = base.getBoundingClientRect();
    mcx = r.left + r.width / 2;
    mcy = r.top + r.height / 2;
    applyMove(mcx, mcy, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => {
    if (dragging) applyMove(mcx, mcy, e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    pendingDir = null;
    resetThumb();
  });
})();

function preload() {}

function create() {
  sceneRef = this;
  this.cameras.main.setBackgroundColor('#000000');

  initWorld(this);
  initPlayer(this);
  initGhosts(this);
  drawHUDLives(this);
  updateHUD();
  gameState = 'running';
}

function update(_, delta = 16.6667) {
  if (!player || !player.alive) return;

  if (pendingDir) {
    player.nextDir = pendingDir;
  }

  movePlayer(delta);
  eatPellet();

  for (const g of ghosts) {
    updateGhost(g, delta);
    const d = Phaser.Math.Distance.Between(player.x, player.y, g.x, g.y);
    if (d < GRID * 0.55) {
      onPlayerHit();
      break;
    }
  }

  if (pellets.size === 0) {
    endGame('YOU WIN');
  }

  syncSprites();
  updateHUD();
}

function initWorld(scene) {
  mapGrid = LEVEL.map(row => row.split(''));
  pellets.clear();

  wallsGraphics = scene.add.graphics();
  wallsGraphics.fillStyle(0x081f70, 1);
  wallsGraphics.lineStyle(2, 0x38c5ff, 1);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = mapGrid[y][x];
      const wx = BOARD_X + x * GRID;
      const wy = BOARD_Y + y * GRID;

      if (ch === '#') {
        wallsGraphics.fillRect(wx, wy, GRID, GRID);
        wallsGraphics.strokeRect(wx + 1, wy + 1, GRID - 2, GRID - 2);
      } else if (ch === '.' || ch === 'o') {
        const r = ch === 'o' ? 5 : 3;
        const color = ch === 'o' ? 0xffe08f : 0xffd8a1;
        const pellet = scene.add.circle(wx + GRID / 2, wy + GRID / 2, r, color);
        pellets.set(`${x},${y}`, { sprite: pellet, value: ch === 'o' ? 50 : 10 });
      }
    }
  }
}

function initPlayer(scene) {
  let spawn = { x: 10, y: 15 };
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (mapGrid[y][x] === 'P') {
        spawn = { x, y };
        mapGrid[y][x] = ' ';
      }
    }
  }

  const world = tileCenter(spawn.x, spawn.y);
  const body = scene.add.circle(world.x, world.y, GRID * 0.38, 0xffe45c);

  player = {
    sprite: body,
    x: world.x,
    y: world.y,
    dir: null,
    nextDir: null,
    speed: 120,
    radius: GRID * 0.34,
    score: 0,
    lives: 1,
    alive: true,
  };
}

function initGhosts(scene) {
  ghosts = [];
  const colors = [0xff5757, 0x5bc0ff, 0xffad60, 0xff7bd2];
  const spawns = [
    { x: 10, y: 8 },
    { x: 9, y: 8 },
    { x: 11, y: 8 },
    { x: 10, y: 7 },
  ];

  for (let i = 0; i < 4; i++) {
    const p = tileCenter(spawns[i].x, spawns[i].y);
    const sprite = scene.add.rectangle(p.x, p.y, GRID * 0.72, GRID * 0.72, colors[i]);
    ghosts.push({
      sprite,
      x: p.x,
      y: p.y,
      dir: 'up',
      speed: 90 + i * 6,
      radius: GRID * 0.34,
      releaseAt: scene.time.now + i * 500,
      state: 'house',
      jitter: i,
    });
  }
}

function drawHUDLives(scene) {
  for (const n of livesNodes) n.destroy();
  livesNodes = [];
  for (let i = 0; i < player.lives; i++) {
    livesNodes.push(scene.add.circle(700 + i * 22, 610, 8, 0xffe45c));
  }
}

function onPlayerHit() {
  if (!player.alive) return;
  player.alive = false;
  player.lives -= 1;
  drawHUDLives(sceneRef);
  updateHUD();
  endGame('GAME OVER');
}

function endGame(title, { saveScore = true, showResultOverlay = true } = {}) {
  if (gameState === 'ended') return;
  gameState = 'ended';
  if (player) player.alive = false;
  sceneRef?.scene?.pause();
  document.getElementById('joystick-wrap').style.display = 'none';
  if (showResultOverlay) {
    showOverlay({
      html: `${title}<br>SCORE: ${player.score}`,
      primaryLabel: 'START NEW GAME',
      showHistory: true,
    });
  }
  const playedSeconds = gameStartedAtMs
    ? Math.max(0, Math.floor((Date.now() - gameStartedAtMs) / 1000))
    : 0;
  if (saveScore && onGameOver) onGameOver(player.score, 1, 0, playedSeconds);
}

function movePlayer(deltaMs) {
  if (player.nextDir) tryTurn(player, player.nextDir);
  const moved = moveEntity(player, deltaMs);
  if (!moved) {
    snapToTile(player);
    if (player.nextDir && tryTurn(player, player.nextDir)) moveEntity(player, deltaMs);
  }
}

function updateGhost(g, deltaMs) {
  if (sceneRef.time.now < g.releaseAt) return;

  if (g.state === 'house') g.state = 'exit';

  if (g.state === 'exit') {
    g.dir = 'up';
    moveEntity(g, deltaMs);
    const tile = worldToTile(g.x, g.y);
    if (tile.y <= 7) g.state = 'chase';
    return;
  }

  if (nearTileCenter(g.x, g.y)) {
    const choices = validDirs(g);
    if (choices.length) {
      const target = worldToTile(player.x, player.y);
      let best = choices[0];
      let bestScore = Infinity;
      for (const d of choices) {
        const v = DIRS[d];
        const t = worldToTile(g.x + v.x * GRID, g.y + v.y * GRID);
        const score = Math.abs(t.x - target.x) + Math.abs(t.y - target.y);
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      g.dir = best;
    }
  }

  moveEntity(g, deltaMs);
}

function validDirs(entity) {
  const out = [];
  for (const dir of Object.keys(DIRS)) {
    if (OPP[dir] === entity.dir) continue;
    if (canMoveDir(entity, dir)) out.push(dir);
  }
  if (out.length === 0) {
    for (const dir of Object.keys(DIRS)) {
      if (canMoveDir(entity, dir)) out.push(dir);
    }
  }
  return out;
}

function tryTurn(entity, dir) {
  if (!DIRS[dir]) return false;
  const oldX = entity.x;
  const oldY = entity.y;
  const tile = worldToTile(entity.x, entity.y);
  const center = tileCenter(tile.x, tile.y);
  const wantVertical = DIRS[dir].y !== 0;
  const lateralDelta = wantVertical ? Math.abs(entity.x - center.x) : Math.abs(entity.y - center.y);
  if (lateralDelta > 12) return false;
  if (wantVertical) entity.x = center.x;
  else entity.y = center.y;
  if (!canMoveDir(entity, dir)) {
    entity.x = oldX;
    entity.y = oldY;
    return false;
  }
  entity.dir = dir;
  return true;
}

function moveEntity(entity, deltaMs) {
  if (!entity.dir || !DIRS[entity.dir]) return false;
  const step = entity.speed * (deltaMs / 1000);
  const v = DIRS[entity.dir];
  let nx = entity.x + v.x * step;
  let ny = entity.y + v.y * step;

  const tunnelY = BOARD_Y + TUNNEL_ROW * GRID + GRID / 2;
  if (Math.abs(entity.y - tunnelY) < GRID * 0.45) {
    if (nx < BOARD_X - GRID / 2) nx = BOARD_X + BOARD_W - GRID / 2;
    if (nx > BOARD_X + BOARD_W + GRID / 2) nx = BOARD_X + GRID / 2;
  }

  if (canOccupy(nx, ny, entity.radius)) {
    entity.x = nx;
    entity.y = ny;
    return true;
  }
  return false;
}

function canMoveDir(entity, dir) {
  const v = DIRS[dir];
  if (!v) return false;
  const probe = Math.max(6, Math.min(12, entity.speed * 0.08));
  const nx = entity.x + v.x * probe;
  const ny = entity.y + v.y * probe;
  return canOccupy(nx, ny, entity.radius);
}

function snapToTile(entity) {
  const tile = worldToTile(entity.x, entity.y);
  const center = tileCenter(tile.x, tile.y);
  if (Math.abs(entity.x - center.x) <= 8) entity.x = center.x;
  if (Math.abs(entity.y - center.y) <= 8) entity.y = center.y;
}

function canOccupy(x, y, r) {
  return walkableAtWorld(x - r, y - r) &&
         walkableAtWorld(x + r, y - r) &&
         walkableAtWorld(x - r, y + r) &&
         walkableAtWorld(x + r, y + r);
}

function walkableAtWorld(wx, wy) {
  const t = worldToTile(wx, wy);

  if (t.y === TUNNEL_ROW && (t.x < 0 || t.x >= COLS)) return true;
  if (t.y < 0 || t.y >= ROWS || t.x < 0 || t.x >= COLS) return false;

  return mapGrid[t.y][t.x] !== '#';
}

function nearTileCenter(x, y) {
  const tx = Math.round((x - BOARD_X - GRID / 2) / GRID);
  const ty = Math.round((y - BOARD_Y - GRID / 2) / GRID);
  const c = tileCenter(tx, ty);
  return Math.abs(x - c.x) < 2.5 && Math.abs(y - c.y) < 2.5;
}

function worldToTile(x, y) {
  return {
    x: Math.floor((x - BOARD_X) / GRID),
    y: Math.floor((y - BOARD_Y) / GRID),
  };
}

function tileCenter(tx, ty) {
  return {
    x: BOARD_X + tx * GRID + GRID / 2,
    y: BOARD_Y + ty * GRID + GRID / 2,
  };
}

function eatPellet() {
  const tile = worldToTile(player.x, player.y);
  const key = `${tile.x},${tile.y}`;
  const pellet = pellets.get(key);
  if (!pellet) return;
  pellet.sprite.destroy();
  pellets.delete(key);
  player.score += pellet.value;
}

function syncSprites() {
  player.sprite.setPosition(player.x, player.y);
  for (const g of ghosts) g.sprite.setPosition(g.x, g.y);
}

function updateHUD() {
  const s = document.getElementById('hud-score');
  if (s) s.textContent = String(player?.score ?? 0);
  const l = document.getElementById('hud-lives');
  if (l) l.textContent = String(player?.lives ?? 0);
  const lv = document.getElementById('hud-level');
  if (lv) lv.textContent = '1';
}

function showOverlay({ html, primaryLabel = 'START GAME', showHistory = false }) {
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-text').innerHTML = html;
  document.getElementById('btn-start').textContent = primaryLabel;
  const historyBtn = document.getElementById('btn-history');
  if (showHistory) historyBtn.classList.remove('hidden-action');
  else historyBtn.classList.add('hidden-action');
  ov.classList.remove('hidden');
}

const phaserConfig = {
  type: Phaser.AUTO,
  width: GAME_W,
  height: GAME_H,
  parent: 'phaser-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  scene: { preload, create, update },
};

function computeContainerSize() {
  const navH = 60;
  const hudH = document.getElementById('hud')?.offsetHeight || 34;
  const joyBase = Math.min(130, Math.floor(window.innerWidth * 0.32));
  const joyH = joyBase + 24;
  const availH = window.innerHeight - navH - hudH - joyH - 8;
  const availW = window.innerWidth;
  const scale = Math.min(availW / GAME_W, availH / GAME_H, 1);
  return { w: Math.floor(GAME_W * scale), h: Math.floor(GAME_H * scale) };
}

function startGame() {
  document.getElementById('overlay').classList.add('hidden');
  gameStartedAtMs = Date.now();

  const joyWrap = document.getElementById('joystick-wrap');
  joyWrap.style.display = 'flex';

  const { w, h } = computeContainerSize();
  const container = document.getElementById('phaser-container');
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;

  // Always recreate a fresh Phaser instance to avoid stale scene/preload logic
  // from previously loaded scripts.
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  container.innerHTML = '';
  pendingDir = null;
  gameState = 'idle';
  phaserGame = new Phaser.Game(phaserConfig);
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-history').addEventListener('click', () => {
  if (typeof window.openGameHistoryTab === 'function') {
    window.openGameHistoryTab();
    return;
  }
  document.querySelector('.nav-btn[data-tab="profile"]')?.click();
});

window.onGameTabHidden = () => {
  if (gameState !== 'running') return;
  endGame('GAME ABORTED', { saveScore: true, showResultOverlay: true });
};

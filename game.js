// ==================== 跳一跳 - Web Edition ====================

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// --- responsive ---
let SCALE = 1;
function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  SCALE = Math.min(window.innerWidth / 700, window.innerHeight / 600);
  if (SCALE < 0.3) SCALE = 0.3;
}
resize();
window.addEventListener('resize', resize);

const W = () => window.innerWidth;
const H = () => window.innerHeight;

// ==================== CONSTANTS ====================
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);
const MAX_CHARGE_MS = 1800;
const MAX_JUMP_DIST = 380;
const JUMP_DURATION = 360;
const JUMP_PEAK = 200;
const CAMERA_DURATION = 320;
const FALL_DURATION = 500;
const BONUS_DISPLAY_MS = 800;
const QUALITY_PERFECT = 2, QUALITY_GOOD = 1, QUALITY_EDGE = 0;

const PALETTE = [
  '#F5A9B8','#B8E8D0','#FFD4A8','#A8D8EA',
  '#D4A8E8','#FFE5A8','#A8E8D4','#E8D5B7'
];

const BASE_ANGLES = [
  0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3
];

// ==================== GAME STATE ====================
let screen = 'menu'; // 'menu' | 'game'
let state = 'IDLE';  // IDLE | CHARGING | JUMPING | GAME_OVER
let blocks = [];
let player = { worldX:0, worldY:0, worldZ:0, squash:0, standingOn:null };
let score = 0;
let power = 0;
let chargeStartTime = 0;
let cameraX = 0, cameraY = 0;
let jumpCount = 0;
let targetBlock = null;

// Landing mark
let landingMarkX, landingMarkY, landingMarkTime = 0, landingQuality;

// Landing bounce
let landBounceStart = 0, landBounceDur = 200;

// Bonus text
let bonusText = null, bonusStartTime = 0;

// Game-over report
let gameOverReported = false;

// Animation states
let jumpAnim = null, fallAnim = null, cameraAnim = null;

// ==================== SOUND (Web Audio API) ====================
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freqSweep, duration, type, vol) {
  try {
    const ac = getAudio();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freqSweep[0], t);
    if (freqSweep.length > 1) osc.frequency.linearRampToValueAtTime(freqSweep[1], t + duration / 1000);
    gain.gain.setValueAtTime(vol || 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration / 1000);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + duration / 1000);
  } catch(e) {}
}

function playCharge()  { playTone([400, 800], 150, 'sine', 0.12); }
function playJump()    { playTone([600, 200], 60, 'triangle', 0.18);
                          setTimeout(()=>playTone([300, 800], 60, 'triangle', 0.16), 55); }
function playLand()    { playTone([800, 600], 100, 'sine', 0.13); }
function playPerfect() { playTone([1200, 1000], 120, 'sine', 0.16);
                          setTimeout(()=>playTone([1600, 1300], 120, 'sine', 0.14), 100); }
function playGameOverSound() { playTone([500, 150], 300, 'sine', 0.14); }

// ==================== STATS ====================
function loadStats() {
  try { return JSON.parse(localStorage.getItem('jump_stats')||'{"high":0,"games":0}'); }
  catch(e) { return {high:0,games:0}; }
}
function saveStats(s) {
  try { localStorage.setItem('jump_stats', JSON.stringify(s)); } catch(e) {}
}

// ==================== ROUNDRECT POLYFILL ====================
if (!ctx.roundRect) {
  ctx.roundRect = function(x, y, w, h, r) {
    if (typeof r === 'number') r = [r, r, r, r];
    ctx.beginPath();
    ctx.moveTo(x + r[0], y);
    ctx.lineTo(x + w - r[1], y);
    ctx.arcTo(x + w, y, x + w, y + r[1], r[1]);
    ctx.lineTo(x + w, y + h - r[2]);
    ctx.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]);
    ctx.lineTo(x + r[3], y + h);
    ctx.arcTo(x, y + h, x, y + h - r[3], r[3]);
    ctx.lineTo(x, y + r[0]);
    ctx.arcTo(x, y, x + r[0], y, r[0]);
    ctx.closePath();
  };
}

// ==================== HELPERS ====================
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function shadeColor(hex, factor) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)})`;
}
function rand(min, max) { return min + Math.random()*(max-min); }
function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

// Isometric projection
function isoX(wx, wy) { return ((wx - wy) * COS30 - cameraX) * SCALE; }
function isoY(wx, wy, wz) { return ((wx + wy) * SIN30 - wz - cameraY) * SCALE; }

// ==================== GAME SETUP ====================
function setupGame() {
  blocks = [];
  score = 0;
  power = 0;
  bonusText = null;
  landingMarkTime = 0;
  gameOverReported = false;
  jumpCount = 0;
  cameraX = 0; cameraY = 0;

  const first = { worldX:0, worldY:0, width:120, depth:100, height:60, color:pick(PALETTE) };
  blocks.push(first);

  const dist = rand(150, 350);
  const wy = rand(-30, 30);
  const second = { worldX:dist, worldY:wy, width:rand(80,180), depth:rand(70,120), height:rand(50,80), color:pick(PALETTE) };
  blocks.push(second);

  player = { worldX:0, worldY:0, worldZ:0, squash:0, standingOn:first };

  targetBlock = second;
  updateCameraTarget();
  cameraX = camTargetX; cameraY = camTargetY;

  state = 'IDLE';
  jumpAnim = null; fallAnim = null; cameraAnim = null;
}

let camTargetX = 0, camTargetY = 0;
function updateCameraTarget() {
  if (player.standingOn) {
    const px = player.standingOn.worldX;
    const py = player.standingOn.worldY;
    camTargetX = (px - py) * COS30;
    camTargetY = (px + py) * SIN30 - (player.standingOn.height + 50);
  }
}

function resetGame() {
  jumpAnim = null; fallAnim = null; cameraAnim = null;
  setupGame();
}

// ==================== CHARGING ====================
function startCharging() {
  state = 'CHARGING';
  chargeStartTime = performance.now();
  power = 0;
  player.squash = 0;
  playCharge();
}

function updateCharging() {
  if (state !== 'CHARGING') return;
  const elapsed = performance.now() - chargeStartTime;
  power = Math.min(elapsed / MAX_CHARGE_MS, 1);
  player.squash = power;
}

// ==================== JUMP ====================
function startJump() {
  state = 'JUMPING';
  player.squash = 0;
  playJump();

  const jumpDist = power * MAX_JUMP_DIST;
  const dx = targetBlock.worldX - player.worldX;
  const dy = targetBlock.worldY - player.worldY;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  jumpAnim = {
    startTime: performance.now(),
    duration: JUMP_DURATION,
    startX: player.worldX, startY: player.worldY,
    endX: player.worldX + dirX * jumpDist,
    endY: player.worldY + dirY * jumpDist,
  };
  power = 0;
}

function updateJumpAnim(now) {
  if (!jumpAnim) return;
  const t = clamp((now - jumpAnim.startTime) / jumpAnim.duration, 0, 1);
  player.worldX = jumpAnim.startX + (jumpAnim.endX - jumpAnim.startX) * t;
  player.worldY = jumpAnim.startY + (jumpAnim.endY - jumpAnim.startY) * t;
  player.worldZ = JUMP_PEAK * 4 * t * (1 - t);
  if (t >= 1) {
    jumpAnim = null;
    onJumpComplete();
  }
}

function onJumpComplete() {
  player.worldZ = 0;

  if (targetBlock && contains(targetBlock, player.worldX)) {
    const dist = centerDist(targetBlock, player.worldX);
    if (dist < 0.15) {
      landingQuality = QUALITY_PERFECT;
      score += 2;
      showBonus('Perfect! +2');
      playPerfect();
    } else if (dist < 0.4) {
      landingQuality = QUALITY_GOOD;
      score += 1;
      playLand();
    } else {
      landingQuality = QUALITY_EDGE;
      score += 1;
      playLand();
    }

    landingMarkX = player.worldX;
    landingMarkY = player.worldY;
    landingMarkTime = performance.now();

    const hw = targetBlock.width / 2 - 8;
    player.worldX = clamp(player.worldX, targetBlock.worldX - hw, targetBlock.worldX + hw);
    player.standingOn = targetBlock;
    player.squash = 0;
    landBounceStart = performance.now();

    generateNextBlock();
    // Remove blocks far behind to avoid overlap (keep last 5)
    const curIdx = blocks.indexOf(player.standingOn);
    if (curIdx > 2) blocks.splice(0, curIdx - 2);
    animateCamera();
    state = 'IDLE';
  } else {
    state = 'GAME_OVER';
    playGameOverSound();
    if (!gameOverReported) {
      gameOverReported = true;
      const stats = loadStats();
      stats.games++;
      if (score > stats.high) stats.high = score;
      saveStats(stats);
    }
    startFall();
  }
}

function contains(block, x) {
  return x >= block.worldX - block.width/2 && x <= block.worldX + block.width/2;
}
function centerDist(block, x) {
  const hw = block.width/2;
  return hw <= 0 ? 1 : Math.min(Math.abs(x - block.worldX) / hw, 1);
}

function showBonus(text) {
  bonusText = text;
  bonusStartTime = performance.now();
}

// ==================== FALL ====================
function startFall() {
  fallAnim = {
    startTime: performance.now(),
    duration: FALL_DURATION,
    edgeX: player.worldX,
    edgeY: player.worldY,
  };
}

function updateFallAnim(now) {
  if (!fallAnim) return;
  const t = clamp((now - fallAnim.startTime) / fallAnim.duration, 0, 1);
  player.worldZ = -t * t * 400;
}

// ==================== BLOCK GENERATION ====================
function generateNextBlock() {
  const last = blocks[blocks.length - 1];
  const dirIdx = Math.floor(jumpCount / (2 + Math.floor(Math.random() * 2))) % BASE_ANGLES.length;
  const baseAngle = BASE_ANGLES[dirIdx];
  const angle = baseAngle + (Math.random() - 0.5) * 0.8;
  const dist = rand(130, 380);
  const next = {
    worldX: last.worldX + dist * Math.cos(angle),
    worldY: last.worldY + dist * Math.sin(angle),
    width: rand(70, 190),
    depth: rand(60, 120),
    height: rand(45, 80),
    color: pick(PALETTE)
  };
  blocks.push(next);
  targetBlock = next;
  jumpCount++;
}

// ==================== CAMERA ====================
function animateCamera() {
  updateCameraTarget();
  cameraAnim = {
    startTime: performance.now(),
    duration: CAMERA_DURATION,
    fromX: cameraX, fromY: cameraY,
  };
}

function updateCameraAnim(now) {
  if (!cameraAnim) return;
  const t = clamp((now - cameraAnim.startTime) / cameraAnim.duration, 0, 1);
  const ease = t * (2 - t); // ease out
  cameraX = cameraAnim.fromX + (camTargetX - cameraAnim.fromX) * ease;
  cameraY = cameraAnim.fromY + (camTargetY - cameraAnim.fromY) * ease;
  if (t >= 1) cameraAnim = null;
}

// ==================== MAIN LOOP ====================
let lastTime = 0;
function gameLoop(now) {
  if (!lastTime) lastTime = now;
  update(now);
  render(now);
  lastTime = now;
  requestAnimationFrame(gameLoop);
}

function update(now) {
  if (screen === 'game') {
    updateCharging();
    updateJumpAnim(now);
    updateFallAnim(now);
    updateCameraAnim(now);
  }
}

// ==================== RENDER ====================
function render(now) {
  const w = W(), h = H();
  ctx.clearRect(0, 0, w, h);

  if (screen === 'menu') {
    drawMenu(w, h);
  } else {
    drawGame(w, h, now);
  }
}

// --- Menu ---
function drawMenu(w, h) {
  // background
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2C3E50');
  grad.addColorStop(0.5, '#1A252F');
  grad.addColorStop(1, '#0D1B2A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // title
  ctx.fillStyle = '#FFF';
  ctx.font = `bold ${w*0.11}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText('跳一跳', w/2, h*0.16);
  ctx.shadowBlur = 0;

  // stats card
  const cx = w/2, cy = h*0.30;
  const cw = w*0.7, ch = h*0.28;
  const cr = 20;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.roundRect(cx - cw/2, cy, cw, ch, cr);
  ctx.fill();

  const stats = loadStats();

  // high score label
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${w*0.04}px sans-serif`;
  ctx.fillText('历史最高分', cx, cy + ch*0.25);

  // high score value
  ctx.fillStyle = '#FFD700';
  ctx.font = `bold ${w*0.09}px sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3;
  ctx.fillText(stats.high, cx, cy + ch*0.55);
  ctx.shadowBlur = 0;

  // divider
  const divY = cy + ch*0.65;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - cw/2 + 40, divY);
  ctx.lineTo(cx + cw/2 - 40, divY);
  ctx.stroke();

  // games played label
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${w*0.035}px sans-serif`;
  ctx.fillText('游玩次数', cx, cy + ch*0.78);

  // games played value
  ctx.fillStyle = '#FFD700';
  ctx.font = `bold ${w*0.06}px sans-serif`;
  ctx.fillText(stats.games + ' 局', cx, cy + ch*0.92);

  // start button
  const btnY = h*0.7;
  const btnR = Math.min(w, h) * 0.13;

  // glow
  const glow = ctx.createRadialGradient(cx, btnY, btnR*0.7, cx, btnY, btnR+15);
  glow.addColorStop(0, 'rgba(76,175,80,0.2)');
  glow.addColorStop(1, 'rgba(76,175,80,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, btnY, btnR+15, 0, Math.PI*2);
  ctx.fill();

  // circle
  ctx.fillStyle = '#4CAF50';
  ctx.shadowColor = 'rgba(76,175,80,0.4)';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(cx, btnY, btnR, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // play triangle
  ctx.fillStyle = '#FFF';
  const ts = btnR*0.55;
  ctx.beginPath();
  ctx.moveTo(cx - ts*0.7, btnY - ts);
  ctx.lineTo(cx + ts*1.1, btnY);
  ctx.lineTo(cx - ts*0.7, btnY + ts);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FFF';
  ctx.font = `bold ${w*0.055}px sans-serif`;
  ctx.fillText('开始游戏', cx, btnY + btnR + 55);
}

// --- Game ---
function drawGame(w, h, now) {
  // background
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#D0DCE8');
  grad.addColorStop(0.5, '#E8E0D8');
  grad.addColorStop(1, '#D8DCE4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);

  // shadows
  for (const b of blocks) drawBlockShadow(b);
  // blocks
  for (const b of blocks) drawBlock(b);
  // center hint
  if (targetBlock) drawCenterHint(targetBlock);
  // landing mark
  drawLandingMark(now);
  // player
  drawPlayer();

  ctx.restore();

  // HUD
  drawHUD(w, h, now);
  drawBonus(w, h, now);

  if (state === 'GAME_OVER') drawGameOver(w, h);
}

function drawBlockShadow(b) {
  const hw = b.width/2, hd = b.depth/2;
  const ox = 6, oy = 8;
  const sx = [
    isoX(b.worldX - hw + ox, b.worldY - hd + oy),
    isoX(b.worldX + hw + ox, b.worldY - hd + oy),
    isoX(b.worldX + hw + ox, b.worldY + hd + oy),
    isoX(b.worldX - hw + ox, b.worldY + hd + oy),
  ];
  const sy = [
    isoY(b.worldX - hw + ox, b.worldY - hd + oy, 0),
    isoY(b.worldX + hw + ox, b.worldY - hd + oy, 0),
    isoY(b.worldX + hw + ox, b.worldY + hd + oy, 0),
    isoY(b.worldX - hw + ox, b.worldY + hd + oy, 0),
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.beginPath();
  ctx.moveTo(sx[0], sy[0]);
  for (let i = 1; i < 4; i++) ctx.lineTo(sx[i], sy[i]);
  ctx.closePath();
  ctx.fill();
}

function drawBlock(b) {
  const hw = b.width/2, hd = b.depth/2;
  const bx = b.worldX, by = b.worldY, h = b.height;

  // top face
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.moveTo(isoX(bx - hw, by - hd), isoY(bx - hw, by - hd, h));
  ctx.lineTo(isoX(bx + hw, by - hd), isoY(bx + hw, by - hd, h));
  ctx.lineTo(isoX(bx + hw, by + hd), isoY(bx + hw, by + hd, h));
  ctx.lineTo(isoX(bx - hw, by + hd), isoY(bx - hw, by + hd, h));
  ctx.closePath();
  ctx.fill();

  // front face
  ctx.fillStyle = shadeColor(b.color, 0.72);
  ctx.beginPath();
  ctx.moveTo(isoX(bx - hw, by + hd), isoY(bx - hw, by + hd, 0));
  ctx.lineTo(isoX(bx - hw, by + hd), isoY(bx - hw, by + hd, h));
  ctx.lineTo(isoX(bx + hw, by + hd), isoY(bx + hw, by + hd, h));
  ctx.lineTo(isoX(bx + hw, by + hd), isoY(bx + hw, by + hd, 0));
  ctx.closePath();
  ctx.fill();

  // right face
  ctx.fillStyle = shadeColor(b.color, 0.55);
  ctx.beginPath();
  ctx.moveTo(isoX(bx + hw, by - hd), isoY(bx + hw, by - hd, 0));
  ctx.lineTo(isoX(bx + hw, by - hd), isoY(bx + hw, by - hd, h));
  ctx.lineTo(isoX(bx + hw, by + hd), isoY(bx + hw, by + hd, h));
  ctx.lineTo(isoX(bx + hw, by + hd), isoY(bx + hw, by + hd, 0));
  ctx.closePath();
  ctx.fill();
}

function drawCenterHint(block) {
  const cx = isoX(block.worldX, block.worldY);
  const cy = isoY(block.worldX, block.worldY, block.height + 1);
  const r = parseInt(block.color.slice(1,3),16);
  const g = parseInt(block.color.slice(3,5),16);
  const b = parseInt(block.color.slice(5,7),16);
  ctx.strokeStyle = `rgb(${255-r},${255-g},${255-b})`;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5 * SCALE, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = `rgb(${255-r},${255-g},${255-b})`;
  ctx.beginPath();
  ctx.arc(cx, cy, 2 * SCALE, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawLandingMark(now) {
  if (!landingMarkTime) return;
  const elapsed = now - landingMarkTime;
  let duration;
  switch (landingQuality) {
    case QUALITY_PERFECT: duration = 1500; break;
    case QUALITY_GOOD: duration = 1000; break;
    default: duration = 800;
  }
  if (elapsed > duration) { landingMarkTime = 0; return; }

  const alpha = 1 - elapsed / duration;
  const pulse = 1 + 0.35 * Math.sin(elapsed * 0.015);
  const bh = player.standingOn ? player.standingOn.height : 60;
  const mx = isoX(landingMarkX, landingMarkY);
  const my = isoY(landingMarkX, landingMarkY, bh + 1);

  let color, radius;
  switch (landingQuality) {
    case QUALITY_PERFECT: color = '#FFD700'; radius = 13 * SCALE * pulse; break;
    case QUALITY_GOOD: color = '#FFF'; radius = 9 * SCALE * pulse; break;
    default: color = '#AAA'; radius = 6 * SCALE;
  }

  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(mx, my, radius, 0, Math.PI*2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(mx, my, 3.5 * SCALE, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  let px, py;
  const sh = player.standingOn ? player.standingOn.height : 60;

  if (state === 'GAME_OVER' && fallAnim) {
    px = isoX(fallAnim.edgeX, fallAnim.edgeY);
    py = isoY(fallAnim.edgeX, fallAnim.edgeY, player.worldZ + sh);
  } else {
    px = isoX(player.worldX, player.worldY);
    py = isoY(player.worldX, player.worldY, player.worldZ + sh);
  }

  const chargeSquat = state === 'CHARGING' ? player.squash : 0;
  let bounceSquat = 0;
  if (landBounceStart) {
    const bt = clamp((performance.now() - landBounceStart) / landBounceDur, 0, 1);
    bounceSquat = 0.35 * (1 - bt) * Math.sin(bt * Math.PI * 3);
    if (bt >= 1) landBounceStart = 0;
  }
  const totalSquat = Math.max(chargeSquat, bounceSquat);
  const bodyH = 50 * SCALE * (1 - totalSquat * 0.55);
  const bodyW = 28 * SCALE * (1 + totalSquat * 0.35);

  const left = px - bodyW/2;
  const top = py - bodyH;
  const corner = bodyW/2;

  // body
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.lineTo(left + bodyW - corner, top);
  ctx.arcTo(left + bodyW, top, left + bodyW, top + corner, corner);
  ctx.lineTo(left + bodyW, py);
  ctx.lineTo(left, py);
  ctx.lineTo(left, top + corner);
  ctx.arcTo(left, top, left + corner, top, corner);
  ctx.closePath();
  ctx.fill();

  // head
  const headR = bodyW * 0.42;
  const headCY = top + headR * 0.4;
  ctx.beginPath();
  ctx.arc(px, headCY, headR, 0, Math.PI*2);
  ctx.fill();

  // eyes
  ctx.fillStyle = '#FFF';
  const eyeR = headR * 0.28;
  const eyeY = headCY - headR * 0.15;
  const eyeOff = headR * 0.35;
  ctx.beginPath();
  ctx.arc(px - eyeOff, eyeY, eyeR, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px + eyeOff, eyeY, eyeR, 0, Math.PI*2);
  ctx.fill();
}

function drawHUD(w, h, now) {
  // score
  ctx.fillStyle = '#FFF';
  ctx.font = `bold ${w*0.09}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(score, w/2, h*0.1);
  ctx.shadowBlur = 0;

  // power bar
  if (state === 'CHARGING') {
    const barW = w * 0.45, barH = 8;
    const bx = w/2 - barW/2;
    const by = h * 0.72;

    ctx.fillStyle = 'rgba(255,255,255,0.27)';
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, barH/2);
    ctx.fill();

    const fillW = barW * power;
    if (fillW > 0) {
      const r = Math.round(255 * power);
      const g = Math.round(255 * (1 - power));
      ctx.fillStyle = `rgb(${r},${g},80)`;
      ctx.beginPath();
      ctx.roundRect(bx, by, Math.max(fillW, barH), barH, barH/2);
      ctx.fill();
    }
  }
}

function drawBonus(w, h, now) {
  if (!bonusText) return;
  const elapsed = now - bonusStartTime;
  if (elapsed > BONUS_DISPLAY_MS) { bonusText = null; return; }

  const alpha = 1 - elapsed / BONUS_DISPLAY_MS;
  const offY = -(elapsed / BONUS_DISPLAY_MS) * 60;
  const sh = player.standingOn ? player.standingOn.height : 60;
  const sx = isoX(player.worldX, player.worldY) + w * 0.5;
  const sy = isoY(player.worldX, player.worldY, sh) + h * 0.5 + offY - 40;

  ctx.fillStyle = '#FFD700';
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${w*0.07}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  ctx.fillText(bonusText, sx, sy);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawGameOver(w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.53)';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#FFF';
  ctx.font = `bold ${w*0.07}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText('Game Over', w/2, h/2 - h*0.07);
  ctx.fillText('Score: ' + score, w/2, h/2 + h*0.03);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${w*0.045}px sans-serif`;
  ctx.fillText('Tap to restart', w/2, h/2 + h*0.12);
}

// ==================== INPUT ====================
function getPos(e) {
  // touchend uses changedTouches, touchstart uses touches
  if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function handleDown(e) {
  e.preventDefault();
  if (screen === 'game') {
    if (state === 'GAME_OVER') {
      resetGame();
      return;
    }
    if (state === 'IDLE') {
      startCharging();
      return;
    }
  }
}

function handleUp(e) {
  e.preventDefault();
  if (screen === 'game') {
    if (state === 'CHARGING') {
      startJump();
      return;
    }
  } else if (screen === 'menu') {
    const pos = getPos(e);
    const w = W(), h = H();
    const btnY = h*0.7, btnR = Math.min(w, h)*0.13;
    const dx = pos.x - w/2, dy = pos.y - btnY;
    if (dx*dx + dy*dy <= (btnR + 20)*(btnR + 20)) {
      screen = 'game';
      setupGame();
    }
  }
}

canvas.addEventListener('mousedown', handleDown);
canvas.addEventListener('touchstart', handleDown, {passive:false});
canvas.addEventListener('mouseup', handleUp);
canvas.addEventListener('touchend', handleUp, {passive:false});
canvas.addEventListener('touchcancel', handleUp, {passive:false});

// ==================== START ====================
requestAnimationFrame(gameLoop);

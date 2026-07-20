'use strict';

const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.FORCE_HTTPS === 'true' && req.get('x-forwarded-proto') !== 'https' && !req.secure) {
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});
const tlsKey = process.env.SSL_KEY_PATH;
const tlsCert = process.env.SSL_CERT_PATH;
const server = tlsKey && tlsCert
  ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, app)
  : http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = Number(process.env.PORT) || 31400;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size }));

const STAGE_WIDTH = 5000;
const STAGES = [
  { id: 'city', name: 'STADT', objective: 'Raube die City Bank aus und verlasse sie.' },
  { id: 'country', name: 'LAND', objective: 'Durchsuche die Scheune nach der Schmugglerroute.' },
  { id: 'coast', name: 'KÜSTENVORSTADT', objective: 'Triff den Kontakt in der Beachbar.' },
  { id: 'harbor', name: 'HAFEN', objective: 'Hole die Schmuggelware und liefere sie in der Rotlicht-Kneipe ab.' }
];
const WORLD_WIDTH = STAGE_WIDTH * STAGES.length;
const GROUND_Y = 520;
const players = new Map();
const bullets = [];
const police = [];
const barricades = [];
let nextId = 1;

const WEAPONS = {
  pistol:  { label: 'Pistole', cooldown: 14, damage: 30, speed: 14, life: 75, pellets: 1, spread: 0 },
  smg:     { label: 'Maschinenpistole', cooldown: 5, damage: 14, speed: 17, life: 62, pellets: 1, spread: 1.5 },
  shotgun: { label: 'Schrotflinte', cooldown: 30, damage: 18, speed: 13, life: 38, pellets: 5, spread: 4.5 },
  pulse:   { label: 'Impulswerfer', cooldown: 22, damage: 48, speed: 11, life: 85, pellets: 1, spread: 0 }
};
const SCORE_BY_WEAPON = { pistol: 75, smg: 100, shotgun: 150, pulse: 250 };
const WEAPON_SHOP = [
  { id: 'smg', price: 600 },
  { id: 'shotgun', price: 1200 },
  { id: 'pulse', price: 2000 }
];
const armorPickups = [680, 3550, 5680, 9200, 10800, 14200, 15800, 19100].map((x, index) => ({
  id: `armor-${index + 1}`, x, active: true, respawn: 0
}));
const stageItems = [
  { id: 'city-cash', x: 2380, type: 'cash', label: 'GELDKOFFER' },
  { id: 'city-med', x: 4300, type: 'medkit', label: 'MEDKIT' },
  { id: 'land-tools', x: 6050, type: 'kit', label: 'WERKZEUGKISTE' },
  { id: 'land-med', x: 8150, type: 'medkit', label: 'ERSTE HILFE' },
  { id: 'land-cash', x: 9650, type: 'cash', label: 'FARMKASSE' },
  { id: 'coast-sports', x: 11200, type: 'cash', label: 'SPORTTASCHE' },
  { id: 'coast-med', x: 12850, type: 'medkit', label: 'BEACH-MEDKIT' },
  { id: 'coast-kit', x: 14600, type: 'kit', label: 'PLATZWART-KISTE' },
  { id: 'harbor-package', x: 16250, type: 'contraband', label: 'SCHMUGGELPAKET' },
  { id: 'harbor-cash', x: 17600, type: 'cash', label: 'HAFENKASSE' },
  { id: 'harbor-kit', x: 18800, type: 'kit', label: 'CONTAINER-WERKZEUG' }
].map(item => ({ ...item, active: true, respawn: 0 }));

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const HIGHSCORE_FILE = path.join(DATA_DIR, 'highscores.json');
let highscoreRecords = [];

function loadHighscores() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(HIGHSCORE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(HIGHSCORE_FILE, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed.highscores;
    if (!Array.isArray(rows)) return;
    highscoreRecords = rows.filter(row => row && typeof row.name === 'string' && Number.isFinite(row.score))
      .map(row => ({ name: cleanName(row.name), score: Math.max(0, Math.floor(row.score)), updatedAt: row.updatedAt || null }))
      .sort((a, b) => b.score - a.score).slice(0, 100);
  } catch (error) {
    console.error('Highscore konnte nicht geladen werden:', error.message);
    highscoreRecords = [];
  }
}

function saveHighscores() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${HIGHSCORE_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, highscores: highscoreRecords }, null, 2));
    fs.renameSync(temporary, HIGHSCORE_FILE);
  } catch (error) {
    console.error('Highscore konnte nicht gespeichert werden:', error.message);
  }
}

function updateHighscore(player) {
  const key = player.name.toLocaleLowerCase('de-CH');
  const existing = highscoreRecords.find(row => row.name.toLocaleLowerCase('de-CH') === key);
  if (existing && existing.score >= player.score) return;
  if (existing) {
    existing.name = player.name; existing.score = player.score; existing.updatedAt = new Date().toISOString();
  } else highscoreRecords.push({ name: player.name, score: player.score, updatedAt: new Date().toISOString() });
  highscoreRecords.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de-CH'));
  highscoreRecords = highscoreRecords.slice(0, 100);
  saveHighscores();
}

function publicHighscores() {
  return highscoreRecords.slice(0, 10).map(({ name, score }) => ({ name, score }));
}

loadHighscores();

const buildings = [
  { id: 'city-safe', type: 'hideout', x: 530, w: 300, label: 'Waschsalon' },
  { id: 'city-bank', type: 'bank', x: 1320, w: 390, label: 'CITY BANK' },
  { id: 'city-hotel', type: 'hideout', x: 3150, w: 330, label: 'Hotel Nova' },
  { id: 'land-house', type: 'hideout', x: 5350, w: 320, label: 'Farmhaus' },
  { id: 'land-barn', type: 'barn', x: 7050, w: 430, label: 'ALTE SCHEUNE' },
  { id: 'land-mill', type: 'hideout', x: 8850, w: 320, label: 'Landmühle' },
  { id: 'coast-villa', type: 'hideout', x: 10300, w: 350, label: 'Villa Azure' },
  { id: 'coast-tennis', type: 'hideout', x: 11900, w: 390, label: 'Tennis Club' },
  { id: 'coast-beachbar', type: 'beachbar', x: 13600, w: 430, label: 'SUNSET BEACHBAR' },
  { id: 'harbor-warehouse', type: 'hideout', x: 15300, w: 390, label: 'Lagerhaus 9' },
  { id: 'harbor-container', type: 'container', x: 17400, w: 440, label: 'CONTAINERTERMINAL' },
  { id: 'harbor-pub', type: 'pub', x: 19300, w: 430, label: 'ROTE LATERNE' }
];
const vendors = [
  { id: 'vendor-city', x: 2650, label: 'Strassenhändler' },
  { id: 'vendor-land', x: 7900, label: 'Landhändler' },
  { id: 'vendor-coast', x: 12550, label: 'Promenaden-Shop' },
  { id: 'vendor-harbor', x: 18400, label: 'Hafen-Schieber' }
];

function cleanName(value) {
  return String(value || 'Runner').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || 'Runner';
}

function newPlayer(ws, name) {
  return {
    id: `p${nextId++}`, ws, name: cleanName(name), x: 160 + Math.random() * 120,
    y: GROUND_Y - 62, vx: 0, vy: 0, width: 34, height: 62, dir: 1,
    health: 100, armor: 0, maxArmor: 100, cash: 0, loot: 0, score: 0, hidden: false, hiddenIn: null,
    weapons: ['pistol'], activeWeapon: 'pistol', barricadeKits: 3,
    inside: null, interiorX: 140, bankLooted: false, harborPackage: false,
    unlockedStage: 0, currentStage: 0, checkpointStage: 0, stageGoals: [false, false, false, false],
    keys: {}, shootCooldown: 0, interactCooldown: 0, invuln: 0, wanted: 1,
    color: `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`, respawn: 0,
    message: 'Bleib in Bewegung!'
  };
}

function publicPlayer(p) {
  const { ws, keys, ...safe } = p;
  return safe;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function sendSfx(player, name, detail = '') {
  send(player.ws, { type: 'sfx', name, detail });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}

function spawnPolice(target) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const stage = stageIndexAt(target.x), stageStart = stage * STAGE_WIDTH + 20, stageEnd = (stage + 1) * STAGE_WIDTH - 20;
  police.push({
    id: `c${nextId++}`, x: clamp(target.x + side * (620 + Math.random() * 260), stageStart, stageEnd),
    y: GROUND_Y - 58, width: 32, height: 58, health: 60, dir: -side,
    targetId: target.id, shootCooldown: 40 + Math.random() * 50, flash: 0
  });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function near(a, b, distance) { return Math.abs(a.x - b.x) < distance; }
function stageIndexAt(x) { return clamp(Math.floor(x / STAGE_WIDTH), 0, STAGES.length - 1); }

function completeStage(player, stageIndex) {
  if (player.stageGoals[stageIndex]) return false;
  player.stageGoals[stageIndex] = true;
  player.unlockedStage = Math.max(player.unlockedStage, Math.min(stageIndex + 1, STAGES.length - 1));
  send(player.ws, {
    type: 'stageUnlocked',
    completed: stageIndex,
    unlocked: player.unlockedStage,
    name: STAGES[player.unlockedStage].name
  });
  sendSfx(player, 'stage', STAGES[stageIndex].id);
  return true;
}

function interact(p) {
  if (p.interactCooldown > 0 || p.respawn > 0) return;
  p.interactCooldown = 28;

  if (p.inside) {
    const current = buildings.find(b => b.id === p.inside);
    if (!current) {
      p.inside = null; p.hidden = false; p.hiddenIn = null;
      return;
    }
    if (current.type === 'bank') {
      if (p.interiorX < 190) {
        const completed = p.bankLooted && completeStage(p, 0);
        p.inside = null; p.hidden = false; p.hiddenIn = null;
        p.x = current.x + current.w / 2; p.wanted = clamp(p.wanted + (p.bankLooted ? 1 : 0), 1, 5);
        p.message = completed ? 'STAGE 2 FREIGESCHALTET: Flieh aufs Land!' : 'Du hast die Bank verlassen.';
        if (p.bankLooted) for (let i = 0; i < Math.min(3, p.wanted); i++) spawnPolice(p);
      } else if (p.interiorX > 790) {
        if (p.bankLooted) p.message = 'Der Tresor ist bereits leer. Zurück zum Ausgang!';
        else {
          const amount = 2 + Math.floor(Math.random() * 3);
          p.loot += amount; p.bankLooted = true;
          p.message = `${amount} Beutesäcke aus dem Tresor! Lauf links zum Ausgang.`;
        }
      } else p.message = 'Der Tresor ist rechts – der Ausgang links.';
    } else {
      p.inside = null; p.hidden = false; p.hiddenIn = null;
      p.message = `Du verlässt ${current.label}.`;
    }
    return;
  }

  if (p.hidden) {
    p.hidden = false;
    p.hiddenIn = null;
    p.message = 'Du verlässt dein Versteck.';
    return;
  }

  const building = buildings.find(b => Math.abs(p.x - (b.x + b.w / 2)) < 125);
  if (building) {
    if (building.type === 'bank') {
      p.inside = building.id; p.hidden = true; p.hiddenIn = building.id;
      p.interiorX = 140; p.bankLooted = false; p.vx = 0;
      p.message = 'In der Bank: Lauf nach rechts zum Tresor und drücke E.';
    } else if (building.type === 'barn') {
      if (completeStage(p, 1)) {
        p.loot += 2; p.wanted = clamp(p.wanted + 1, 1, 5);
        p.message = 'Route in der Scheune gefunden, 2 Säcke Beute! STAGE 3 FREIGESCHALTET.';
      } else p.message = 'Die Scheune ist leer. Die Route zur Küste ist bereits bekannt.';
    } else if (building.type === 'beachbar') {
      if (completeStage(p, 2)) {
        p.health = Math.min(100, p.health + 30); p.cash += 400;
        p.message = 'Kontakt getroffen: Hafenpass und $400! STAGE 4 FREIGESCHALTET.';
      } else p.message = 'Der Beachbar-Kontakt hat dir bereits den Hafenpass gegeben.';
    } else if (building.type === 'container') {
      if (!p.harborPackage) {
        p.harborPackage = true; p.wanted = 5;
        p.message = 'Schmuggelware übernommen! Bring sie zur Rotlicht-Kneipe „Rote Laterne“.';
        sendSfx(p, 'pickup', 'contraband');
        for (let i = 0; i < 3; i++) spawnPolice(p);
      } else p.message = 'Du trägst die Schmuggelware bereits. Ziel: Rote Laterne.';
    } else if (building.type === 'pub') {
      if (!p.harborPackage) p.message = 'Der Wirt wartet auf die Ware aus dem Containerterminal.';
      else {
        p.harborPackage = false; p.cash += 1600; p.wanted = 2;
        const completed = completeStage(p, 3);
        p.message = completed ? 'SCHMUGGEL ABGESCHLOSSEN! Alle 4 Stages gemeistert – $1600.' : 'Lieferung abgeschlossen – $1600.';
      }
    } else {
      p.hidden = true;
      p.hiddenIn = building.id;
      p.vx = 0;
      p.message = `Verschanzt in: ${building.label}. Drücke E zum Verlassen.`;
    }
    return;
  }

  const vendor = vendors.find(v => Math.abs(p.x - v.x) < 90);
  if (vendor) {
    if (p.loot > 0) {
      const earned = p.loot * 250;
      p.cash += earned;
      p.message = `${p.loot} Beutesack${p.loot > 1 ? 'säcke' : ''} für $${earned} verkauft!`;
      p.loot = 0;
      p.wanted = Math.max(1, p.wanted - 1);
    } else {
      const offer = WEAPON_SHOP.find(item => !p.weapons.includes(item.id));
      if (offer && p.cash >= offer.price) {
        p.cash -= offer.price; p.weapons.push(offer.id); p.activeWeapon = offer.id;
        p.message = `${WEAPONS[offer.id].label} für $${offer.price} gekauft und ausgerüstet!`;
      } else if (offer) {
        p.message = `${WEAPONS[offer.id].label} kostet $${offer.price}. Erst Beute verkaufen!`;
      } else if (p.cash >= 250) {
        p.cash -= 250; p.barricadeKits++;
        p.message = 'Barrikaden-Bausatz für $250 gekauft.';
      } else p.message = 'Alle Waffen gekauft. Ein Barrikaden-Bausatz kostet $250.';
    }
  } else p.message = 'Hier gibt es nichts zu benutzen.';
}

function fire(p) {
  if (p.shootCooldown > 0 || p.hidden || p.respawn > 0) return;
  const weaponId = WEAPONS[p.activeWeapon] ? p.activeWeapon : 'pistol';
  const weapon = WEAPONS[weaponId];
  p.shootCooldown = weapon.cooldown;
  for (let i = 0; i < weapon.pellets; i++) {
    const spread = weapon.pellets === 1 ? (Math.random() - .5) * weapon.spread : (i - (weapon.pellets - 1) / 2) * weapon.spread;
    bullets.push({
      id: `b${nextId++}`, owner: p.id, x: p.x + p.dir * 28, y: p.y + 24,
      vx: p.dir * weapon.speed, vy: spread * .12, life: weapon.life,
      damage: weapon.damage, police: false, weapon: weaponId
    });
  }
  sendSfx(p, 'shot', weaponId);
}

function switchWeapon(p, requested) {
  if (p.respawn > 0) return;
  if (requested && p.weapons.includes(requested)) p.activeWeapon = requested;
  else {
    const index = p.weapons.indexOf(p.activeWeapon);
    p.activeWeapon = p.weapons[(index + 1) % p.weapons.length];
  }
  p.message = `Waffe: ${WEAPONS[p.activeWeapon].label}`;
}

function buildBarricade(p) {
  if (p.respawn > 0 || p.hidden || p.inside) return;
  if (p.barricadeKits <= 0) { p.message = 'Keine Bausätze mehr – beim Händler für $250 erhältlich.'; return; }
  const x = clamp(p.x + p.dir * 76, 40, WORLD_WIDTH - 40);
  if (barricades.some(b => Math.abs(b.x - x) < 120)) { p.message = 'Hier steht bereits eine Barrikade.'; return; }
  p.barricadeKits--;
  barricades.push({ id: `wall${nextId++}`, ownerId: p.id, x, health: 180, maxHealth: 180, life: 4500 });
  p.message = `Barrikade gebaut – ${p.barricadeKits} Bausatz/Bausätze übrig.`;
}

wss.on('connection', ws => {
  let player = null;
  send(ws, { type: 'hello', worldWidth: WORLD_WIDTH, groundY: GROUND_Y, stageWidth: STAGE_WIDTH, stages: STAGES, buildings, vendors });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'join' && !player) {
      player = newPlayer(ws, msg.name);
      players.set(player.id, player);
      send(ws, { type: 'joined', id: player.id });
      broadcast({ type: 'notice', text: `${player.name} ist der Jagd beigetreten.` });
    } else if (msg.type === 'input' && player) {
      player.keys = msg.keys && typeof msg.keys === 'object' ? msg.keys : {};
      if (process.env.NODE_ENV === 'test' && msg.action === 'testPosition') {
        if (Number.isFinite(msg.x)) player.x = clamp(msg.x, 12, WORLD_WIDTH - 12);
        if (Number.isFinite(msg.interiorX)) player.interiorX = clamp(msg.interiorX, 75, 925);
      }
      if (msg.action === 'shoot') fire(player);
      if (msg.action === 'interact') interact(player);
      if (msg.action === 'switchWeapon') switchWeapon(player, msg.weapon);
      if (msg.action === 'build') buildBarricade(player);
    }
  });

  ws.on('close', () => {
    if (!player) return;
    updateHighscore(player);
    players.delete(player.id);
    broadcast({ type: 'notice', text: `${player.name} hat die Stadt verlassen.` });
  });
});

function updatePlayer(p) {
  if (p.respawn > 0) {
    p.respawn--;
    if (p.respawn === 0) {
      p.x = p.checkpointStage * STAGE_WIDTH + 180; p.y = GROUND_Y - p.height; p.health = 100; p.armor = 0; p.loot = 0; p.harborPackage = false;
      p.wanted = 1; p.message = 'Zurück im Rennen – die Beute ist verloren.';
    }
    return;
  }
  if (p.shootCooldown > 0) p.shootCooldown--;
  if (p.interactCooldown > 0) p.interactCooldown--;
  if (p.invuln > 0) p.invuln--;
  if (p.inside) {
    const speed = p.keys.shift ? 7 : 5;
    p.vx = p.keys.left ? -speed : p.keys.right ? speed : 0;
    p.dir = p.vx < 0 ? -1 : p.vx > 0 ? 1 : p.dir;
    p.interiorX = clamp(p.interiorX + p.vx, 75, 925);
    return;
  }
  if (p.hidden) return;

  const speed = p.keys.shift ? 6.8 : 4.7;
  p.vx = 0;
  if (p.keys.left) { p.vx = -speed; p.dir = -1; }
  if (p.keys.right) { p.vx = speed; p.dir = 1; }
  if (p.keys.jump && p.y >= GROUND_Y - p.height - 1) p.vy = -12.5;
  p.vy += 0.68;
  const maximumX = p.unlockedStage >= STAGES.length - 1 ? WORLD_WIDTH - 12 : (p.unlockedStage + 1) * STAGE_WIDTH - 55;
  p.x = clamp(p.x + p.vx, 12, maximumX);
  const nextStage = stageIndexAt(p.x);
  if (nextStage !== p.currentStage) {
    p.currentStage = nextStage; p.checkpointStage = Math.max(p.checkpointStage, nextStage);
    p.message = `STAGE ${nextStage + 1}: ${STAGES[nextStage].name} – ${STAGES[nextStage].objective}`;
    sendSfx(p, 'stage', STAGES[nextStage].id);
  } else if (p.keys.right && p.x >= maximumX - 2 && p.unlockedStage < STAGES.length - 1) {
    p.message = `Übergang gesperrt: ${STAGES[p.unlockedStage].objective}`;
  }
  p.y += p.vy;
  if (p.y > GROUND_Y - p.height) { p.y = GROUND_Y - p.height; p.vy = 0; }
}

function updatePolice(c) {
  const target = players.get(c.targetId) || [...players.values()].find(p => !p.hidden && !p.respawn);
  if (!target || target.hidden || target.respawn) { c.x += c.dir * 1.2; return; }
  c.dir = target.x >= c.x ? 1 : -1;
  const distance = Math.abs(target.x - c.x);
  const blocker = barricades.find(b => b.x > Math.min(c.x, target.x) && b.x < Math.max(c.x, target.x) && Math.abs(c.x - b.x) < 105);
  if (distance > 170 && !blocker) c.x += c.dir * (2.1 + target.wanted * .22);
  c.shootCooldown--;
  if (distance < 520 && c.shootCooldown <= 0) {
    bullets.push({ id: `b${nextId++}`, owner: c.id, x: c.x + c.dir * 22, y: c.y + 23, vx: c.dir * 10, vy: 0, life: 90, damage: 12, police: true, weapon: 'police' });
    c.shootCooldown = 70 + Math.random() * 45;
  }
  if (c.flash > 0) c.flash--;
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i], previousX = b.x; b.x += b.vx; b.y += b.vy || 0; b.life--;
    let hit = false;
    for (const wall of barricades) {
      const crossed = wall.x >= Math.min(previousX, b.x) - 12 && wall.x <= Math.max(previousX, b.x) + 12;
      if (crossed && b.y > GROUND_Y - 92 && b.y < GROUND_Y + 8 && (b.police || wall.ownerId !== b.owner)) {
        wall.health -= b.damage || 12; hit = true; break;
      }
    }
    if (hit) { bullets.splice(i, 1); continue; }
    if (b.police) {
      for (const p of players.values()) {
        if (!p.hidden && !p.respawn && p.invuln <= 0 && Math.abs(b.x - p.x) < 25 && Math.abs(b.y - (p.y + 28)) < 38) {
          let damage = b.damage || 12;
          const absorbed = Math.min(p.armor, damage);
          p.armor -= absorbed; damage -= absorbed;
          p.health = Math.max(0, p.health - damage); p.invuln = 24; hit = true;
          p.message = absorbed > 0 ? `Rüstung absorbiert ${absorbed} Schaden.` : 'Treffer! Such Deckung.';
          if (p.health <= 0) { p.respawn = 150; p.message = 'Erwischt! Neustart in 3 Sekunden …'; }
          break;
        }
      }
    } else {
      for (let j = police.length - 1; j >= 0; j--) {
        const c = police[j];
        if (Math.abs(b.x - c.x) < 25 && Math.abs(b.y - (c.y + 28)) < 36) {
          c.health -= b.damage || 30; c.flash = 5; hit = true;
          const owner = players.get(b.owner);
          if (c.health <= 0) {
            police.splice(j, 1);
            if (owner) {
              const reward = SCORE_BY_WEAPON[b.weapon] || SCORE_BY_WEAPON.pistol;
              owner.score += reward; owner.message = `${WEAPONS[b.weapon]?.label || 'Waffe'}: Gegner ausgeschaltet – +${reward} Punkte!`;
              updateHighscore(owner);
            }
          }
          break;
        }
      }
    }
    if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD_WIDTH) bullets.splice(i, 1);
  }
}

function updateWorldItems() {
  for (const pickup of armorPickups) {
    if (!pickup.active) {
      if (--pickup.respawn <= 0) pickup.active = true;
      continue;
    }
    for (const p of players.values()) {
      if (!p.hidden && !p.inside && !p.respawn && p.armor < p.maxArmor && Math.abs(p.x - pickup.x) < 42) {
        p.armor = Math.min(p.maxArmor, p.armor + 50); p.barricadeKits++;
        pickup.active = false; pickup.respawn = 1500;
        p.message = `Rüstung +50 und 1 Barrikaden-Bausatz (${p.barricadeKits}).`;
        sendSfx(p, 'pickup', 'armor');
        break;
      }
    }
  }
  for (const item of stageItems) {
    if (!item.active) {
      if (--item.respawn <= 0) item.active = true;
      continue;
    }
    for (const p of players.values()) {
      if (p.hidden || p.inside || p.respawn || Math.abs(p.x - item.x) >= 42) continue;
      if (item.type === 'medkit' && p.health >= 100) continue;
      if (item.type === 'medkit') {
        p.health = Math.min(100, p.health + 35); p.message = 'Medkit: Gesundheit +35.';
      } else if (item.type === 'kit') {
        p.barricadeKits += 2; p.message = 'Werkzeugkiste: 2 Barrikaden-Bausätze.';
      } else if (item.type === 'cash') {
        p.cash += 250; p.message = 'Wertvoller Fund: $250.';
      } else if (item.type === 'contraband') {
        p.loot += 1; p.wanted = clamp(p.wanted + 1, 1, 5); p.message = 'Schmuggelpaket gefunden: 1 Beute.';
      }
      item.active = false; item.respawn = 2000;
      sendSfx(p, 'pickup', item.type);
      break;
    }
  }
  for (let i = barricades.length - 1; i >= 0; i--) {
    if (--barricades[i].life <= 0 || barricades[i].health <= 0) barricades.splice(i, 1);
  }
}

let spawnClock = 0;
setInterval(() => {
  for (const p of players.values()) updatePlayer(p);
  for (const c of police) updatePolice(c);
  updateBullets();
  updateWorldItems();
  spawnClock++;
  if (spawnClock > 180) {
    spawnClock = 0;
    for (const p of players.values()) if (!p.hidden && !p.respawn && police.filter(c => c.targetId === p.id).length < p.wanted) spawnPolice(p);
  }
  broadcast({
    type: 'state',
    players: [...players.values()].map(publicPlayer),
    police: police.map(c => ({ ...c })), bullets, barricades, armorPickups, stageItems, highscores: publicHighscores()
  });
}, 1000 / 50);

server.listen(PORT, '0.0.0.0', () => {
  const protocol = tlsKey && tlsCert ? 'https' : 'http';
  console.log(`KF City Runner läuft auf ${protocol}://localhost:${PORT}`);
});

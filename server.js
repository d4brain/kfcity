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
const PORT = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size }));

const WORLD_WIDTH = 7200;
const GROUND_Y = 520;
const players = new Map();
const bullets = [];
const police = [];
let nextId = 1;

const buildings = [
  { id: 'safe-1', type: 'hideout', x: 530, w: 300, label: 'Waschsalon' },
  { id: 'bank-1', type: 'bank', x: 1260, w: 360, label: 'CITY BANK' },
  { id: 'safe-2', type: 'hideout', x: 2180, w: 320, label: 'Kino Orion' },
  { id: 'bank-2', type: 'bank', x: 3070, w: 390, label: 'METRO BANK' },
  { id: 'safe-3', type: 'hideout', x: 4150, w: 340, label: 'Hotel Nova' },
  { id: 'bank-3', type: 'bank', x: 5260, w: 370, label: 'CENTRAL BANK' },
  { id: 'safe-4', type: 'hideout', x: 6240, w: 360, label: 'Parkhaus' }
];
const vendors = [
  { id: 'vendor-1', x: 930, label: 'Strassenhändler' },
  { id: 'vendor-2', x: 2700, label: 'Pfandhändler' },
  { id: 'vendor-3', x: 4780, label: 'Nachtmarkt' },
  { id: 'vendor-4', x: 6750, label: 'Hinterhof-Shop' }
];

function cleanName(value) {
  return String(value || 'Runner').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || 'Runner';
}

function newPlayer(ws, name) {
  return {
    id: `p${nextId++}`, ws, name: cleanName(name), x: 160 + Math.random() * 120,
    y: GROUND_Y - 62, vx: 0, vy: 0, width: 34, height: 62, dir: 1,
    health: 100, cash: 0, loot: 0, score: 0, hidden: false, hiddenIn: null,
    inside: null, interiorX: 140, bankLooted: false,
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

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}

function spawnPolice(target) {
  const side = Math.random() < 0.5 ? -1 : 1;
  police.push({
    id: `c${nextId++}`, x: clamp(target.x + side * (620 + Math.random() * 260), 20, WORLD_WIDTH - 20),
    y: GROUND_Y - 58, width: 32, height: 58, health: 60, dir: -side,
    targetId: target.id, shootCooldown: 40 + Math.random() * 50, flash: 0
  });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function near(a, b, distance) { return Math.abs(a.x - b.x) < distance; }

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
        p.inside = null; p.hidden = false; p.hiddenIn = null;
        p.x = current.x + current.w / 2; p.wanted = clamp(p.wanted + (p.bankLooted ? 1 : 0), 1, 5);
        p.message = 'Du hast die Bank verlassen.';
        if (p.bankLooted) for (let i = 0; i < Math.min(3, p.wanted); i++) spawnPolice(p);
      } else if (p.interiorX > 790) {
        if (p.bankLooted) p.message = 'Der Tresor ist bereits leer. Zurück zum Ausgang!';
        else {
          const amount = 2 + Math.floor(Math.random() * 3);
          p.loot += amount; p.bankLooted = true; p.score += amount * 100;
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
      p.score += earned;
      p.message = `${p.loot} Beutesack${p.loot > 1 ? 'säcke' : ''} für $${earned} verkauft!`;
      p.loot = 0;
      p.wanted = Math.max(1, p.wanted - 1);
    } else p.message = 'Du hast keine Ware dabei.';
  } else p.message = 'Hier gibt es nichts zu benutzen.';
}

function fire(p) {
  if (p.shootCooldown > 0 || p.hidden || p.respawn > 0) return;
  p.shootCooldown = 14;
  bullets.push({ id: `b${nextId++}`, owner: p.id, x: p.x + p.dir * 25, y: p.y + 24, vx: p.dir * 14, life: 75, police: false });
}

wss.on('connection', ws => {
  let player = null;
  send(ws, { type: 'hello', worldWidth: WORLD_WIDTH, groundY: GROUND_Y, buildings, vendors });

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
      if (msg.action === 'shoot') fire(player);
      if (msg.action === 'interact') interact(player);
    }
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    broadcast({ type: 'notice', text: `${player.name} hat die Stadt verlassen.` });
  });
});

function updatePlayer(p) {
  if (p.respawn > 0) {
    p.respawn--;
    if (p.respawn === 0) {
      p.x = 180; p.y = GROUND_Y - p.height; p.health = 100; p.loot = 0;
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
  p.x = clamp(p.x + p.vx, 12, WORLD_WIDTH - 12);
  p.y += p.vy;
  if (p.y > GROUND_Y - p.height) { p.y = GROUND_Y - p.height; p.vy = 0; }
}

function updatePolice(c) {
  const target = players.get(c.targetId) || [...players.values()].find(p => !p.hidden && !p.respawn);
  if (!target || target.hidden || target.respawn) { c.x += c.dir * 1.2; return; }
  c.dir = target.x >= c.x ? 1 : -1;
  const distance = Math.abs(target.x - c.x);
  if (distance > 170) c.x += c.dir * (2.1 + target.wanted * .22);
  c.shootCooldown--;
  if (distance < 520 && c.shootCooldown <= 0) {
    bullets.push({ id: `b${nextId++}`, owner: c.id, x: c.x + c.dir * 22, y: c.y + 23, vx: c.dir * 10, life: 90, police: true });
    c.shootCooldown = 70 + Math.random() * 45;
  }
  if (c.flash > 0) c.flash--;
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.x += b.vx; b.life--;
    let hit = false;
    if (b.police) {
      for (const p of players.values()) {
        if (!p.hidden && !p.respawn && p.invuln <= 0 && Math.abs(b.x - p.x) < 25 && Math.abs(b.y - (p.y + 28)) < 38) {
          p.health = Math.max(0, p.health - 12); p.invuln = 24; hit = true;
          p.message = 'Treffer! Such Deckung.';
          if (p.health <= 0) { p.respawn = 150; p.message = 'Erwischt! Neustart in 3 Sekunden …'; }
          break;
        }
      }
    } else {
      for (let j = police.length - 1; j >= 0; j--) {
        const c = police[j];
        if (Math.abs(b.x - c.x) < 25 && Math.abs(b.y - (c.y + 28)) < 36) {
          c.health -= 30; c.flash = 5; hit = true;
          const owner = players.get(b.owner);
          if (c.health <= 0) { police.splice(j, 1); if (owner) { owner.score += 75; owner.message = 'Verfolger abgehängt: +75 Punkte'; } }
          break;
        }
      }
    }
    if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD_WIDTH) bullets.splice(i, 1);
  }
}

let spawnClock = 0;
setInterval(() => {
  for (const p of players.values()) updatePlayer(p);
  for (const c of police) updatePolice(c);
  updateBullets();
  spawnClock++;
  if (spawnClock > 180) {
    spawnClock = 0;
    for (const p of players.values()) if (!p.hidden && !p.respawn && police.filter(c => c.targetId === p.id).length < p.wanted) spawnPolice(p);
  }
  broadcast({
    type: 'state',
    players: [...players.values()].map(publicPlayer),
    police: police.map(c => ({ ...c })), bullets
  });
}, 1000 / 50);

server.listen(PORT, '0.0.0.0', () => {
  const protocol = tlsKey && tlsCert ? 'https' : 'http';
  console.log(`KF City Runner läuft auf ${protocol}://localhost:${PORT}`);
});

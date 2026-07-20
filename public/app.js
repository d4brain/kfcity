'use strict';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const login = document.querySelector('#login');
const hud = document.querySelector('#hud');
const statusEl = document.querySelector('#status');
const messageEl = document.querySelector('#message');
const healthFill = document.querySelector('#healthFill');
const healthValue = document.querySelector('#healthValue');
const armorFill = document.querySelector('#armorFill');
const armorValue = document.querySelector('#armorValue');
const cashEl = document.querySelector('#cash');
const lootEl = document.querySelector('#loot');
const wantedEl = document.querySelector('#wanted');
const scoreEl = document.querySelector('#score');
const weaponNameEl = document.querySelector('#weaponName');
const kitsEl = document.querySelector('#kits');
const noticeEl = document.querySelector('#notice');
const highscorePanel = document.querySelector('#highscorePanel');
const highscoreList = document.querySelector('#highscoreList');
const stageNumberEl = document.querySelector('#stageNumber');
const stageNameEl = document.querySelector('#stageName');
const stageObjectiveEl = document.querySelector('#stageObjective');
const stageDotsEl = document.querySelector('#stageDots');
const stageBanner = document.querySelector('#stageBanner');
const stageBannerName = document.querySelector('#stageBannerName');

let socket, myId, worldWidth = 20000, groundY = 520, stageWidth = 5000, scale = 1;
let stages = [
  { id: 'city', name: 'STADT', objective: 'Raube die City Bank aus und verlasse sie.' },
  { id: 'country', name: 'LAND', objective: 'Durchsuche die Scheune.' },
  { id: 'coast', name: 'KÜSTENVORSTADT', objective: 'Triff den Kontakt in der Beachbar.' },
  { id: 'harbor', name: 'HAFEN', objective: 'Schmuggelware zur Rotlicht-Kneipe bringen.' }
];
let buildings = [], vendors = [], state = { players: [], police: [], bullets: [], barricades: [], armorPickups: [], stageItems: [], highscores: [] };
let cameraX = 0, lastMessage = '', noticeTimer = 0, stageBannerTimer = 0;
let highscoreOpen = false;
const keys = { left: false, right: false, jump: false, shift: false };
const assets = {
  city: loadImage('/assets/city-background.png?v=1.6'),
  country: loadImage('/assets/land-background.png?v=4.0'),
  coast: loadImage('/assets/coast-background.png?v=4.0'),
  harbor: loadImage('/assets/harbor-background.png?v=4.0'),
  bank: loadImage('/assets/bank-interior.png?v=1.6'),
  runner: loadImage('/assets/runner-sprites.png?v=1.6'),
  police: loadImage('/assets/police-sprites.png?v=1.6'),
  projectiles: loadImage('/assets/projectile-sprites.png?v=2.0')
};
function loadImage(src) { const image = new Image(); image.src = src; return image; }

const audioToggle = document.querySelector('#audioToggle');
const musicTrack = new Audio('/assets/audio/downtown-pursuit.mp3?v=3.0');
musicTrack.loop = true;
musicTrack.preload = 'auto';
musicTrack.volume = .24;
let audioContext = null, sfxMaster = null, noiseBuffer = null;
let previousAudioState = null, knownBullets = new Set(), knownBarricades = new Set();
let audioEnabled = (() => {
  try { return localStorage.getItem('kf-audio-enabled') !== 'false'; } catch { return true; }
})();

function updateAudioToggle() {
  audioToggle.textContent = audioEnabled ? '♫ TON AN' : '♫ TON AUS';
  audioToggle.classList.toggle('off', !audioEnabled);
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
}

function initAudioContext() {
  if (audioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = new AudioContextClass();
  sfxMaster = audioContext.createGain();
  sfxMaster.gain.value = .9;
  sfxMaster.connect(audioContext.destination);
  noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
  const channel = noiseBuffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
}

function unlockAudio() {
  if (!audioEnabled) return;
  initAudioContext();
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
  musicTrack.play().catch(() => {});
}

function audioOutput(source, pan = 0) {
  if (!audioContext || !sfxMaster) return null;
  if (typeof audioContext.createStereoPanner === 'function') {
    const panner = audioContext.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(panner); panner.connect(sfxMaster);
    return panner;
  }
  source.connect(sfxMaster);
  return sfxMaster;
}

function tone(frequency, duration, volume, options = {}) {
  if (!audioEnabled || !audioContext || !sfxMaster) return;
  const start = audioContext.currentTime + (options.delay || 0);
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = options.type || 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency || frequency), start + duration);
  gain.gain.setValueAtTime(Math.max(.0001, volume), start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain); audioOutput(gain, options.pan || 0);
  oscillator.start(start); oscillator.stop(start + duration + .02);
}

function noise(duration, volume, frequency, options = {}) {
  if (!audioEnabled || !audioContext || !sfxMaster || !noiseBuffer) return;
  const start = audioContext.currentTime + (options.delay || 0);
  const source = audioContext.createBufferSource(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
  source.buffer = noiseBuffer; filter.type = options.filter || 'bandpass'; filter.frequency.value = frequency; filter.Q.value = options.q || .8;
  gain.gain.setValueAtTime(Math.max(.0001, volume), start); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.connect(filter); filter.connect(gain); audioOutput(gain, options.pan || 0);
  source.start(start, Math.random() * .5, duration); source.stop(start + duration + .02);
}

function playSfx(kind, detail = '', pan = 0) {
  if (!audioEnabled) return;
  unlockAudio();
  if (!audioContext) return;
  if (kind === 'shot') {
    if (detail === 'smg') { noise(.055, .26, 1900, { pan }); tone(145, .07, .11, { type: 'square', endFrequency: 72, pan }); }
    else if (detail === 'shotgun') { noise(.22, .5, 720, { filter: 'lowpass', pan }); tone(105, .2, .24, { type: 'sawtooth', endFrequency: 38, pan }); }
    else if (detail === 'pulse') { tone(720, .25, .2, { type: 'sawtooth', endFrequency: 95, pan }); tone(118, .3, .26, { endFrequency: 42, pan }); }
    else { noise(.09, .34, 1450, { pan }); tone(175, .1, .14, { type: 'square', endFrequency: 68, pan }); }
  } else if (kind === 'policeShot') {
    noise(.065, .17, 2300, { pan }); tone(240, .08, .07, { type: 'square', endFrequency: 110, pan });
  } else if (kind === 'hit') {
    noise(.14, .32, 430, { filter: 'lowpass' }); tone(95, .18, .18, { type: 'square', endFrequency: 42 });
  } else if (kind === 'armorHit') {
    noise(.1, .2, 3100); tone(510, .16, .15, { type: 'triangle', endFrequency: 250 });
  } else if (kind === 'pickup') {
    tone(520, .12, .13); tone(780, .16, .14, { delay: .1 }); tone(1040, .18, .1, { delay: .2 });
  } else if (kind === 'score') {
    tone(420, .08, .1); tone(630, .1, .12, { delay: .07 }); tone(940, .18, .13, { delay: .15 });
  } else if (kind === 'cash') {
    tone(740, .08, .12, { type: 'triangle' }); tone(990, .14, .12, { type: 'triangle', delay: .09 });
  } else if (kind === 'build') {
    noise(.18, .28, 520, { filter: 'lowpass' }); tone(82, .2, .12, { type: 'square', endFrequency: 55 });
  } else if (kind === 'death') {
    tone(290, .45, .2, { type: 'sawtooth', endFrequency: 48 }); noise(.32, .24, 360, { filter: 'lowpass' });
  } else if (kind === 'weapon') {
    tone(330, .07, .08, { type: 'square' }); tone(500, .1, .09, { type: 'square', delay: .06 });
  } else if (kind === 'stage') {
    tone(220, .22, .16, { type: 'sawtooth', endFrequency: 440 });
    tone(440, .28, .18, { type: 'triangle', endFrequency: 880, delay: .18 });
    tone(880, .42, .16, { delay: .4 });
  } else {
    tone(620, .055, .06, { type: 'triangle', endFrequency: 480 });
  }
}

function processAudioState(nextState) {
  const me = nextState.players.find(player => player.id === myId);
  if (!me) return;
  musicTrack.volume = me.inside ? .14 : .24;

  if (!previousAudioState) {
    knownBullets = new Set(nextState.bullets.map(bullet => bullet.id));
    knownBarricades = new Set((nextState.barricades || []).map(wall => wall.id));
    previousAudioState = { ...me };
    return;
  }

  let nearbyPoliceShot = null;
  for (const bullet of nextState.bullets) {
    if (knownBullets.has(bullet.id)) continue;
    if (bullet.police && Math.abs(bullet.x - me.x) < 850) nearbyPoliceShot ||= Math.max(-1, Math.min(1, (bullet.x - me.x) / 700));
  }
  knownBullets = new Set(nextState.bullets.map(bullet => bullet.id));
  if (nearbyPoliceShot !== null) playSfx('policeShot', '', nearbyPoliceShot);

  const newWalls = (nextState.barricades || []).filter(wall => !knownBarricades.has(wall.id));
  if (newWalls.some(wall => wall.ownerId === myId)) playSfx('build');
  knownBarricades = new Set((nextState.barricades || []).map(wall => wall.id));

  if (me.respawn > 0 && previousAudioState.respawn <= 0) playSfx('death');
  else if (me.health < previousAudioState.health) playSfx('hit');
  else if (me.armor < previousAudioState.armor) playSfx('armorHit');
  if (me.score > previousAudioState.score) playSfx('score');
  if (me.cash > previousAudioState.cash) playSfx('cash');
  if (me.loot > previousAudioState.loot) playSfx('pickup');
  if (me.activeWeapon !== previousAudioState.activeWeapon) playSfx('weapon');
  previousAudioState = { ...me };
}

audioToggle.addEventListener('pointerdown', event => {
  event.preventDefault(); event.stopPropagation();
  audioEnabled = !audioEnabled;
  try { localStorage.setItem('kf-audio-enabled', String(audioEnabled)); } catch {}
  if (audioEnabled) { unlockAudio(); playSfx('ui'); }
  else { musicTrack.pause(); if (audioContext?.state === 'running') audioContext.suspend().catch(() => {}); }
  updateAudioToggle();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) musicTrack.pause();
  else if (audioEnabled && myId) unlockAudio();
});
updateAudioToggle();

function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; scale = devicePixelRatio; }
addEventListener('resize', resize); resize();

document.querySelector('#joinForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = document.querySelector('#name').value.trim();
  if (!name) return;
  unlockAudio(); playSfx('ui');
  connect(name);
});

function connect(name) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}`);
  statusEl.textContent = 'VERBINDE …';
  socket.addEventListener('open', () => { socket.send(JSON.stringify({ type: 'join', name })); statusEl.textContent = '● LIVE'; statusEl.classList.add('online'); });
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'hello') { worldWidth = msg.worldWidth; groundY = msg.groundY; stageWidth = msg.stageWidth || 5000; stages = msg.stages || stages; buildings = msg.buildings; vendors = msg.vendors; }
    if (msg.type === 'joined') { myId = msg.id; login.style.display = 'none'; hud.style.display = 'block'; unlockAudio(); }
    if (msg.type === 'sfx') playSfx(msg.name, msg.detail || '', msg.pan || 0);
    if (msg.type === 'stageUnlocked') {
      stageBannerName.textContent = msg.completed >= 3 ? 'ALLE STAGES GESCHAFFT' : `STAGE ${msg.unlocked + 1}: ${msg.name}`;
      stageBanner.classList.add('show'); stageBannerTimer = 210;
    }
    if (msg.type === 'state') { processAudioState(msg); state = msg; updateHud(); }
    if (msg.type === 'notice') { noticeEl.textContent = msg.text; noticeTimer = 220; }
  });
  socket.addEventListener('close', () => { statusEl.textContent = 'VERBINDUNG GETRENNT'; statusEl.classList.remove('online'); setTimeout(() => location.reload(), 1800); });
}

function send(action, extra={}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', keys, action, ...extra }));
}
function setKey(code, down) {
  if (['KeyA','ArrowLeft'].includes(code)) keys.left = down;
  if (['KeyD','ArrowRight'].includes(code)) keys.right = down;
  if (['KeyW','ArrowUp'].includes(code)) keys.jump = down;
  if (['ShiftLeft','ShiftRight'].includes(code)) keys.shift = down;
}
addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowUp','Space','Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat && e.code === 'Space') send('shoot');
  if (!e.repeat && e.code === 'KeyE') { playSfx('ui'); send('interact'); }
  if (!e.repeat && e.code === 'KeyQ') { playSfx('ui'); send('switchWeapon'); }
  if (!e.repeat && e.code === 'KeyB') { playSfx('ui'); send('build'); }
  if (!e.repeat && ['KeyH','Tab'].includes(e.code)) { playSfx('ui'); toggleHighscore(); }
  const weaponKeys={Digit1:'pistol',Digit2:'smg',Digit3:'shotgun',Digit4:'pulse'};
  if (!e.repeat && weaponKeys[e.code]) { playSfx('ui'); send('switchWeapon',{weapon:weaponKeys[e.code]}); }
  setKey(e.code, true); send();
});
addEventListener('keyup', e => { setKey(e.code, false); send(); });
if (!matchMedia('(pointer: coarse)').matches) canvas.addEventListener('pointerdown', () => send('shoot'));
setInterval(() => send(), 70);

const joystick = document.querySelector('#joystick');
const joystickKnob = document.querySelector('#joystickKnob');
let joystickPointer = null;
function updateJoystick(event) {
  const box=joystick.getBoundingClientRect(),cx=box.left+box.width/2,cy=box.top+box.height/2;
  let dx=event.clientX-cx,dy=event.clientY-cy;
  const radius=box.width*.34,distance=Math.hypot(dx,dy),limited=Math.min(radius,distance);
  if(distance){dx=dx/distance*limited;dy=dy/distance*limited;}
  joystickKnob.style.transform=`translate(${dx}px,${dy}px)`;
  const nx=dx/radius;
  keys.left=nx<-.2;keys.right=nx>.2;keys.shift=Math.abs(nx)>.78;
  keys.jump=dy/radius<-.68;send();
}
function releaseJoystick(event) {
  if(joystickPointer!==null&&event.pointerId!==joystickPointer)return;
  joystickPointer=null;keys.left=false;keys.right=false;keys.shift=false;keys.jump=false;
  joystickKnob.style.transform='translate(0,0)';send();
}
joystick.addEventListener('pointerdown',event=>{event.preventDefault();joystickPointer=event.pointerId;joystick.setPointerCapture(event.pointerId);updateJoystick(event);});
joystick.addEventListener('pointermove',event=>{if(event.pointerId===joystickPointer)updateJoystick(event);});
joystick.addEventListener('pointerup',releaseJoystick);joystick.addEventListener('pointercancel',releaseJoystick);

function actionButton(id,action,holdKey){
  const button=document.querySelector(id);
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('active');if(holdKey){keys[holdKey]=true;send();}else{if(action!=='shoot')playSfx('ui');send(action);}});
  const release=()=>{button.classList.remove('active');if(holdKey){keys[holdKey]=false;send();}};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
}
actionButton('#btnFire','shoot');actionButton('#btnJump',null,'jump');actionButton('#btnAction','interact');actionButton('#btnWeapon','switchWeapon');actionButton('#btnBuild','build');
document.querySelector('#btnScore').addEventListener('pointerdown',event=>{event.preventDefault();playSfx('ui');toggleHighscore();});

const WEAPON_LABELS={pistol:'PISTOLE',smg:'MP',shotgun:'SCHROT',pulse:'IMPULS'};

function updateHud() {
  const me = state.players.find(p => p.id === myId); if (!me) return;
  healthFill.style.width = `${me.health}%`; healthValue.textContent = me.health;
  armorFill.style.width = `${me.armor}%`; armorValue.textContent = me.armor;
  cashEl.textContent = `$${me.cash.toLocaleString('de-CH')}`; lootEl.textContent = me.loot;
  wantedEl.textContent = '★'.repeat(me.wanted) + '☆'.repeat(5 - me.wanted);
  scoreEl.textContent = me.score.toLocaleString('de-CH');
  weaponNameEl.textContent = WEAPON_LABELS[me.activeWeapon] || me.activeWeapon;
  kitsEl.textContent = me.barricadeKits;
  const stageIndex = Math.max(0, Math.min(stages.length - 1, me.currentStage || 0));
  stageNumberEl.textContent = `STAGE ${stageIndex + 1}/${stages.length}`;
  stageNameEl.textContent = stages[stageIndex]?.name || '';
  stageObjectiveEl.textContent = me.stageGoals?.[stageIndex] ? 'Ziel abgeschlossen – weiter nach rechts!' : stages[stageIndex]?.objective || '';
  [...stageDotsEl.children].forEach((dot, index) => {
    dot.classList.toggle('done', Boolean(me.stageGoals?.[index]));
    dot.classList.toggle('current', index === stageIndex);
  });
  if (highscoreOpen) renderHighscores();
  if (me.message !== lastMessage) { messageEl.textContent = me.message; lastMessage = me.message; }
}

function toggleHighscore(){
  highscoreOpen=!highscoreOpen;highscorePanel.classList.toggle('open',highscoreOpen);
  if(highscoreOpen)renderHighscores();
}

function renderHighscores(){
  highscoreList.replaceChildren();
  const rows=state.highscores||[];
  if(!rows.length){const empty=document.createElement('li');empty.className='empty-score';empty.textContent='Noch keine Gegnerpunkte – hol dir Platz 1!';highscoreList.append(empty);return;}
  rows.forEach((row,index)=>{
    const li=document.createElement('li'),rank=document.createElement('span'),name=document.createElement('strong'),points=document.createElement('b');
    rank.textContent=`#${index+1}`;name.textContent=row.name;points.textContent=`${row.score.toLocaleString('de-CH')} PTS`;
    li.append(rank,name,points);highscoreList.append(li);
  });
}

function sx(x) { return x - cameraX; }
function stageIndexAt(x) { return Math.max(0, Math.min(stages.length - 1, Math.floor(x / stageWidth))); }
function rect(x,y,w,h,color) { ctx.fillStyle=color; ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h)); }
function text(value,x,y,size,color='#fff',align='left') { ctx.fillStyle=color;ctx.font=`800 ${size}px Barlow Condensed, sans-serif`;ctx.textAlign=align;ctx.fillText(value,x,y); }

function drawSky(w,h) {
  const stageIndex = stageIndexAt(cameraX + w * .38), stage = stages[stageIndex] || stages[0];
  const image = assets[stage.id] || assets.city;
  if (image.complete && image.naturalWidth) {
    const imageW = h * image.naturalWidth / image.naturalHeight;
    const localCamera = cameraX - stageIndex * stageWidth;
    const offset = -((localCamera * .16) % imageW);
    for (let x = offset - imageW; x < w + imageW; x += imageW) ctx.drawImage(image, x, 0, imageW, h);
    const shade=ctx.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#07101e33');shade.addColorStop(.7,'#09101b11');shade.addColorStop(1,'#07090eaa');ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
    return;
  }
  const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#10172c');g.addColorStop(.62,'#27364b');g.addColorStop(1,'#db7045');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.globalAlpha=.6; rect(w*.76,78,70,70,'#ffcc7b'); ctx.globalAlpha=1;
  const farOffset=-(cameraX*.12)%280;
  for(let x=farOffset-280;x<w+280;x+=280){const bh=130+(Math.abs(x*17)%150);rect(x,h-groundY*0.72-bh,220,bh,'#172236');for(let wy=h-groundY*.72-bh+24;wy<h-groundY*.72-18;wy+=34)for(let wx=x+22;wx<x+205;wx+=42)rect(wx,wy,12,18,(wx+wy)%3?'#42506a':'#f2b85f');}
}

function drawStreet(w,h,baseY) {
  const stage = stageIndexAt(cameraX + w * .38);
  const road = ['#11141b','#2d241b','#2a2830','#121820'][stage] || '#11141b';
  const curb = ['#c7c1ae','#a48258','#d8c5af','#667584'][stage] || '#c7c1ae';
  rect(0,baseY,w,h-baseY,road);rect(0,baseY-18,w,18,curb);rect(0,baseY+92,w,4,stage===3?'#d7ff32':'#343944');
  for(let x=-(cameraX%170);x<w;x+=170)rect(x,baseY+88,90,7,'#d8d095');
  if(stage!==1)for(let x=-(cameraX%520);x<w;x+=520){rect(x,baseY-210,7,192,'#242b37');rect(x-12,baseY-217,31,14,stage===3?'#52e8ff':'#ffd04d');}
}

function drawBuilding(b, baseY) {
  const x=sx(b.x); if(x>canvas.width/scale+100||x+b.w< -100)return;
  const style={
    bank:['#252b39','#d7ff32',255,'[ E ] BANK AUSRAUBEN'],
    barn:['#503421','#ffb052',230,'[ E ] SCHEUNE DURCHSUCHEN'],
    beachbar:['#174754','#ff5e9e',205,'[ E ] KONTAKT TREFFEN'],
    container:['#263746','#ff9b42',220,'[ E ] WARE ÜBERNEHMEN'],
    pub:['#2b1828','#ff386b',220,'[ E ] WARE ABLIEFERN'],
    hideout:['#303344','#43e5ff',210,'[ E ] VERSTECKEN']
  }[b.type]||['#303344','#43e5ff',210,'[ E ] BENUTZEN'];
  const [wall,accent,bh,action]=style;
  rect(x,baseY-bh,b.w,bh-18,wall);rect(x+8,baseY-bh+8,b.w-16,10,accent);
  for(let wx=x+25;wx<x+b.w-30;wx+=68){rect(wx,baseY-bh+48,38,47,'#111722');rect(wx+5,baseY-bh+53,28,37,b.type==='pub'?'#b62b75':'#62708b');}
  if(b.type==='barn'){ctx.fillStyle='#382214';ctx.beginPath();ctx.moveTo(x-12,baseY-bh);ctx.lineTo(x+b.w/2,baseY-bh-70);ctx.lineTo(x+b.w+12,baseY-bh);ctx.closePath();ctx.fill();}
  if(b.type==='container')for(let cy=baseY-bh+30;cy<baseY-28;cy+=28)rect(x+13,cy,b.w-26,4,'#50687a');
  rect(x+b.w/2-43,baseY-99,86,81,'#0c1018');rect(x+b.w/2-35,baseY-91,31,73,'#28334b');rect(x+b.w/2+4,baseY-91,31,73,'#28334b');
  text(b.label,x+b.w/2,baseY-bh+33,b.type==='bank'?26:22,accent,'center');
  text(action,x+b.w/2,baseY-112,15,'#fff','center');
}

function drawVendor(v,baseY){const x=sx(v.x);if(x<-100||x>canvas.width/scale+100)return;rect(x-48,baseY-72,96,55,'#693f27');rect(x-62,baseY-86,124,18,'#d74b5e');rect(x-8,baseY-123,16,37,'#ffce45');text('$',x,baseY-96,23,'#12151c','center');text('[ E ] HANDELN',x,baseY-135,15,'#d7ff32','center');text(v.label,x,baseY-147,12,'#fff','center');}

const RUNNER_BOUNDS=[[98,638],[158,634],[147,627],[93,582],[56,638],[147,638]];
const POLICE_BOUNDS=[[101,592],[134,584],[137,578],[154,586],[126,592],[147,589]];
// Die großen generierten Sprites benötigen gegenüber der 62px-Physikfigur
// einen eigenen visuellen Versatz. Schüsse und Kollisionen bleiben unverändert.
const CHARACTER_GROUND_OFFSET=42;
function spriteFrame(image, frame, x, feetY, height, dir=1, alpha=1) {
  if (!image.complete || !image.naturalWidth) return false;
  const sw=image.naturalWidth/6, bounds=image===assets.runner?RUNNER_BOUNDS[frame]:POLICE_BOUNDS[frame];
  const sy=bounds[0], sh=bounds[1]-bounds[0], dw=height*(sw/sh);
  ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,feetY);if(dir<0)ctx.scale(-1,1);
  ctx.drawImage(image,frame*sw,sy,sw,sh,-dw/2,-height,dw,height);ctx.restore();return true;
}
function runnerFrame(p){if(p.y<groundY-p.height-4)return 4;if(Math.abs(p.vx)>.2)return 1+(Math.floor(performance.now()/115)%3);return 0;}
function drawGroundShadow(x,y,width=30,alpha=.38){
  ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle='#020308';ctx.beginPath();ctx.ellipse(x,y+2,width,6,0,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawPerson(p,baseY,isMe=false,interior=false){
  if(p.hidden&&!interior)return;const x=interior?p.interiorX/1000*(canvas.width/scale):sx(p.x),y=interior?baseY:baseY-(groundY-p.y);if(x<-80||x>canvas.width/scale+80)return;
  const alpha=p.invuln>0&&Math.floor(p.invuln/3)%2 ? .35 : 1;
  const feetY=(interior?baseY:y+p.height)+CHARACTER_GROUND_OFFSET;
  drawGroundShadow(x,baseY+CHARACTER_GROUND_OFFSET,30,p.y < groundY-p.height-4 ? .2 : .42);
  if(!spriteFrame(assets.runner,runnerFrame(p),x,feetY,112,p.dir,alpha)){ctx.save();ctx.translate(x,y);if(p.dir<0)ctx.scale(-1,1);rect(-13,3,26,31,p.color);rect(-16,34,11,27,'#182238');rect(5,34,11,27,'#182238');ctx.restore();}
  text(p.name+(isMe?' · DU':''),x,feetY-120,13,isMe?'#d7ff32':'#fff','center');
  rect(x-25,feetY-113,50,4,'#272b36');rect(x-25,feetY-113,50*(p.health/100),4,'#ff385d');
  if(p.respawn>0)text('ERWISCHT',x,feetY-52,16,'#ff385d','center');
}

function drawCop(c,baseY){const x=sx(c.x),y=baseY-(groundY-c.y);if(x<-80||x>canvas.width/scale+80)return;const frame=c.flash?5:1+(Math.floor(performance.now()/125)%3),feetY=y+c.height+CHARACTER_GROUND_OFFSET;drawGroundShadow(x,baseY+CHARACTER_GROUND_OFFSET,29,.4);if(!spriteFrame(assets.police,frame,x,feetY,108,c.dir))rect(x-13,y+CHARACTER_GROUND_OFFSET,26,58,'#203a63');text('POLIZEI',x,feetY-116,12,'#6bc7ff','center');}
const PROJECTILE_ORDER={pistol:0,smg:1,shotgun:2,pulse:3,police:4};
const PROJECTILE_BOUNDS=[[63,326,358,387],[27,331,375,387],[54,272,339,435],[14,227,435,482],[0,320,346,391]];
const PROJECTILE_WIDTH={pistol:30,smg:40,shotgun:38,pulse:48,police:38};
function drawBullet(b,baseY){
  const x=sx(b.x),y=baseY-(groundY-b.y),index=PROJECTILE_ORDER[b.weapon]??0;
  if(assets.projectiles.complete&&assets.projectiles.naturalWidth){
    const cell=assets.projectiles.naturalWidth/5,bound=PROJECTILE_BOUNDS[index],sw=bound[2]-bound[0],sh=bound[3]-bound[1],dw=PROJECTILE_WIDTH[b.weapon]||30,dh=dw*sh/sw;
    ctx.save();ctx.translate(x,y);if(b.vx<0)ctx.scale(-1,1);ctx.globalCompositeOperation='lighter';ctx.drawImage(assets.projectiles,index*cell+bound[0],bound[1],sw,sh,-dw/2,-dh/2,dw,dh);ctx.restore();
  }else rect(x-5,y-2,10,4,b.police?'#69c8ff':'#d7ff32');
}

function drawArmorPickup(item,baseY){
  if(!item.active)return;const x=sx(item.x),ground=baseY+CHARACTER_GROUND_OFFSET;if(x<-60||x>canvas.width/scale+60)return;
  const bob=Math.sin(performance.now()/260+item.x)*4;
  ctx.save();ctx.translate(x,ground-34+bob);ctx.shadowColor='#43e5ff';ctx.shadowBlur=18;rect(-20,-18,40,36,'#173c5b');ctx.shadowBlur=0;ctx.strokeStyle='#66eaff';ctx.lineWidth=2;ctx.strokeRect(-20,-18,40,36);ctx.fillStyle='#9cf4ff';ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(12,-7);ctx.lineTo(9,8);ctx.lineTo(0,14);ctx.lineTo(-9,8);ctx.lineTo(-12,-7);ctx.closePath();ctx.fill();ctx.restore();text('ARMOR',x,ground-62+bob,12,'#72ebff','center');
}

const ITEM_STYLE={
  cash:{color:'#d7ff32',symbol:'$',glow:'#d7ff32'},
  medkit:{color:'#ff526f',symbol:'+',glow:'#ff385d'},
  kit:{color:'#ffad52',symbol:'⚒',glow:'#ff9b42'},
  contraband:{color:'#b57cff',symbol:'◆',glow:'#a765ff'}
};
function drawStageItem(item,baseY){
  if(!item.active)return;const x=sx(item.x),ground=baseY+CHARACTER_GROUND_OFFSET;if(x<-60||x>canvas.width/scale+60)return;
  const style=ITEM_STYLE[item.type]||ITEM_STYLE.cash,bob=Math.sin(performance.now()/230+item.x)*5;
  ctx.save();ctx.translate(x,ground-34+bob);ctx.shadowColor=style.glow;ctx.shadowBlur=22;rect(-22,-19,44,38,'#111722');ctx.shadowBlur=0;ctx.strokeStyle=style.color;ctx.lineWidth=2;ctx.strokeRect(-22,-19,44,38);text(style.symbol,0,10,27,style.color,'center');ctx.restore();
  text(item.label,x,ground-64+bob,11,style.color,'center');
}

function drawStageGate(index,baseY,me){
  const x=sx(index*stageWidth);if(x<-120||x>canvas.width/scale+120)return;
  const locked=(me?.unlockedStage||0)<index,color=locked?'#ff385d':'#d7ff32';
  ctx.save();ctx.globalAlpha=locked ? .92 : .48;rect(x-52,baseY-245,16,245,'#1b202a');rect(x+36,baseY-245,16,245,'#1b202a');rect(x-52,baseY-245,104,18,color);ctx.restore();
  text(locked?'ZIEL NOCH OFFEN':`STAGE ${index+1}`,x,baseY-260,18,color,'center');
  if(locked){ctx.save();ctx.globalAlpha=.25;rect(x-36,baseY-227,72,227,'#ff385d');ctx.restore();text('✕',x,baseY-120,40,'#ff8ba0','center');}
}

function drawBarricade(wall,baseY){
  const x=sx(wall.x),ground=baseY+CHARACTER_GROUND_OFFSET;if(x<-90||x>canvas.width/scale+90)return;
  drawGroundShadow(x,ground,43,.55);ctx.save();ctx.translate(x,ground);ctx.fillStyle='#161b24';ctx.fillRect(-43,-82,86,82);ctx.strokeStyle='#778398';ctx.lineWidth=3;ctx.strokeRect(-43,-82,86,82);
  for(let y=-72;y<-8;y+=22){ctx.fillStyle=y%44===0?'#3d4656':'#2b3340';ctx.fillRect(-38,y,76,17);ctx.fillStyle='#d7ff32';ctx.fillRect(-34,y+6,9,4);ctx.fillRect(25,y+6,9,4);}ctx.restore();
  rect(x-38,ground-94,76,6,'#242a36');rect(x-38,ground-94,76*(wall.health/wall.maxHealth),6,'#d7ff32');text('BARRIKADE',x,ground-102,11,'#fff','center');
}

function render() {
  const w=canvas.width/scale,h=canvas.height/scale;ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);
  const me=state.players.find(p=>p.id===myId);if(me)cameraX+=(Math.max(0,Math.min(worldWidth-w,me.x-w*.38))-cameraX)*.09;
  // Die sichtbare Gehsteigkante des Hintergrundbildes liegt bei rund 81 %.
  const baseY=Math.min(h-58,Math.max(300,h*.81));
  if(me?.inside){drawBankInterior(w,h,baseY,me);requestAnimationFrame(render);return;}
  drawSky(w,h);drawStreet(w,h,baseY);
  for(let index=1;index<stages.length;index++)drawStageGate(index,baseY,me);
  for(const b of buildings)drawBuilding(b,baseY);for(const v of vendors)drawVendor(v,baseY);
  for(const item of state.armorPickups||[])drawArmorPickup(item,baseY);for(const item of state.stageItems||[])drawStageItem(item,baseY);for(const wall of state.barricades||[])drawBarricade(wall,baseY);
  for(const b of state.bullets)drawBullet(b,baseY);for(const c of state.police)drawCop(c,baseY);for(const p of state.players)drawPerson(p,baseY,p.id===myId);
  const markerSpacing=1000;for(let x=markerSpacing;x<worldWidth;x+=markerSpacing){const px=sx(x);if(px>0&&px<w)text(`${x/1000} KM`,px,baseY+35,12,'#6c7588','center');}
  if(me?.hidden){ctx.fillStyle='#05070bbb';ctx.fillRect(0,0,w,h);text('VERSCHANZT',w/2,h/2-10,48,'#d7ff32','center');text('E DRÜCKEN, UM DAS GEBÄUDE ZU VERLASSEN',w/2,h/2+28,16,'#fff','center');}
  if(noticeTimer>0){noticeTimer--;noticeEl.style.opacity=Math.min(1,noticeTimer/30);}else noticeEl.textContent='';
  if(stageBannerTimer>0){stageBannerTimer--;if(stageBannerTimer===0)stageBanner.classList.remove('show');}
  requestAnimationFrame(render);
}
function drawBankInterior(w,h,baseY,me){
  if(assets.bank.complete&&assets.bank.naturalWidth)ctx.drawImage(assets.bank,0,0,w,h);else{rect(0,0,w,h,'#121725');text('BANK',w/2,80,52,'#d9b463','center');}
  const floorY=h*.84;rect(0,floorY,w,h-floorY,'#080b10aa');
  const bankPlayers=state.players.filter(p=>p.inside===me.inside);for(const p of bankPlayers)drawPerson(p,floorY,p.id===myId,true);
  const leftX=w*.1,rightX=w*.86;
  ctx.fillStyle='#05070dcc';ctx.fillRect(18,floorY-164,178,108);ctx.strokeStyle='#43e5ff';ctx.strokeRect(18,floorY-164,178,108);
  text('AUSGANG',leftX,floorY-125,25,'#43e5ff','center');text('E DRÜCKEN',leftX,floorY-91,15,'#fff','center');
  ctx.fillStyle='#05070dcc';ctx.fillRect(w-214,floorY-164,196,108);ctx.strokeStyle='#d7ff32';ctx.strokeRect(w-214,floorY-164,196,108);
  text(me.bankLooted?'TRESOR LEER':'TRESOR',rightX,floorY-125,25,me.bankLooted?'#ff385d':'#d7ff32','center');text('E DRÜCKEN',rightX,floorY-91,15,'#fff','center');
  const marker=me.interiorX<220?leftX:me.interiorX>760?rightX:null;if(marker){text('▼',marker,floorY-180,25,'#fff','center');}
  if(noticeTimer>0){noticeTimer--;noticeEl.style.opacity=Math.min(1,noticeTimer/30);}else noticeEl.textContent='';
}
render();

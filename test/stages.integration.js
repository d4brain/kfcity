'use strict';

const WebSocket = require('ws');
const socket = new WebSocket('ws://127.0.0.1:31404');
const unlocked = new Set();
let playerId = null, latestPlayer = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (action, extra = {}) => socket.send(JSON.stringify({ type: 'input', keys: {}, action, ...extra }));
const position = async (x, interiorX) => { send('testPosition', { x, interiorX }); await delay(80); };
const interact = async () => { send('interact'); await delay(650); };

socket.on('message', raw => {
  const message = JSON.parse(raw);
  if (message.type === 'joined') playerId = message.id;
  if (message.type === 'stageUnlocked') unlocked.add(message.completed);
  if (message.type === 'state') latestPlayer = message.players.find(player => player.id === playerId) || latestPlayer;
});

async function run() {
  await new Promise((resolve, reject) => {
    socket.once('open', resolve); socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'join', name: 'StageTest' }));
  while (!playerId) await delay(20);

  await position(1515); await interact();
  await position(1515, 850); await interact();
  await position(1515, 120); await interact();
  await position(7265); await interact();
  await position(13815); await interact();
  await position(17620); await interact();
  await position(19515); await interact();
  await delay(150);

  if ([0, 1, 2, 3].some(index => !unlocked.has(index))) throw new Error(`Freischaltungen fehlen: ${[...unlocked]}`);
  if (!latestPlayer?.stageGoals?.every(Boolean)) throw new Error('Nicht alle Stage-Ziele wurden bestätigt.');
  if (latestPlayer.harborPackage) throw new Error('Hafenlieferung wurde nicht abgeschlossen.');
  console.log('Alle vier Stage-Ziele und Übergänge bestätigt.');
  socket.close();
}

run().catch(error => { console.error(error.message); socket.close(); process.exitCode = 1; });

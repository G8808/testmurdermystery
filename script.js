const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

const taskZones = [
  { id: 'fix-wires', x: 100, y: 120, label: 'Fix Wiring' },
  { id: 'reboot-main', x: 580, y: 100, label: 'Reboot Main' },
  { id: 'download-data', x: 320, y: 420, label: 'Download Data' }
];

const moveSpeed = 4;
const playerSize = 36;

const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');
const displayNameInput = document.getElementById('displayNameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const joinMessage = document.getElementById('joinMessage');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const statusText = document.getElementById('statusText');
const startGameButton = document.getElementById('startGameButton');
const leaveRoomButton = document.getElementById('leaveRoomButton');
const playersList = document.getElementById('playersList');
const taskPanel = document.getElementById('taskPanel');
const mapArea = document.getElementById('mapArea');
const messageBox = document.getElementById('messageBox');

let playerId = null;
let roomCode = null;
let roomRef = null;
let playerRef = null;
let currentRoomData = null;
let movement = { up: false, down: false, left: false, right: false };
let canSendUpdates = false;

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function displayMessage(message, isError = false) {
  messageBox.textContent = message;
  messageBox.style.color = isError ? '#ff6b6b' : '#75c6ff';
}

function showJoinMessage(message, isError = false) {
  joinMessage.textContent = message;
  joinMessage.style.color = isError ? '#ff6b6b' : '#75c6ff';
}

function createRoom() {
  const name = displayNameInput.value.trim() || 'Player';
  roomCode = generateRoomCode();
  setupRoom(roomCode, name, true);
}

function joinRoom() {
  const name = displayNameInput.value.trim() || 'Player';
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showJoinMessage('Enter a room code to join.', true);
    return;
  }
  roomCode = code;
  setupRoom(roomCode, name, false);
}

function setupRoom(code, name, isCreator) {
  displayNameInput.value = name;
  roomCodeInput.value = code;
  joinMessage.textContent = '';

  roomRef = database.ref(`rooms/${code}`);
  roomRef.once('value').then(snapshot => {
    if (!snapshot.exists() && !isCreator) {
      showJoinMessage('Room not found. Try creating a new one.', true);
      return;
    }

    if (!snapshot.exists()) {
      const initialRoom = {
        createdAt: Date.now(),
        game: {
          state: 'waiting',
          murdererId: null,
          winner: null,
          startedAt: null,
          taskZones: taskZones,
          taskCount: taskZones.length
        }
      };
      roomRef.set(initialRoom);
    }

    enterRoom(name);
  }).catch(error => {
    showJoinMessage(`Firebase error: ${error.message}`, true);
  });
}

function enterRoom(name) {
  playerId = crypto.randomUUID?.() || `player-${Math.floor(Math.random() * 100000)}`;
  playerRef = roomRef.child(`players/${playerId}`);
  const spawnX = 100 + Math.random() * 420;
  const spawnY = 100 + Math.random() * 320;

  const initialTasks = taskZones.reduce((acc, task) => {
    acc[task.id] = false;
    return acc;
  }, {});

  const playerData = {
    name,
    x: spawnX,
    y: spawnY,
    role: 'pending',
    alive: true,
    joinedAt: Date.now(),
    taskStatus: initialTasks,
    completedTasks: 0
  };

  playerRef.set(playerData);
  playerRef.onDisconnect().remove();

  roomCodeDisplay.textContent = roomCode;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  displayMessage('Connected. Waiting for game state updates.');

  roomRef.on('value', snapshot => {
    const value = snapshot.val();
    if (!value) {
      leaveRoom();
      return;
    }
    currentRoomData = value;
    refreshGameUI();
  });

  startMovementLoop();
}

function refreshGameUI() {
  const game = currentRoomData.game || {};
  const players = currentRoomData.players || {};
  const me = players[playerId];

  roomCodeDisplay.textContent = roomCode;
  statusText.textContent = game.state === 'started' ? 'Game in progress' : game.state === 'finished' ? `Game over: ${game.winner}` : 'Waiting for players';
  startGameButton.disabled = game.state !== 'waiting' || Object.keys(players).length < 3;
  startGameButton.textContent = game.state === 'waiting' ? 'Start Game' : 'Game Started';

  renderPlayers(players, game);
  renderTasks(players, game);
  renderMap(players, game);

  if (game.state === 'started' && me?.alive === false) {
    displayMessage('You were eliminated. Watch the game.', true);
  }
  if (game.state === 'finished') {
    if (game.winner === 'Innocents') {
      displayMessage('Innocents won! All tasks are complete.');
    } else if (game.winner === 'Murderer') {
      displayMessage('Murderer won! All innocents are eliminated.', true);
    }
  }
}

function renderPlayers(players, game) {
  playersList.innerHTML = '';
  const sortedPlayers = Object.entries(players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const myPlayer = players[playerId];

  sortedPlayers.forEach(([id, player]) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    const name = document.createElement('span');
    name.textContent = player.name || 'Player';
    card.appendChild(name);

    const role = document.createElement('span');
    role.className = 'player-role';
    if (game.state === 'started' || game.state === 'finished') {
      role.textContent = `${player.role}${player.alive ? '' : ' (dead)'}`;
    } else {
      role.textContent = player.alive ? 'Waiting' : 'Left';
    }
    card.appendChild(role);

    const tasksComplete = document.createElement('span');
    tasksComplete.textContent = `Tasks: ${player.completedTasks || 0}/${taskZones.length}`;
    card.appendChild(tasksComplete);

    if (game.state === 'started' && myPlayer?.role === 'murderer' && id !== playerId && player.alive && player.alive !== false) {
      const distance = computeDistance(myPlayer, player);
      const killButton = document.createElement('button');
      killButton.textContent = `Kill (${Math.round(distance)}px)`;
      killButton.disabled = distance > 80 || !myPlayer.alive;
      killButton.addEventListener('click', () => attemptKill(id));
      card.appendChild(killButton);
    }

    playersList.appendChild(card);
  });
}

function renderTasks(players, game) {
  taskPanel.innerHTML = '';
  const me = players[playerId];
  if (!me) return;

  if (game.state === 'started' && me.role === 'innocent' && me.alive) {
    taskZones.forEach(task => {
      const completed = me.taskStatus?.[task.id] === true;
      const item = document.createElement('div');
      item.className = `task-item ${completed ? 'completed' : ''}`;
      item.innerHTML = `<span>${task.label}</span>`;

      if (completed) {
        const badge = document.createElement('span');
        badge.textContent = 'Done';
        badge.style.color = '#67e2a5';
        item.appendChild(badge);
      } else {
        const completeButton = document.createElement('button');
        completeButton.textContent = 'Complete';
        completeButton.disabled = !isNearTask(me, task);
        completeButton.addEventListener('click', () => completeTask(task.id));
        item.appendChild(completeButton);
      }

      taskPanel.appendChild(item);
    });
  } else {
    const info = document.createElement('div');
    info.textContent = game.state === 'waiting' ? 'Start the game to begin tasks.' : 'Tasks are only available for alive innocents.';
    taskPanel.appendChild(info);
  }
}

function renderMap(players, game) {
  mapArea.innerHTML = '';
  taskZones.forEach(task => {
    const zone = document.createElement('div');
    zone.className = 'task-zone';
    zone.style.left = `${task.x}px`;
    zone.style.top = `${task.y}px`;
    zone.innerHTML = `<span>${task.label}</span>`;
    mapArea.appendChild(zone);
  });

  Object.entries(players).forEach(([id, player]) => {
    const marker = document.createElement('div');
    marker.className = `player-marker ${player.alive ? 'alive' : 'dead'} ${id === playerId ? 'current' : ''}`;
    marker.style.left = `${player.x}px`;
    marker.style.top = `${player.y}px`;

    const label = document.createElement('div');
    label.className = 'player-name';
    label.textContent = player.name || 'Player';
    marker.appendChild(label);

    mapArea.appendChild(marker);
  });
}

function isNearTask(player, task) {
  const distance = Math.hypot(player.x - task.x, player.y - task.y);
  return distance < 80;
}

function completeTask(taskId) {
  const me = currentRoomData.players?.[playerId];
  if (!me || !me.alive || me.role !== 'innocent') return;
  if (me.taskStatus?.[taskId]) return;

  const update = {};
  update[`taskStatus/${taskId}`] = true;
  update.completedTasks = (me.completedTasks || 0) + 1;
  playerRef.update(update);
  displayMessage(`Task completed: ${taskId}`);
  updateGameOutcome();
}

function attemptKill(targetId) {
  const players = currentRoomData.players || {};
  const me = players[playerId];
  const target = players[targetId];
  if (!me || !target || me.role !== 'murderer' || !me.alive || !target.alive) {
    return;
  }
  const distance = computeDistance(me, target);
  if (distance > 80) {
    displayMessage('Move closer to kill your target.', true);
    return;
  }

  const updates = {};
  updates[`players/${targetId}/alive`] = false;
  roomRef.child('game').update({ lastKillAt: Date.now() });
  roomRef.update(updates);
  displayMessage(`You eliminated ${target.name}!`, true);
  setTimeout(updateGameOutcome, 300);
}

function computeDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateGameOutcome() {
  const game = currentRoomData.game || {};
  const players = currentRoomData.players || {};
  if (game.state !== 'started') return;

  const alivePlayers = Object.values(players).filter(p => p.alive);
  const aliveInnocents = alivePlayers.filter(p => p.role === 'innocent');
  const murdererAlive = alivePlayers.some(p => p.role === 'murderer');
  const allInnocentsDone = aliveInnocents.length > 0 && aliveInnocents.every(p => taskZones.every(task => p.taskStatus?.[task.id]));

  if (!murdererAlive) {
    roomRef.child('game').update({ state: 'finished', winner: 'Innocents' });
    return;
  }

  if (aliveInnocents.length === 0) {
    roomRef.child('game').update({ state: 'finished', winner: 'Murderer' });
    return;
  }

  if (allInnocentsDone) {
    roomRef.child('game').update({ state: 'finished', winner: 'Innocents' });
  }
}

function startGame() {
  const players = currentRoomData.players || {};
  const aliveIds = Object.entries(players)
    .filter(([_, player]) => player.alive)
    .map(([id]) => id);

  if (aliveIds.length < 3) {
    displayMessage('At least 3 players are needed to start.', true);
    return;
  }

  const murdererIndex = Math.floor(Math.random() * aliveIds.length);
  const murdererId = aliveIds[murdererIndex];
  const updates = {};

  aliveIds.forEach(id => {
    updates[`players/${id}/role`] = id === murdererId ? 'murderer' : 'innocent';
  });

  roomRef.child('game').update({
    state: 'started',
    murdererId,
    startedAt: Date.now(),
    winner: null
  });
  roomRef.update(updates);
  displayMessage('Game started! Find your role and move to complete tasks.', false);
}

function startMovementLoop() {
  if (canSendUpdates) return;
  canSendUpdates = true;
  setInterval(() => {
    const me = currentRoomData?.players?.[playerId];
    if (!me || !me.alive || currentRoomData?.game?.state !== 'started') return;

    let x = me.x;
    let y = me.y;
    if (movement.up) y -= moveSpeed;
    if (movement.down) y += moveSpeed;
    if (movement.left) x -= moveSpeed;
    if (movement.right) x += moveSpeed;

    x = Math.max(20, Math.min(700, x));
    y = Math.max(20, Math.min(500, y));

    if (x !== me.x || y !== me.y) {
      playerRef.update({ x, y });
    }
  }, 60);
}

function leaveRoom() {
  if (playerRef) {
    playerRef.remove();
  }
  if (roomRef) {
    roomRef.off();
  }
  currentRoomData = null;
  playerId = null;
  roomRef = null;
  playerRef = null;
  joinScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  showJoinMessage('You left the room. Create or join again.');
}

document.getElementById('createRoomButton').addEventListener('click', createRoom);
document.getElementById('joinRoomButton').addEventListener('click', joinRoom);
startGameButton.addEventListener('click', startGame);
leaveRoomButton.addEventListener('click', leaveRoom);

window.addEventListener('keydown', event => {
  if (!currentRoomData?.game || currentRoomData.game.state !== 'started') return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key === 'w') movement.up = true;
    if (event.key === 'ArrowDown' || event.key === 's') movement.down = true;
    if (event.key === 'ArrowLeft' || event.key === 'a') movement.left = true;
    if (event.key === 'ArrowRight' || event.key === 'd') movement.right = true;
  }
});

window.addEventListener('keyup', event => {
  if (event.key === 'ArrowUp' || event.key === 'w') movement.up = false;
  if (event.key === 'ArrowDown' || event.key === 's') movement.down = false;
  if (event.key === 'ArrowLeft' || event.key === 'a') movement.left = false;
  if (event.key === 'ArrowRight' || event.key === 'd') movement.right = false;
});

window.addEventListener('beforeunload', () => {
  if (playerRef) {
    playerRef.remove();
  }
});

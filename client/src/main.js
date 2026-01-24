import './style.css';
import {io} from 'socket.io-client';
import {Renderer} from './Renderer.js';
import {Input} from './Input.js';

// Determine server URL (localhost for dev, same origin for production)
const serverUrl = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : window.location.origin;

const socket = io(serverUrl);

// DOM Elements
const lobbyEl = document.getElementById('lobby');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinCodeInput = document.getElementById('joinCode');
const lobbyError = document.getElementById('lobbyError');
const lobbyStatus = document.getElementById('lobbyStatus');
const roomInfoEl = document.getElementById('roomInfo');
const roomCodeEl = document.getElementById('roomCode');
const playerCountEl = document.getElementById('playerCount');
const leaveBtn = document.getElementById('leaveBtn');
const canvas = document.getElementById('game');

// Game state
let renderer = null;
let input = null;
let gameState = {players: [], baseResources: {spareParts: 0, fuel: 0}, respawnCost: 50};
let myId = null;
let currentRoom = null;
let isHost = false;
let gameLoopRunning = false;
let pendingMapData = null; // Store map data if it arrives before renderer is ready

// ============================================
// LOBBY FUNCTIONS
// ============================================

function showError(msg) {
  lobbyError.textContent = msg;
  lobbyStatus.textContent = '';
}

function showStatus(msg) {
  lobbyStatus.textContent = msg;
  lobbyError.textContent = '';
}

function clearMessages() {
  lobbyError.textContent = '';
  lobbyStatus.textContent = '';
}

function enterGame(roomCode, host) {
  currentRoom = roomCode;
  isHost = host;

  // Hide lobby, show game
  lobbyEl.classList.add('hidden');
  roomInfoEl.classList.remove('hidden');
  canvas.classList.remove('hidden');

  // Update room info
  roomCodeEl.textContent = roomCode;
  updatePlayerCount(1);

  // Initialize renderer and input if not already done
  if (!renderer) {
    renderer = new Renderer(canvas);
    input = new Input(socket, canvas);

    // Apply pending map data if it arrived before renderer was ready
    if (pendingMapData) {
      renderer.setTerrain(pendingMapData);
      pendingMapData = null;
    }
  }

  // Start game loop if not running
  if (!gameLoopRunning) {
    gameLoopRunning = true;
    gameLoop();
  }
}

function exitGame() {
  currentRoom = null;
  isHost = false;
  pendingMapData = null;

  // Reset game state
  gameState = {players: [], baseResources: {spareParts: 0, fuel: 0}, respawnCost: 50};

  // Show lobby, hide game
  lobbyEl.classList.remove('hidden');
  roomInfoEl.classList.add('hidden');
  canvas.classList.add('hidden');

  clearMessages();
}

function updatePlayerCount(count) {
  playerCountEl.textContent = `${count} player${count !== 1 ? 's' : ''}`;
}

// ============================================
// EVENT LISTENERS - LOBBY
// ============================================

createBtn.addEventListener('click', () => {
  createBtn.disabled = true;
  joinBtn.disabled = true;
  showStatus('Creating game...');

  socket.emit('createRoom', (response) => {
    createBtn.disabled = false;
    joinBtn.disabled = false;

    if (response.success) {
      console.log('Room created:', response.code);
    } else {
      showError(response.error || 'Failed to create room');
    }
  });
});

joinBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showError('Please enter a valid 6-character room code');
    return;
  }

  createBtn.disabled = true;
  joinBtn.disabled = true;
  showStatus('Joining game...');

  socket.emit('joinRoom', { code }, (response) => {
    createBtn.disabled = false;
    joinBtn.disabled = false;

    if (response.success) {
      console.log('Joined room:', response.code);
      updatePlayerCount(response.playerCount);
    } else {
      showError(response.error || 'Failed to join room');
    }
  });
});

// Allow Enter key to join
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    joinBtn.click();
  }
});

// Auto-uppercase input
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase();
});

leaveBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
});

// ============================================
// SOCKET EVENTS
// ============================================

socket.on('connect', () => {
  console.log('Connected to server');
  myId = socket.id;
  clearMessages();
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  if (currentRoom) {
    exitGame();
    showError('Disconnected from server');
  }
});

socket.on('connected', (data) => {
  myId = data.id;
});

socket.on('joinedRoom', (data) => {
  enterGame(data.code, data.isHost);
});

socket.on('leftRoom', () => {
  exitGame();
});

socket.on('playerJoined', (data) => {
  console.log('Player joined:', data.playerId);
  updatePlayerCount(data.playerCount);
});

socket.on('playerLeft', (data) => {
  console.log('Player left:', data.playerId);
  updatePlayerCount(data.playerCount);
});

socket.on('hostChanged', (data) => {
  console.log('Host changed to:', data.newHostId);
  isHost = (data.newHostId === myId);
});

socket.on('mapData', (mapData) => {
  if (renderer) {
    renderer.setTerrain(mapData);
  } else {
    // Store for later if renderer isn't ready yet
    pendingMapData = mapData;
  }
});

socket.on('tileUpdate', ({x, y, value}) => {
  if (renderer) {
    renderer.updateTile(x, y, value);
  }
});

socket.on('gameState', (state) => {
  gameState = state;
});

socket.on('respawnResult', (result) => {
  if (!result.success) {
    console.log('Respawn failed:', result.reason);
    if (result.reason === 'no_resources' && renderer) {
      renderer.showMessage(`Not enough spare parts! Need ${result.required}, have ${result.available}`);
    }
  }
});

// ============================================
// GAME INPUT
// ============================================

// Handle respawn key press
window.addEventListener('keydown', (e) => {
  if (!currentRoom) return;

  if (e.key === 'r' || e.key === 'R') {
    const myPlayer = gameState.players.find(p => p.id === myId);
    if (myPlayer && myPlayer.dead) {
      socket.emit('respawn');
    }
  }
});

// ============================================
// GAME LOOP
// ============================================

function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (currentRoom && renderer) {
    renderer.draw(gameState, myId);

    // Update spotlight angle for input
    if (input) {
      const myPlayer = gameState.players.find(p => p.id === myId);
      if (myPlayer && !myPlayer.dead) {
        input.updateSpotlight(myPlayer.x, myPlayer.y, renderer.cameraX, renderer.cameraY);
      }
    }
  }
}

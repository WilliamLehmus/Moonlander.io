import './style.css';
import {io} from 'socket.io-client';
import {Renderer} from './Renderer.js';
import {Input} from './Input.js';
import {SoundManager} from './SoundManager.js';

// Determine server URL (localhost for dev, same origin for production)
const serverUrl = import.meta.env.VITE_SERVER_URL || (window.location.hostname === 'localhost'
  ? 'http://localhost:3010'
  : window.location.origin);

const socket=io(serverUrl);

// Handle Drop on World (outside inventory grids)
document.addEventListener('dragover', (e) => {
  e.preventDefault(); // Allow dropping
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  // Check if dropping on a valid drop zone
  // If e.target is NOT inside an inventory container, then it's a world drop
  if (e.target.closest('.inventory-grid')) {
    return; // Handled by standard drag drop if we had it, or ignored
  }

  try {
    const data=JSON.parse(e.dataTransfer.getData('text/plain'));
    if (data&&data.type==='inventory_drag'&&data.location==='ship') {
      // Drop to world
      socket.emit('dropItem', {slotIndex: data.index});
    }
  } catch (err) {
    // Not JSON or irrelevant
  }
});

// DOM Elements
const lobbyEl=document.getElementById('lobby');
const createBtn=document.getElementById('createBtn');
const joinBtn=document.getElementById('joinBtn');
const joinCodeInput=document.getElementById('joinCode');
const lobbyError=document.getElementById('lobbyError');
const lobbyStatus=document.getElementById('lobbyStatus');
const roomInfoEl=document.getElementById('roomInfo');
const roomCodeEl=document.getElementById('roomCode');
const playerCountEl=document.getElementById('playerCount');
const leaveBtn=document.getElementById('leaveBtn');
const nicknameInput=document.getElementById('nickname');
const canvas=document.getElementById('game');

// Restore nickname from local storage
const savedNickname=localStorage.getItem('moonlander_nickname');
if (savedNickname) {
  nicknameInput.value=savedNickname;
}

// Escape Menu Elements
const escapeMenuEl=document.getElementById('escapeMenu');
const masterVolumeInput=document.getElementById('masterVolume');
const musicVolumeInput=document.getElementById('musicVolume');
const sfxVolumeInput=document.getElementById('sfxVolume');
const notificationVolumeInput=document.getElementById('notificationVolume');
const resumeBtn=document.getElementById('resumeBtn');
const quitBtn=document.getElementById('quitBtn');
const stationMenuEl=document.getElementById('stationMenu');
const closeStationBtn=document.getElementById('closeStationBtn');
const shipListEl=document.getElementById('shipList');
const buildingListEl=document.getElementById('buildingList');
const hangarStatusEl=document.getElementById('hangarStatus');
const tabBtns=document.querySelectorAll('.tab-btn');
const stationTabs=document.querySelectorAll('.station-tab');

// Debug Menu Elements
const debugMenuEl=document.getElementById('debugMenu');
const closeDebugBtn=document.getElementById('closeDebugBtn');
let debugMenuOpen=false;
let infiniteFuelEnabled=false;

// DOM Quickbar Elements
const domQuickbarEl=document.getElementById('domQuickbar');
let quickbarSlots=[];
function initQuickbar() {
  domQuickbarEl.innerHTML='';
  quickbarSlots=[];
  for (let i=0; i<9; i++) {
    const slot=document.createElement('div');
    slot.className='quickbar-slot';
    slot.dataset.index=i;

    const num=document.createElement('div');
    num.className='slot-number';
    num.textContent=i+1;
    slot.appendChild(num);

    // Drag and Drop
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });

    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      try {
        const data=JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data&&data.type==='inventory_drag') {
          // If from ship, reorder
          if (data.location==='ship') {
            socket.emit('moveItem', {fromIndex: data.index, toIndex: i});
          } else if (data.location==='station') {
            // Move from station to ship at specific slot?
            // Server transferInventory doesn't support specific slot yet.
            // We can just trigger the standard transfer which adds to first empty.
            // But for now, let's just do reorder within ship.
            const stationOres=gameState.baseResources?.ores||{};
            const items=Object.entries(stationOres).filter(o => o[1]>0);
            const item=items[data.index];
            if (item) {
              socket.emit('transferInventory', {from: 'station', to: 'ship', oreType: item[0].toUpperCase()+'_ORE'});
            }
          }
        }
      } catch (err) { }
    });

    slot.addEventListener('click', () => {
      if (input) input.selectQuickbarSlot(i);
    });

    domQuickbarEl.appendChild(slot);
    quickbarSlots.push(slot);
  }
}

function getOreColor(type) {
  if (typeof type==='string'&&(type.startsWith('cable_spool_')||type.startsWith('cable_'))) {
    if (type.includes('power')||type==='cable_red') return '#ff4444';
    if (type.includes('fuel')||type==='cable_green') return '#44ff44';
    if (type.includes('data')||type==='cable_blue') return '#4444ff';
    return '#888';
  }

  const colors={
    'IRON_ORE': '#cd853f',
    'COPPER_ORE': '#daa520',
    'BITITE': '#4a4a4a',
    'SILVER_ORE': '#c0c0c0',
    'TITANIUM_ORE': '#b0c4de',
    'GOLD_ORE': '#ffd700',
    'PLATINUM_ORE': '#e5e4e2',
    'DIAMOND': '#b9f2ff',
    'HELIUM3': '#7fffd4',
    'BASIC': '#8b8b6b',
    'INDUSTRIAL': '#7090a0',
    'ADVANCED': '#daa520',
    'QUANTUM': '#ff69b4',
    'FUEL': '#33ff33'
  };
  return colors[type]||'#888';
}

function renderQuickbar(player) {
  if (!player) {
    domQuickbarEl.classList.add('hidden');
    return;
  }
  domQuickbarEl.classList.remove('hidden');

  const cargo=player.cargo||[];
  const selectedIndex=input? input.quickbarSelection:null;

  quickbarSlots.forEach((slot, i) => {
    // Selection state
    if (selectedIndex===i) {
      slot.classList.add('selected');
    } else {
      slot.classList.remove('selected');
    }

    // Item content
    const item=cargo[i];
    // Clear previous item info (leaving slot number)
    const icon=slot.querySelector('.item-icon');
    const amount=slot.querySelector('.item-amount');
    if (icon) icon.remove();
    if (amount) amount.remove();

    if (item) {
      // Draw icon
      if (typeof item.type==='string'&&(item.type.startsWith('cable_spool_')||item.type.startsWith('cable_'))) {
        const img=document.createElement('img');
        img.className='item-icon';
        let spriteName='cable_red.png';
        if (item.type.includes('power')||item.type==='cable_red') spriteName='cable_red.png';
        else if (item.type.includes('fuel')||item.type==='cable_green') spriteName='cable_green.png';
        else if (item.type.includes('data')||item.type==='cable_blue') spriteName='cable_blue.png';
        img.src='/sprites/'+spriteName;
        slot.appendChild(img);
      } else {
        const div=document.createElement('div');
        div.className='item-icon';

        // Resolve sprite from sheets
        const oreMap={
          'IRON_ORE': 0, 'COPPER_ORE': 1, 'BITITE': 2, 'SILVER_ORE': 3,
          'TITANIUM_ORE': 4, 'GOLD_ORE': 5, 'PLATINUM_ORE': 6, 'DIAMOND': 7, 'HELIUM3': 8
        };
        const matMap={
          'BASIC': 0, 'INDUSTRIAL': 1, 'ADVANCED': 2, 'QUANTUM': 3, 'FUEL': 4
        };

        if (oreMap[item.type]!==undefined) {
          div.style.backgroundImage="url('/sprites/ores_spritesheet.png')";
          div.style.backgroundSize="288px 32px";
          div.style.backgroundPosition=`-${oreMap[item.type]*32}px 0px`;
          div.style.backgroundRepeat="no-repeat";
          div.style.imageRendering="pixelated";
        } else if (matMap[item.type]!==undefined) {
          div.style.backgroundImage="url('/sprites/materials_spritesheet.png')";
          div.style.backgroundSize="160px 32px";
          div.style.backgroundPosition=`-${matMap[item.type]*32}px 0px`;
          div.style.backgroundRepeat="no-repeat";
          div.style.imageRendering="pixelated";
        } else {
          div.style.backgroundColor=getOreColor(item.type);
          div.style.borderRadius='4px';
        }
        slot.appendChild(div);
      }

      const amt=document.createElement('div');
      amt.className='item-amount';
      amt.textContent=item.amount;
      slot.appendChild(amt);
    }
  });
}

// Inventory Menu Elements
const inventoryMenuEl=document.getElementById('inventoryMenu');
const shipInventoryEl=document.getElementById('shipInventory');
const stationInventoryEl=document.getElementById('stationInventory');
const nearbyInventoryEl=document.getElementById('nearbyInventory');
const stationInventorySection=document.getElementById('stationInventorySection');
const closeInventoryBtn=document.getElementById('closeInventoryBtn');
const transferToStationBtn=document.getElementById('transferToStation');
const transferToShipBtn=document.getElementById('transferToShip');
let inventoryMenuOpen=false;
let selectedShipSlot=null;
let selectedStationSlot=null;

// Add Music Volume slider logic
// Wait, I didn't add the music volume slider to HTML yet. I should update HTML first or just assume it's there.
// I will update HTML in next step. For now let's stick to what we have in HTML: master and sfx.

// Game state
let renderer=null;
let input=null;
let soundManager=new SoundManager(); // Initialize globally so we can set volume anytime
let gameState={players: [], baseResources: {spareParts: 0, fuel: 0}, respawnCost: 50};
let myId=null;
let currentRoom=null;
let isHost=false;
let gameLoopRunning=false;
let pendingMapData=null; // Store map data if it arrives before renderer is ready
let isMenuOpen=false;
let isChatOpen=false;
let chatMessages=[]; // Store recent chat messages
let lastPower=100;
let wasDead=false;
let lastFuel=500; // Track fuel for out of fuel sound
let wasOnPad=false; // Track landing pad state for auto-open station menu

// Initialize audio on first user interaction
document.addEventListener('click', () => {
  if (!soundManager.soundsLoaded) {
    soundManager.loadSounds().then(() => {
      if (!currentRoom) {
        soundManager.playMenuMusic();
      }
    });
  }
}, {once: true});

// Listen for notifications
window.addEventListener('notification', (e) => {
  if (renderer) renderer.showMessage(e.detail.message);
});



// ============================================
// LOBBY FUNCTIONS
// ============================================

function showError(msg) {
  lobbyError.textContent=msg;
  lobbyStatus.textContent='';
}

function showStatus(msg) {
  lobbyStatus.textContent=msg;
  lobbyError.textContent='';
}

function clearMessages() {
  lobbyError.textContent='';
  lobbyStatus.textContent='';
}

async function enterGame(roomCode, host) {
  currentRoom=roomCode;
  isHost=host;

  // Ensure sounds are loaded and play game music
  if (!soundManager.soundsLoaded) {
    soundManager.loadSounds().then(() => {
      soundManager.playGameMusic();
    });
  } else {
    soundManager.playGameMusic();
  }

  // Initialize quickbar
  initQuickbar();

  // Hide lobby, show game
  lobbyEl.classList.add('hidden');
  roomInfoEl.classList.remove('hidden');
  canvas.classList.remove('hidden');

  // Update room info
  roomCodeEl.textContent=roomCode;
  updatePlayerCount(1);

  // Initialize renderer and input if not already done
  if (!renderer) {
    renderer=new Renderer(canvas, soundManager);
    input=new Input(socket, canvas);

    // Apply pending map data if it arrived before renderer was ready
    if (pendingMapData) {
      renderer.setTerrain(pendingMapData);
      pendingMapData=null;
    }
  }

  // Initialize quickbar
  initQuickbar();

  // Start game loop if not running
  if (!gameLoopRunning) {
    gameLoopRunning=true;
    gameLoop();
  }

  // Handle dev-only visibility for settings
  const isLocal=window.location.hostname==='localhost';
  const debugTabBtn=document.getElementById('settingsDebugTabBtn');
  if (debugTabBtn) {
    debugTabBtn.style.display=isLocal? 'block':'none';
  }
}

function exitGame() {
  currentRoom=null;
  isHost=false;
  pendingMapData=null;

  soundManager.playMenuMusic();

  // Reset game state
  gameState={players: [], baseResources: {spareParts: 0, fuel: 0}, respawnCost: 50};

  // Show lobby, hide game
  lobbyEl.classList.remove('hidden');
  roomInfoEl.classList.add('hidden');
  canvas.classList.add('hidden');

  // Hide menu if open
  escapeMenuEl.classList.add('hidden');
  isMenuOpen=false;

  // Hide quickbar
  domQuickbarEl.classList.add('hidden');

  clearMessages();
}

function updatePlayerCount(count) {
  playerCountEl.textContent=`${count} player${count!==1? 's':''}`;
}

function toggleMenu() {
  isMenuOpen=!isMenuOpen;
  if (isMenuOpen) {
    if (resumeBtn) resumeBtn.style.display='block';
    if (quitBtn) quitBtn.style.display='block';
    escapeMenuEl.classList.remove('hidden');
    soundManager.playSound('menu_pop');
  } else {
    escapeMenuEl.classList.add('hidden');
    soundManager.playSound('menu_pop');
  }
}

// Settings tabs switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Deactivate all
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(t => t.classList.add('hidden'));

    // Activate selected
    btn.classList.add('active');
    const tabId=`settings-tab-${btn.dataset.settingsTab}`;
    document.getElementById(tabId).classList.remove('hidden');
    soundManager.playSound('menu_pop');
  });
});

// ============================================
// EVENT LISTENERS - LOBBY
// ============================================

createBtn.addEventListener('click', () => {
  createBtn.disabled=true;
  joinBtn.disabled=true;
  showStatus('Creating game...');

  const nickname=nicknameInput.value.trim()||'Explorer';
  localStorage.setItem('moonlander_nickname', nickname);
  socket.emit('createRoom', {nickname}, (response) => {
    createBtn.disabled=false;
    joinBtn.disabled=false;

    if (response.success) {
      console.log('Room created:', response.code);
    } else {
      showError(response.error||'Failed to create room');
    }
  });
});

joinBtn.addEventListener('click', () => {
  const code=joinCodeInput.value.trim().toUpperCase();
  if (!code||code.length!==6) {
    showError('Please enter a valid 6-character room code');
    return;
  }

  createBtn.disabled=true;
  joinBtn.disabled=true;
  showStatus('Joining game...');

  const nickname=nicknameInput.value.trim()||'Explorer';
  localStorage.setItem('moonlander_nickname', nickname);
  socket.emit('joinRoom', {code, nickname}, (response) => {
    createBtn.disabled=false;
    joinBtn.disabled=false;

    if (response.success) {
      console.log('Joined room:', code);
      updatePlayerCount(response.playerCount);
    } else {
      showError(response.error||'Failed to join room');
    }
  });
});

// Allow Enter key to join
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key==='Enter') {
    joinBtn.click();
  }
});

// Auto-uppercase input
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value=joinCodeInput.value.toUpperCase();
});

leaveBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
});

const lobbyGuideBtn=document.getElementById('lobbyGuideBtn');
if (lobbyGuideBtn) {
  lobbyGuideBtn.addEventListener('click', () => {
    // Open escape menu switched to guide tab, hiding in-game only buttons
    if (resumeBtn) resumeBtn.style.display='none';
    if (quitBtn) quitBtn.style.display='none';

    // Activate guide tab
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(t => t.classList.add('hidden'));

    const guideTabBtn=document.querySelector('[data-settings-tab="guide"]');
    const guideTabContent=document.getElementById('settings-tab-guide');
    if (guideTabBtn) guideTabBtn.classList.add('active');
    if (guideTabContent) guideTabContent.classList.remove('hidden');

    escapeMenuEl.classList.remove('hidden');
    isMenuOpen=true;
    soundManager.playSound('menu_pop');
  });
}

// ============================================
// EVENT LISTENERS - MENU
// ============================================

masterVolumeInput.addEventListener('input', (e) => {
  const val=parseInt(e.target.value)/100;
  soundManager.setMasterVolume(val);
});

musicVolumeInput.addEventListener('input', (e) => {
  const val=parseInt(e.target.value)/100;
  soundManager.setMusicVolume(val);
});

sfxVolumeInput.addEventListener('input', (e) => {
  const val=parseInt(e.target.value)/100;
  soundManager.setSfxVolume(val);
});

notificationVolumeInput.addEventListener('input', (e) => {
  const val=parseInt(e.target.value)/100;
  soundManager.setNotificationVolume(val);
});

resumeBtn.addEventListener('click', () => {
  toggleMenu();
});

const closeGuideBtn=document.getElementById('closeGuideBtn');
const closeGuideBottomBtn=document.getElementById('closeGuideBottomBtn');

function closeGuideMenu() {
  escapeMenuEl.classList.add('hidden');
  isMenuOpen=false;
  soundManager.playSound('menu_pop');
}

if (closeGuideBtn) {
  closeGuideBtn.addEventListener('click', closeGuideMenu);
}

if (closeGuideBottomBtn) {
  closeGuideBottomBtn.addEventListener('click', closeGuideMenu);
}

quitBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
});

// ============================================
// SOCKET EVENTS
// ============================================

socket.on('connect', () => {
  console.log('Connected to server');
  myId=socket.id;
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
  myId=data.id;
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
  isHost=(data.newHostId===myId);
});

socket.on('mapData', (mapData) => {
  if (renderer) {
    renderer.setTerrain(mapData);
  } else {
    // Store for later if renderer isn't ready yet
    pendingMapData=mapData;
  }
});

socket.on('tileUpdate', ({x, y, value}) => {
  if (renderer) {
    renderer.updateTile(x, y, value);
  }
});

socket.on('gameState', (state) => {
  gameState=state;
  if (inventoryMenuOpen) {
    renderInventory();
  }
});

socket.on('respawnResult', (result) => {
  if (!result.success) {
    console.log('Respawn failed:', result.reason);
    if (result.reason==='no_resources'&&renderer) {
      renderer.showMessage(`Not enough spare parts! Need ${result.required}, have ${result.available}`);
    }
  }
});

socket.on('gasEruption', (data) => {
  if (renderer) {
    renderer.spawnGasEruption(data.x, data.y);
  }
});

socket.on('fallingDebris', (data) => {
  if (renderer) {
    renderer.spawnFallingDebris(data.x, data.y, data.tileType);
  }
});

socket.on('cargoDelivered', (data) => {
  if (renderer) {
    renderer.showMessage(`Cargo delivered! +${data.value} value`);
  }
});

socket.on('playerRescued', (data) => {
  if (renderer) {
    if (data.rescuedId===myId) {
      renderer.showMessage('You were rescued!');
    } else if (data.rescuerId===myId) {
      renderer.showMessage('Teammate rescued!');
    }
  }
});

socket.on('cargoJettisoned', (data) => {
  if (renderer) {
    renderer.showMessage(`Jettisoned ${data.amount} cargo!`);
  }
});

socket.on('orePickup', (data) => {
  if (renderer) {
    renderer.spawnOrePickupText(data.oreName, data.amount, data.x, data.y, data.color||'#fff');
  }
  if (data.playerId===myId) {
    soundManager.playSound('ore_mined');
  }
});

socket.on('playSound', (data) => {
  if (data.type&&soundManager.sounds[data.type]) {
    soundManager.playSound(data.type);
  }
});

socket.on('chatMessage', (data) => {
  // Add message to chat history
  chatMessages.push({
    playerId: data.playerId,
    message: data.message,
    timestamp: data.timestamp,
    isMe: data.playerId===myId
  });
  // Keep only last 50 messages
  if (chatMessages.length>50) {
    chatMessages.shift();
  }
  // Pass to renderer for display
  if (renderer) {
    renderer.addChatMessage(data.playerId, data.nickname, data.message, data.playerId===myId);
  }
  if (data.playerId!==myId) {
    soundManager.playNotification();
  }
});

// Game Over / Victory Ending Screen
const gameOverMenuEl=document.getElementById('gameOverMenu');
const gameOverModalContent=document.getElementById('gameOverModalContent');
const gameOverBadge=document.getElementById('gameOverBadge');
const gameOverTitle=document.getElementById('gameOverTitle');
const gameOverSubtitle=document.getElementById('gameOverSubtitle');
const statEndingTime=document.getElementById('statEndingTime');
const statEndingDepth=document.getElementById('statEndingDepth');
const statEndingOre=document.getElementById('statEndingOre');
const statEndingDeaths=document.getElementById('statEndingDeaths');
const gameOverContinueBtn=document.getElementById('gameOverContinueBtn');
const gameOverQuitBtn=document.getElementById('gameOverQuitBtn');

function formatDuration(seconds) {
  const mins=Math.floor(seconds/60);
  const secs=Math.floor(seconds%60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

socket.on('gameOver', (data) => {
  if (gameOverMenuEl) {
    if (data.won) {
      if (gameOverModalContent) gameOverModalContent.className='modal-content game-over-content victory-theme';
      if (gameOverBadge) gameOverBadge.textContent='MISSION ACCOMPLISHED';
      if (gameOverTitle) gameOverTitle.textContent='LUNAR CORE REACHED!';
      if (gameOverSubtitle) gameOverSubtitle.textContent='Your team has successfully navigated 5,000m into the lunar depths!';
      soundManager.playSound('victory');
    } else {
      if (gameOverModalContent) gameOverModalContent.className='modal-content game-over-content defeat-theme';
      if (gameOverBadge) gameOverBadge.textContent='MISSION FAILED';
      if (gameOverTitle) gameOverTitle.textContent='COLONY LOST';
      if (gameOverSubtitle) gameOverSubtitle.textContent='All landers were destroyed and no spare parts remain for respawn.';
    }

    if (statEndingTime) statEndingTime.textContent=formatDuration(data.time||0);
    if (statEndingDepth) statEndingDepth.textContent=data.won? '5,000m':'Surface';
    if (statEndingOre) statEndingOre.textContent=(data.oreCollected||0).toLocaleString();
    if (statEndingDeaths) statEndingDeaths.textContent=data.deaths||0;

    gameOverMenuEl.classList.remove('hidden');
  }
});

if (gameOverContinueBtn) {
  gameOverContinueBtn.addEventListener('click', () => {
    gameOverMenuEl.classList.add('hidden');
  });
}

if (gameOverQuitBtn) {
  gameOverQuitBtn.addEventListener('click', () => {
    gameOverMenuEl.classList.add('hidden');
    socket.emit('leaveRoom');
  });
}

// ============================================
// GAME LOOP
// ============================================
// GAME INPUT
// ============================================

// Chat input handling
function openChat() {
  if (isChatOpen) return;
  isChatOpen=true;
  // Create chat input if doesn't exist
  let chatInput=document.getElementById('chatInput');
  if (!chatInput) {
    chatInput=document.createElement('input');
    chatInput.id='chatInput';
    chatInput.type='text';
    chatInput.placeholder='Type a message...';
    chatInput.maxLength=200;
    chatInput.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:400px;padding:10px;background:rgba(0,0,0,0.8);border:2px solid #0af;color:#fff;font-family:monospace;font-size:14px;z-index:1000;outline:none;';
    document.body.appendChild(chatInput);
  }
  chatInput.style.display='block';
  chatInput.value='';
  chatInput.focus();

  chatInput.onkeydown=(e) => {
    if (e.key==='Enter') {
      const message=chatInput.value.trim();
      if (message.length>0) {
        socket.emit('chatMessage', {message});
      }
      closeChat();
      e.preventDefault();
    } else if (e.key==='Escape') {
      closeChat();
      e.preventDefault();
    }
    e.stopPropagation();
  };
}

function closeChat() {
  isChatOpen=false;
  const chatInput=document.getElementById('chatInput');
  if (chatInput) {
    chatInput.style.display='none';
    chatInput.blur();
  }
}

// Handle respawn key press
window.addEventListener('keydown', (e) => {
  // Allow Escape to close menu anytime it's open (even from lobby)
  if (e.key==='Escape'&&isMenuOpen) {
    escapeMenuEl.classList.add('hidden');
    isMenuOpen=false;
    soundManager.playSound('menu_pop');
    return;
  }

  if (!currentRoom) return;

  // Don't process game keys while chat is open
  if (isChatOpen) return;

  if (e.key==='Escape') {
    toggleMenu();
    return;
  }

  // Open chat with Enter key
  if (e.key==='Enter') {
    openChat();
    e.preventDefault();
    return;
  }

  if (e.key==='r'||e.key==='R') {
    const myPlayer=gameState.players.find(p => p.id===myId);
    if (myPlayer&&myPlayer.dead) {
      socket.emit('respawn');
    }
  }

  // Open Station Menu (B)
  if (e.key==='b'||e.key==='B') {
    const myPlayer=gameState.players.find(p => p.id===myId);
    if (myPlayer&&myPlayer.onPad) {
      openStationMenu();
    }
  }

  // Open Debug Menu (Backtick/tilde key) - Development only (Localhost)
  if (e.key==='`'||e.key==='~') {
    if (window.location.hostname==='localhost') {
      if (debugMenuOpen) {
        closeDebugMenu();
      } else {
        openDebugMenu();
      }
    }
  }

  // Open Inventory (Q)
  if (e.key==='q'||e.key==='Q') {
    if (inventoryMenuOpen) {
      closeInventoryMenu();
    } else {
      openInventoryMenu();
    }
  }
});

// ============================================
// STATION MENU FUNCTIONS
// ============================================

let stationMenuOpen=false;

function openStationMenu() {
  stationMenuEl.classList.remove('hidden');
  stationMenuOpen=true;
  soundManager.playSound('menu_pop');

  // Default to Overview if valid, or just update everything
  // Check which tab is active
  const activeTab=document.querySelector('.station-tabs .tab-btn.active');
  if (activeTab&&activeTab.dataset.tab==='overview') {
    updateStationOverview();
  }

  renderShipList();
  renderBuildingList();
  renderCraftingList();
}

function closeStationMenu() {
  stationMenuEl.classList.add('hidden');
  stationMenuOpen=false;
  soundManager.playSound('menu_pop');
}

closeStationBtn.addEventListener('click', closeStationMenu);

// Update overview when game state changes
socket.on('gameState', (state) => {
  gameState=state;
  if (stationMenuOpen) {
    refreshStationOverview();
  }
});

function refreshStationOverview() {
  const activeTab=document.querySelector('.station-tabs .tab-btn.active');
  if (activeTab&&activeTab.dataset.tab==='overview') {
    updateStationOverview();
  }
}

// Event Delegation for Station Overview
// This ensures that buttons work even if the DOM is refreshed frequently
document.body.addEventListener('click', (e) => {
  const depositBtn=e.target.closest('#depositAllBtn');
  if (depositBtn) {
    const myPlayer=gameState.players.find(p => p.id===myId);
    if (myPlayer) {
      socket.emit('depositAllOres');
      soundManager.playSound('click');
      console.log("Client: Sent depositAllOres event (delegated)");
    }
  }
});

// Debug Menu Functions (Development Only)
function openDebugMenu() {
  debugMenuEl.classList.remove('hidden');
  debugMenuOpen=true;
  soundManager.playSound('menu_pop');
}

function closeDebugMenu() {
  debugMenuEl.classList.add('hidden');
  debugMenuOpen=false;
  soundManager.playSound('menu_pop');
}

if (closeDebugBtn) {
  closeDebugBtn.addEventListener('click', closeDebugMenu);
}

// ============================================
// INVENTORY MENU FUNCTIONS
// ============================================

function getShipInventorySlots(shipType) {
  switch (shipType) {
    case 'eva': return 1;
    case 'cargo': return 6;
    case 'scout':
    default: return 3;
  }
}

let lastRenderedInventoryKey = '';

function openInventoryMenu() {
  const myPlayer=gameState.players.find(p => p.id===myId);
  if (!myPlayer) return;

  inventoryMenuEl.classList.remove('hidden');
  inventoryMenuOpen=true;
  soundManager.playSound('menu_pop');

  // Only show station inventory if on pad
  if (myPlayer.onPad) {
    stationInventorySection.classList.remove('hidden');
  } else {
    stationInventorySection.classList.add('hidden');
  }

  renderInventory(true);
}

function closeInventoryMenu() {
  inventoryMenuEl.classList.add('hidden');
  inventoryMenuOpen=false;
  selectedShipSlot=null;
  selectedStationSlot=null;
  lastRenderedInventoryKey = '';
  soundManager.playSound('menu_pop');
}

function renderInventory(force = false) {
  const myPlayer=gameState.players.find(p => p.id===myId);
  if (!myPlayer) return;

  const droppedItems=gameState.droppedItems||[];
  const myPos={x: myPlayer.x, y: myPlayer.y};
  const nearby=droppedItems.filter(item => {
    const dist=Math.sqrt(Math.pow(item.x-myPos.x, 2)+Math.pow(item.y-myPos.y, 2));
    return dist<150; // Increased pickup range
  });

  const currentKey = JSON.stringify({
    cargo: myPlayer.cargo,
    shipType: myPlayer.shipType,
    onPad: myPlayer.onPad,
    stationOres: myPlayer.onPad ? gameState.baseResources?.ores : null,
    nearby: nearby.map(i => i.id)
  });

  if (!force && currentKey === lastRenderedInventoryKey) {
    return;
  }
  lastRenderedInventoryKey = currentKey;

  const shipSlots=getShipInventorySlots(myPlayer.shipType);
  const cargo=myPlayer.cargo||[];

  // Update title
  document.getElementById('shipInventoryTitle').textContent=
    `${myPlayer.shipType==='eva'? 'EVA':'Ship'} Cargo (${cargo.length}/${shipSlots} slots)`;

  // Render ship inventory
  shipInventoryEl.innerHTML='';
  for (let i=0; i<shipSlots; i++) {
    const item=cargo[i]||null;
    const slot=createInventorySlot(item, i, 'ship');
    shipInventoryEl.appendChild(slot);
  }

  // Render station inventory if on pad
  if (myPlayer.onPad) {
    const stationOres=gameState.baseResources?.ores||{};
    const stationItems=Object.entries(stationOres)
      .filter(([_, amount]) => amount>0)
      .map(([type, amount]) => ({type: type.toUpperCase()+'_ORE', amount}));

    stationInventoryEl.innerHTML='';
    const stationSlots=12;
    for (let i=0; i<stationSlots; i++) {
      const item=stationItems[i]||null;
      const slot=createInventorySlot(item, i, 'station');
      stationInventoryEl.appendChild(slot);
    }
  }

  // Render nearby items (Dropped items)
  nearbyInventoryEl.innerHTML='';

  if (nearby.length===0) {
    nearbyInventoryEl.innerHTML='<div style="color: #666; font-size: 0.8rem; padding: 10px; grid-column: span 3; text-align: center;">No items nearby</div>';
  } else {
    nearby.forEach((item) => {
      const slot=createInventorySlot(item, item.id, 'dropped');
      nearbyInventoryEl.appendChild(slot);
    });
  }
}

function createInventorySlot(item, index, location) {
  const slot=document.createElement('div');
  slot.className='inventory-slot'+(item? '':' empty');
  slot.dataset.index=index;
  slot.dataset.location=location;

  // Tooltip
  if (item) {
    let itemName='';
    if (item.type.includes('cable')) {
      itemName=item.type.replace('cable_', '').replace('_', ' ').toUpperCase()+' CABLE';
    } else if (item.type.includes('_ORE')) {
      itemName=item.type.replace('_ORE', '').replace('_', ' ')+' ORE';
    } else {
      itemName=item.type.replace('_', ' ').toUpperCase();
    }
    slot.setAttribute('data-tooltip', itemName);
  }

  // Click handler for pickup (only for dropped items)
  if (item&&location==='dropped') {
    slot.onclick=() => {
      console.log(`Client: Attempting to pickup item ${item.id}`);
      socket.emit('pickupItem', {itemId: item.id});
      soundManager.playSound('click');
    };

    // Add visual cue that it is clickable
    slot.style.border='1px dashed #4f4';
    slot.style.cursor='pointer';
  }

  // Make draggable if it has an item and is in ship inventory
  if (item&&location==='ship') {
    slot.draggable=true;
    slot.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        index: index,
        location: location,
        type: 'inventory_drag'
      }));
      slot.classList.add('dragging');
    });
    slot.addEventListener('dragend', (e) => {
      slot.classList.remove('dragging');
      // Check if dropped successfuly?
    });
  }

  if (item&&location==='dropped') {
    // Special styling or just normal item
    // If it's a queued pickup, maybe dim it?
  }

  if (item) {
    slot.draggable=true;
    slot.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'inventory_drag',
        location: location,
        index: index,
        item: item
      }));
    });

    if (typeof item.type==='string'&&(item.type.startsWith('cable_spool_')||item.type.startsWith('cable_'))) {
      const img=document.createElement('img');
      img.className='item-icon';
      let spriteName='cable_red.png';

      // Handle old spool types
      if (item.type.includes('power')) spriteName='cable_red.png';
      else if (item.type.includes('fuel')) spriteName='cable_green.png';
      else if (item.type.includes('data')) spriteName='cable_blue.png';
      // Handle new simple types
      else if (item.type==='cable_red') spriteName='cable_red.png';
      else if (item.type==='cable_green') spriteName='cable_green.png';
      else if (item.type==='cable_blue') spriteName='cable_blue.png';

      img.src='/sprites/'+spriteName;
      img.style.objectFit='contain';
      slot.appendChild(img);
    } else {
      // Create icon div for ore or material
      const icon=document.createElement('div');
      icon.className='item-icon';

      const oreMap={
        'IRON_ORE': 0, 'COPPER_ORE': 1, 'BITITE': 2, 'SILVER_ORE': 3,
        'TITANIUM_ORE': 4, 'GOLD_ORE': 5, 'PLATINUM_ORE': 6, 'DIAMOND': 7, 'HELIUM3': 8
      };
      const matMap={
        'BASIC': 0, 'INDUSTRIAL': 1, 'ADVANCED': 2, 'QUANTUM': 3, 'FUEL': 4
      };

      if (oreMap[item.type]!==undefined) {
        icon.style.backgroundImage="url('/sprites/ores_spritesheet.png')";
        icon.style.backgroundSize="288px 32px";
        icon.style.backgroundPosition=`-${oreMap[item.type]*32}px 0px`;
        icon.style.backgroundRepeat="no-repeat";
        icon.style.imageRendering='pixelated';
      } else if (matMap[item.type]!==undefined) {
        icon.style.backgroundImage="url('/sprites/materials_spritesheet.png')";
        icon.style.backgroundSize="160px 32px";
        icon.style.backgroundPosition=`-${matMap[item.type]*32}px 0px`;
        icon.style.backgroundRepeat="no-repeat";
        icon.style.imageRendering='pixelated';
      } else {
        icon.style.backgroundColor=getOreColor(item.type);
        icon.style.borderRadius='4px';
      }
      slot.appendChild(icon);
    }

    const name=document.createElement('div');
    name.className='item-name';
    name.textContent=formatOreName(item.type);
    slot.appendChild(name);

    const amount=document.createElement('div');
    amount.className='item-amount';
    amount.textContent=item.amount;
    slot.appendChild(amount);
  }

  // Selection / Pickup logic
  slot.addEventListener('click', () => {
    if (location==='dropped') {
      // Pickup item
      socket.emit('pickupItem', {itemId: index}); // index is actually ID for dropped items
      return;
    }

    if (location==='ship') {
      document.querySelectorAll('#shipInventory .inventory-slot').forEach(s => s.classList.remove('selected'));
      if (item) {
        slot.classList.add('selected');
        selectedShipSlot=index;
      } else {
        selectedShipSlot=null;
      }
    } else if (location==='station') {
      document.querySelectorAll('#stationInventory .inventory-slot').forEach(s => s.classList.remove('selected'));
      if (item) {
        slot.classList.add('selected');
        selectedStationSlot=index;
      } else {
        selectedStationSlot=null;
      }
    }
    updateTransferButtons();
  });

  return slot;
}

function formatOreName(type) {
  if (typeof type==='string'&&(type.startsWith('cable_spool_')||type.startsWith('cable_'))) {
    return type.replace('cable_spool_', '').replace('cable_', '').toUpperCase()+' CABLE';
  }
  if (['BASIC', 'INDUSTRIAL', 'ADVANCED', 'QUANTUM', 'FUEL'].includes(type.toUpperCase())) {
    return type.charAt(0).toUpperCase()+type.slice(1).toLowerCase();
  }
  return String(type).replace('_ORE', '').replace('_', ' ').toLowerCase();
}

function updateTransferButtons() {
  const myPlayer=gameState.players.find(p => p.id===myId);
  if (!myPlayer) return;

  // Enable transfer to station if ship slot selected and on pad
  transferToStationBtn.disabled=!(selectedShipSlot!==null&&myPlayer.onPad);

  // Enable transfer to ship if station slot selected
  transferToShipBtn.disabled=!(selectedStationSlot!==null);
}

// Transfer handlers
transferToStationBtn?.addEventListener('click', () => {
  if (selectedShipSlot===null) return;
  socket.emit('transferInventory', {from: 'ship', to: 'station', slotIndex: selectedShipSlot});
  selectedShipSlot=null;
  renderInventory();
});

transferToShipBtn?.addEventListener('click', () => {
  if (selectedStationSlot===null) return;
  const stationOres=gameState.baseResources?.ores||{};
  const stationItems=Object.entries(stationOres)
    .filter(([_, amount]) => amount>0)
    .map(([type, amount]) => ({type: type.toUpperCase()+'_ORE', amount}));
  const item=stationItems[selectedStationSlot];
  if (item) {
    socket.emit('transferInventory', {from: 'station', to: 'ship', oreType: item.type});
  }
  selectedStationSlot=null;
  renderInventory();
});

closeInventoryBtn?.addEventListener('click', closeInventoryMenu);

// Debug button handlers
document.getElementById('debugAddFuel')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'addFuel', amount: 1000});
});

document.getElementById('debugAddParts')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'addParts', amount: 100});
});

document.getElementById('debugAddOre')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'addAllOres', amount: 500});
});

document.getElementById('debugAddMaterials')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'addAllMaterials', amount: 100});
});

document.getElementById('debugRepairShip')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'repairShip'});
});

document.getElementById('debugSpawnScout')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'spawnShip', type: 'scout'});
});

document.getElementById('debugSpawnCargo')?.addEventListener('click', () => {
  socket.emit('debugCommand', {command: 'spawnShip', type: 'cargo'});
});

document.getElementById('debugInfiniteFuel')?.addEventListener('click', () => {
  infiniteFuelEnabled=!infiniteFuelEnabled;
  syncInfiniteFuel(infiniteFuelEnabled);
});

document.getElementById('settingsInfiniteFuel')?.addEventListener('change', (e) => {
  infiniteFuelEnabled=e.target.checked;
  syncInfiniteFuel(infiniteFuelEnabled);
});

function syncInfiniteFuel(enabled) {
  const debugBtn=document.getElementById('debugInfiniteFuel');
  const settingsToggle=document.getElementById('settingsInfiniteFuel');
  if (debugBtn) debugBtn.style.background=enabled? '#484':'#333';
  if (settingsToggle) settingsToggle.checked=enabled;
  socket.emit('debugCommand', {command: 'infiniteFuel', enabled: enabled});
}

document.getElementById('debugVisualizeColliders')?.addEventListener('change', (e) => {
  const settingsToggle=document.getElementById('settingsVisualizeColliders');
  if (settingsToggle) settingsToggle.checked=e.target.checked;
  if (renderer) {
    renderer.debugVisualizeColliders=e.target.checked;
  }
});

document.getElementById('settingsVisualizeColliders')?.addEventListener('change', (e) => {
  const debugToggle=document.getElementById('debugVisualizeColliders');
  if (debugToggle) debugToggle.checked=e.target.checked;
  if (renderer) {
    renderer.debugVisualizeColliders=e.target.checked;
  }
});

// Settings Debug Actions
document.getElementById('settingsRepairShip')?.addEventListener('click', () => {
  console.log("Client: Debug Command - repairShip");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'repairShip'});
});

document.getElementById('settingsAddFuel')?.addEventListener('click', () => {
  console.log("Client: Debug Command - addFuel");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'addFuel', amount: 1000});
});

document.getElementById('settingsSpawnRed')?.addEventListener('click', () => {
  console.log("Client: Debug Command - spawnItem (cable_red)");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'spawnItem', type: 'cable_red', amount: 1});
});

document.getElementById('settingsSpawnGreen')?.addEventListener('click', () => {
  console.log("Client: Debug Command - spawnItem (cable_green)");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'spawnItem', type: 'cable_green', amount: 1});
});

document.getElementById('settingsSpawnBlue')?.addEventListener('click', () => {
  console.log("Client: Debug Command - spawnItem (cable_blue)");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'spawnItem', type: 'cable_blue', amount: 1});
});

document.getElementById('debugTeleportBase')?.addEventListener('click', () => {
  console.log("Client: Debug Command - teleportBase");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'teleportBase'});
});

document.getElementById('debugMaxBuildings')?.addEventListener('click', () => {
  console.log("Client: Debug Command - maxBuildings");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'maxBuildings'});
});

document.getElementById('debugKillPlayer')?.addEventListener('click', () => {
  console.log("Client: Debug Command - killPlayer");
  soundManager.playSound('click');
  socket.emit('debugCommand', {command: 'killPlayer'});
});

// Tab switching
// Station Menu Tab Switching
// Tab switching
// Station Menu Tab Switching
const stationTabBtns=document.querySelectorAll('.station-tabs .tab-btn');
const stationTabContents=document.querySelectorAll('.station-tab');

function updateStationOverview() {
  if (!gameState) return;
  const baseRes=gameState.baseResources||{};

  // Render Status Bars
  const statusContainer=document.getElementById('stationStatusBars');
  if (statusContainer) {
    statusContainer.innerHTML=`
      <div class="status-bar-item">
        <div class="status-bar-label"><span>STATION FUEL</span><span class="status-bar-val">${Math.floor(baseRes.fuel||0)} / ${baseRes.maxFuel||10000}</span></div>
        <div class="status-bar-track"><div class="status-bar-fill" style="width: ${Math.min(100, (baseRes.fuel||0)/(baseRes.maxFuel||10000)*100)}%; background: #ffaa00;"></div></div>
      </div>
      <div class="status-bar-item">
        <div class="status-bar-label"><span>SPARE PARTS</span><span class="status-bar-val">${Math.floor(baseRes.spareParts||0)} / ${baseRes.maxSpareParts||1000}</span></div>
        <div class="status-bar-track"><div class="status-bar-fill" style="width: ${Math.min(100, (baseRes.spareParts||0)/(baseRes.maxSpareParts||1000)*100)}%; background: #ccc;"></div></div>
      </div>
      <div class="status-bar-item">
        <div class="status-bar-label"><span>GRID POWER</span><span class="status-bar-val">${Math.floor(baseRes.power||0)} / ${baseRes.maxPower||100}</span></div>
        <div class="status-bar-track"><div class="status-bar-fill" style="width: ${Math.min(100, (baseRes.power||0)/(baseRes.maxPower||100)*100)}%; background: #0af;"></div></div>
      </div>
    `;
  }

  // Render Ores
  const oreContainer=document.getElementById('stationOreGrid');
  if (oreContainer&&renderer) {
    const ores=[
      {name: 'Iron', key: 'iron', type: 'IRON_ORE'},
      {name: 'Copper', key: 'copper', type: 'COPPER_ORE'},
      {name: 'Bitite', key: 'bitite', type: 'BITITE'},
      {name: 'Silver', key: 'silver', type: 'SILVER_ORE'},
      {name: 'Titanium', key: 'titanium', type: 'TITANIUM_ORE'},
      {name: 'Gold', key: 'gold', type: 'GOLD_ORE'},
      {name: 'Platinum', key: 'platinum', type: 'PLATINUM_ORE'},
      {name: 'Diamond', key: 'diamond', type: 'DIAMOND'},
      {name: 'Helium3', key: 'helium3', type: 'HELIUM3'}
    ];

    let oreHtml=`
      <div style="padding-bottom: 10px; border-bottom: 1px solid #444; margin-bottom: 5px;">
        <button id="depositAllBtn" class="select-btn" style="background: #2a2a40; color: #4f4; border-color: #4f4;">
            ⬇ Deposit All Ores
        </button>
      </div>
    `;

    ores.forEach(ore => {
      const amount=baseRes.ores? (baseRes.ores[ore.key]||0):0;
      const color=renderer.getOreColor(ore.type);
      oreHtml+=`
          <div class="ore-row">
            <div class="ore-color-box" style="background: ${color}; box-shadow: 0 0 5px ${color};"></div>
            <div class="ore-name">${ore.name}</div>
            <div class="ore-amount">${amount}</div>
          </div>
        `;
    });
    oreContainer.innerHTML=oreHtml;
  }

  // Render Processed Assets (Materials)
  const assetContainer=document.getElementById('stationAssetsGrid');
  if (assetContainer) {
    const assets=[
      {name: 'Basic', key: 'basic', color: '#aaa'},
      {name: 'Industrial', key: 'industrial', color: '#fa0'},
      {name: 'Advanced', key: 'advanced', color: '#f44'},
      {name: 'Quantum', key: 'quantum', color: '#a0f'},
      {name: 'Liquid Fuel', key: 'fuel', color: '#ffaa00', isValue: true} // Fuel is already shown but maybe liquid units?
    ];
    let assetHtml='';

    // Building materials
    if (baseRes.materials) {
      Object.entries(baseRes.materials).forEach(([key, amt]) => {
        // Map key to friendly name if desired, or just list them
        let displayKey=key.charAt(0).toUpperCase()+key.slice(1);
        // Simple list
        assetHtml+=`
                <div class="ore-row">
                   <div class="ore-color-box" style="background: #33a;"></div>
                   <div class="ore-name">${displayKey} Alloy</div>
                   <div class="ore-amount">${amt}</div>
                </div>
             `;
      });
    }

    // Add processed fuel count separately if needed or just stats
    assetContainer.innerHTML=assetHtml||'<div style="color:#666; font-size:0.8rem; padding:10px;">No processed alloys in storage.</div>';
  }
}

stationTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Deactivate all
    stationTabBtns.forEach(b => b.classList.remove('active'));
    stationTabContents.forEach(t => t.classList.add('hidden'));

    // Activate selected
    btn.classList.add('active');
    const tabName=btn.dataset.tab;
    const tabId=`tab-${tabName}`;
    const content=document.getElementById(tabId);
    if (content) content.classList.remove('hidden');

    soundManager.playSound('menu_pop');

    // Load content
    if (tabName==='hangar') {
      renderShipList();
    } else if (tabName==='construction') {
      renderBuildingList();
    } else if (tabName==='crafting') {
      renderCraftingList();
    } else if (tabName==='overview') {
      updateStationOverview();
    }
  });
});

const SHIP_TYPES=[
  {id: 'scout', name: 'Scout', cargo: 3, fuel: 500, desc: 'Fast, agile lander. 3 cargo slots.'},
  {id: 'cargo', name: 'Cargo Hauler', cargo: 6, fuel: 1000, desc: 'Heavy lander. 6 cargo slots (2x3). Cost: 50 Industrial.'}
];

function renderShipList() {
  shipListEl.innerHTML='';
  const myPlayer=gameState.players.find(p => p.id===myId);
  if (!myPlayer) return;

  const factoryLevel=gameState.buildings?.ship_factory?.level||0;

  SHIP_TYPES.forEach(ship => {
    const card=document.createElement('div');
    card.className=`ship-card ${myPlayer.shipType===ship.id? 'active':''}`;

    const isLocked=ship.reqFactory&&factoryLevel<ship.reqFactory;
    const isCurrent=myPlayer.shipType===ship.id;

    card.innerHTML=`
            <h4>${ship.name} ${isCurrent? '(Current)':''}</h4>
            <div class="ship-stats">
                <span>Cargo: ${ship.cargo}</span>
                <span>Fuel: ${ship.fuel}</span>
            </div>
            <p style="font-size: 0.8rem; color: #888; margin-top: 5px;">${ship.desc}</p>
            ${isLocked? `<p style="color: #f44; font-size: 0.8rem;">Requires Ship Factory Lv${ship.reqFactory}</p>`:''}
            <button class="select-btn" ${isCurrent||isLocked? 'disabled':''} onclick="switchShip('${ship.id}')">
                ${isCurrent? 'Selected':(isLocked? 'Locked':'Switch')}
            </button>
        `;

    // Attach event listener directly to avoid global scope issues
    const btn=card.querySelector('button');
    if (!isCurrent&&!isLocked) {
      btn.onclick=() => handleSwitchShip(ship.id);
    }

    shipListEl.appendChild(card);
  });
}

function handleSwitchShip(type) {
  hangarStatusEl.textContent='Switching ship...';
  hangarStatusEl.style.color='#ccc';

  socket.emit('switchShip', {type}, (response) => {
    if (response.success) {
      hangarStatusEl.textContent='Ship switched successfully!';
      hangarStatusEl.style.color='#4f4';
      // Re-render to update UI
      // We need to wait for gameState update to see the new ship type reflected in myPlayer
      // But for UI feedback we can just update the button state after a small delay or rely on next render loop
      setTimeout(renderShipList, 200);
    } else {
      hangarStatusEl.textContent=`Failed: ${response.reason}`;
      hangarStatusEl.style.color='#f44';
    }
  });
}

function renderBuildingList() {
  buildingListEl.innerHTML='';
  if (!gameState.buildings) return;

  const buildings=Object.entries(gameState.buildings);

  // Sort: constructed first, then unbuilt
  buildings.sort((a, b) => {
    return (b[1].level>0? 1:0)-(a[1].level>0? 1:0);
  });

  buildings.forEach(([key, b]) => {
    const card=document.createElement('div');
    const isBuilt=b.level>0;
    const isMax=b.level>=b.maxLevel;

    card.className=`building-card ${isBuilt? '':'unbuilt'}`;

    // Cost formatting
    let costHtml='';
    if (b.nextCost) {
      const costs=[];
      if (b.nextCost.basic) costs.push(`<span class="cost-basic">${b.nextCost.basic} Basic</span>`);
      if (b.nextCost.industrial) costs.push(`<span class="cost-industrial">${b.nextCost.industrial} Indust.</span>`);
      if (b.nextCost.advanced) costs.push(`<span class="cost-advanced">${b.nextCost.advanced} Adv.</span>`);
      if (b.nextCost.quantum) costs.push(`<span class="cost-quantum">${b.nextCost.quantum} Quant.</span>`);
      costHtml=`<div class="building-cost" style="margin-top:5px; font-size:0.8rem">Cost: ${costs.join(', ')}</div>`;
    } else if (isMax) {
      costHtml=`<div class="building-cost" style="margin-top:5px; font-size:0.8rem">Max Level Reached</div>`;
    }

    card.innerHTML=`
        <div class="building-header" style="display:flex; justify-content:space-between; align-items:center">
            <h4 style="margin:0">${b.name} <span class="level-badge" style="background:#444; padding:2px 5px; border-radius:3px; font-size:0.7em">Lv ${b.level}</span></h4>
            ${!isBuilt? '<span class="new-badge" style="background:#f90; color:#000; padding:2px 5px; border-radius:3px; font-size:0.7em; font-weight:bold">NEW</span>':''}
        </div>
        <p class="building-desc" style="font-size: 0.8rem; color: #aaa; margin: 5px 0;">Effect: ${b.currentEffect||'None'} ${!isMax? '-> Increase':''}</p>
        ${costHtml}
        <button class="upgrade-btn select-btn" ${!b.canUpgrade||isMax? 'disabled':''} style="width:100%; margin-top:8px" onclick="handleUpgradeBuilding('${key}')">
            ${!isBuilt? 'Construct':(isMax? 'Max Level':'Upgrade')}
        </button>
    `;

    buildingListEl.appendChild(card);
  });
}

// Make it global so HTML onclick works
window.handleUpgradeBuilding=function(key) {
  socket.emit('upgradeBuilding', {buildingKey: key}, (response) => {
    if (response.success) {
      soundManager.playSound('refinery'); // Use industrial sound for construction
    }
  });
};

function renderCraftingList() {
  const craftingListEl=document.getElementById('craftingList');
  if (!craftingListEl) return;
  craftingListEl.innerHTML='';

  // Define recipes
  // Format: { name, type, icon, cost: {resource: amount} }
  // Resources in baseResources: iron, copper, gold, etc.
  const recipes=[
    {
      name: 'Power Cable (Red)',
      type: 'cable_red',
      icon: '/sprites/cable_red.png',
      cost: {basic: 20}
    },
    {
      name: 'Fuel Cable (Green)',
      type: 'cable_green',
      icon: '/sprites/cable_green.png',
      cost: {basic: 20}
    },
    {
      name: 'Data Cable (Blue)',
      type: 'cable_blue',
      icon: '/sprites/cable_blue.png',
      cost: {basic: 20}
    },
    {
      name: 'Placeable Light',
      type: 'light',
      icon: '/sprites/placeable_light.png',
      cost: {basic: 20}
    }
  ];

  recipes.forEach(recipe => {
    const card=document.createElement('div');
    card.className='building-card'; // Reuse style

    // Check affordance
    let canAfford=true;
    let costText=[];

    // Check base resources
    const baseRes=gameState.baseResources;

    for (const [res, amt] of Object.entries(recipe.cost)) {
      const avail=baseRes[res]||0;
      if (avail<amt) canAfford=false;
      // Capitalize
      const resName=res.charAt(0).toUpperCase()+res.slice(1);
      const color=avail>=amt? '#4f4':'#f44';
      costText.push(`<span style="color:${color}">${amt} ${resName}</span>`);
    }

    card.innerHTML=`
        <div style="display:flex; justify-content:space-between; align-items:center;">
             <div style="display:flex; align-items:center;">
                <img src="${recipe.icon}" style="width:32px; height:32px; margin-right:10px; object-fit:contain;">
                <h4 style="margin:0">${recipe.name}</h4>
             </div>
        </div>
        <div style="margin: 10px 0; font-size: 0.9em;">
            Cost: ${costText.join(', ')}
        </div>
        <button class="upgrade-btn select-btn" ${!canAfford? 'disabled':''} style="width:100%" onclick="handleCraftItem('${recipe.type}')">
            Fabricate
        </button>
    `;

    craftingListEl.appendChild(card);
  });
}

window.handleCraftItem=function(itemType) {
  socket.emit('craftItem', {type: itemType}, (response) => {
    if (response.success) {
      soundManager.playSound('click'); // Or a generic crafting sound
      const status=document.getElementById('craftingStatus');
      if (status) {
        status.textContent='Item fabricated successfully!';
        status.style.color='#4f4';
        setTimeout(() => status.textContent='', 2000);
      }
    } else {
      const status=document.getElementById('craftingStatus');
      if (status) {
        status.textContent=`Fabrication failed: ${response.reason}`;
        status.style.color='#f44';
      }
    }
  });
};

// ============================================
// CABLE SYSTEM LOGIC
// ============================================
// Local reference not needed as we rely on server state (gameState.cables)
// but can keep for prediction/smoothness if needed, but omitted for simplicity.

function getNearestInteractable(x, y) {
  const interactRadius=30;

  // Check Spools
  if (gameState.cables) {
    for (const c of gameState.cables) {
      if (c.isSpool) {
        const dx=x-c.x2;
        const dy=y-c.y2;
        if (dx*dx+dy*dy<interactRadius*interactRadius) {
          return {type: 'spool', id: c.id, x: c.x2, y: c.y2, cableType: c.type};
        }
      }
    }
  }

  // Check Buildings
  if (gameState.activeBuildings) {
    for (const b of gameState.activeBuildings) {
      const dx=x-b.x;
      const dy=y-b.y;
      if (dx*dx+dy*dy<50*50) {
        return {type: 'building', id: b.id, x: b.x, y: b.y};
      }
    }
  }

  // Check Helper: Base/Pad
  if (gameState.activeBuildings&&gameState.activeBuildings.length===0&&gameState.landingPadPosition) {
    // If no buildings found yet, allow base attach
    // Actually activeBuildings should contain LANDING_PAD if it's considered a building. 
    // Server Game.js: getActiveBuildings iterates 'this.buildings'. 'landing_pad' is one.
    // So handled above.
  }
  // Fallback if landing pad isn't in activeBuildings for some reason
  if (gameState.landingPadPosition) {
    const dx=x-gameState.landingPadPosition.x;
    const dy=y-gameState.landingPadPosition.y;
    if (dx*dx+dy*dy<60*60) {
      return {type: 'building', id: 'landing_pad', x: gameState.landingPadPosition.x, y: gameState.landingPadPosition.y};
    }
  }

  return null;
}

window.addEventListener('cableClick', (e) => {
  if (!renderer||!myId) return;

  const worldX=renderer.cameraX+e.detail.x;
  const worldY=renderer.cameraY+e.detail.y;
  const cableType=input.state.cableType||'power';
  const target=getNearestInteractable(worldX, worldY);

  // Check if we are currently dragging a line (Server state)
  const activeLine=gameState.cables? gameState.cables.find(c => c.isPreview&&c.playerId===myId):null;

  if (activeLine) {
    // FINISH ACTION (Attach or Drop)
    if (target) {
      // Attach to target
      socket.emit('cableAction', {action: 'attach', x: target.x, y: target.y, targetId: target.id});
      soundManager.playSound('ui_click');
    } else {
      // Check for wall attach or drop
      const gridX=Math.floor(worldX/renderer.tileSize);
      const gridY=Math.floor(worldY/renderer.tileSize);
      let isWall=false;
      if (renderer.voxelMap&&renderer.voxelMap[gridY]&&renderer.voxelMap[gridY][gridX]>0) {
        isWall=true;
      }

      if (isWall) {
        socket.emit('cableAction', {action: 'attach', x: worldX, y: worldY});
        soundManager.playSound('ui_click');
      } else {
        socket.emit('cableAction', {action: 'drop', x: worldX, y: worldY});
        soundManager.playSound('ui_click');
      }
    }
  } else {
    // START ACTION (Start or Pickup)
    if (target) {
      if (target.type==='spool') {
        socket.emit('cableAction', {action: 'pickup', spoolId: target.id});
        soundManager.playSound('ui_click');
      } else {
        socket.emit('cableAction', {action: 'start', x: target.x, y: target.y, type: cableType, anchorId: target.id});
        soundManager.playSound('ui_click');
      }
    } else {
      renderer.showMessage("Must start at Base, Connector, or Spool");
    }
  }
});

function updateCablePreview() {
  if (!input||!input.cableMode||!renderer) return;

  const worldMouseX=renderer.cameraX+input.mouseX;
  const worldMouseY=renderer.cameraY+input.mouseY;
  const target=getNearestInteractable(worldMouseX, worldMouseY);
  const activeLine=gameState.cables? gameState.cables.find(c => c.isPreview&&c.playerId===myId):null;

  const ctx=renderer.ctx;
  ctx.save();
  ctx.font='12px Consolas, monospace'; // Monospace for tech feel
  ctx.textAlign='center';
  ctx.lineWidth=2;

  let actionText="";
  let color='#fff';

  if (activeLine) {
    // Dragging mode
    if (target) {
      if (target.type==='spool') {
        if (activeLine.type!==target.cableType) {
          actionText="WRONG TYPE";
          color='#f44';
        } else {
          actionText="EXTEND";
          color='#4f4';
        }
      } else {
        actionText="ATTACH";
        color='#4f4';
      }

      // Draw target highlight
      ctx.beginPath();
      ctx.arc(target.x-renderer.cameraX, target.y-renderer.cameraY, 25, 0, Math.PI*2);
      ctx.strokeStyle=color;
      ctx.stroke();
    } else {
      // Check wall
      const gridX=Math.floor(worldMouseX/renderer.tileSize);
      const gridY=Math.floor(worldMouseY/renderer.tileSize);
      const isWall=renderer.voxelMap&&renderer.voxelMap[gridY]&&renderer.voxelMap[gridY][gridX]>0;

      if (isWall) {
        actionText="ATTACH (WALL)";
        color='#ff8';
      } else {
        actionText="DROP";
        color='#aaf';
      }
    }
  } else {
    // Start mode
    if (target) {
      if (target.type==='spool') {
        actionText="PICKUP";
        color='#4ff';
      } else {
        actionText="START";
        color='#4f4';
      }
      // Draw target highlight
      ctx.beginPath();
      ctx.arc(target.x-renderer.cameraX, target.y-renderer.cameraY, 25, 0, Math.PI*2);
      ctx.strokeStyle=color;
      ctx.stroke();
    } else {
      actionText=""; // Don't show text if nothing to do
    }
  }

  if (actionText) {
    const sx=input.mouseX;
    const sy=input.mouseY-25;

    // Text background
    const metrics=ctx.measureText(actionText);
    const tw=metrics.width;
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.fillRect(sx-tw/2-5, sy-12, tw+10, 16);

    ctx.fillStyle=color;
    ctx.fillText(actionText, sx, sy);
  }

  ctx.restore();
}

function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (currentRoom&&renderer) {
    renderer.draw(gameState, myId);

    // Draw cables overlay
    if (gameState.cables) {
      renderer.drawCables(gameState.cables, gameState.players, renderer.cameraX, renderer.cameraY);
    }
    // Draw cable placement preview
    updateCablePreview();


    if (input) {
      const myPlayer=gameState.players.find(p => p.id===myId);
      if (myPlayer&&!myPlayer.dead) {
        renderer.setMousePos(input.mouseX, input.mouseY);
        input.updateSpotlight(myPlayer.x, myPlayer.y, renderer.cameraX, renderer.cameraY);

        // Update DOM Quickbar
        renderQuickbar(myPlayer);

        // Update thrust sound - don't play if no fuel
        const hasFuel=myPlayer.fuel>0;
        soundManager.setThrust(input.state.up&&hasFuel, hasFuel);

        // Out of fuel sound - play once when fuel reaches 0
        if (myPlayer.fuel<=0&&lastFuel>0) {
          soundManager.playOutOfFuel();
        }
        // Reset out of fuel flag when refueled
        if (myPlayer.fuel>0&&lastFuel<=0) {
          soundManager.resetOutOfFuel();
        }
        lastFuel=myPlayer.fuel;

        // Check for held cable item (Factorio-style build mode)
        // input.quickbarSelection is 0-8 (index)
        // We need to check myPlayer.cargo[index]
        if (input.quickbarSelection!==undefined&&myPlayer.cargo) {
          const heldItem=myPlayer.cargo[input.quickbarSelection];
          if (heldItem&&heldItem.type&&typeof heldItem.type==='string'&&(heldItem.type.startsWith('cable_spool_')||heldItem.type.startsWith('cable_'))) {
            // Enable cable mode
            input.setCableMode(true);
            input.state.cableMode=true;
            let cType=heldItem.type.replace('cable_spool_', '').replace('cable_', '');
            input.state.cableType=cType;
          } else {
            input.setCableMode(false);
            input.state.cableMode=false;
          }
        } else {
          input.setCableMode(false);
          input.state.cableMode=false;
        }

        // Update mining sound - Fix: only when actually mining resources
        const canMine=(myPlayer.power>=(myPlayer.miningPowerDrain||7.5)*0.1);
        const isActuallyMining=myPlayer.mining&&canMine&&myPlayer.isMiningResource;
        soundManager.setMining(isActuallyMining);

        // Update heartbeat sound (EVA low oxygen)
        const isLowOxygen=myPlayer.shipType==='eva'&&myPlayer.oxygen<25;
        soundManager.setHeartbeat(isLowOxygen);

        // Batch 2 features
        // Transfer cargo sound
        soundManager.setTransferring(myPlayer.transferring);

        // Refueling sound
        const isRefueling=myPlayer.onPad&&myPlayer.fuel<(myPlayer.maxFuel||500);
        soundManager.setRefueling(isRefueling);

        // Power down sound
        if (myPlayer.power<=0&&lastPower>0) {
          soundManager.playPowerDown();
        }
        lastPower=myPlayer.power;

        // Low fuel warning - should cease when fuel reaches 0
        const isLowFuel=(myPlayer.fuel/(myPlayer.maxFuel||500))<0.25&&myPlayer.fuel>0&&!myPlayer.onPad;
        soundManager.setLowFuelWarning(isLowFuel);


        wasOnPad=myPlayer.onPad;

      } else {
        // Stop sounds if dead
        soundManager.setThrust(false);
        soundManager.setMining(false);
        soundManager.setHeartbeat(false);
        soundManager.setTransferring(false);
        soundManager.setRefueling(false);
        soundManager.setLowFuelWarning(false);

        // Fix: Death music bug
        if (myPlayer&&myPlayer.dead&&!wasDead) {
          soundManager.playDeathMusic();
        }
      }

      // Refinery sound
      const isRefining=gameState.refining; // Assuming this is in gameState
      soundManager.setRefining(isRefining);

      wasDead=myPlayer? myPlayer.dead:false;
    }
  }
}

// Global escape key listener to close menus
window.addEventListener('keydown', (e) => {
  if (e.key==='Escape') {
    // Hide all menus
    const menus=['inventoryMenu', 'stationMenu'];
    menus.forEach(id => {
      const el=document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }
});

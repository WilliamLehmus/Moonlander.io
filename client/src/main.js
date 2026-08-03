import './style.css';
import {io} from 'socket.io-client';
import {Renderer, CABLE_ATTACH_RANGE} from './Renderer.js';
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
  // Building kits are carried cargo like anything else -- give them their own
  // colour so a hold with a kit in it is readable at a glance.
  if (typeof type==='string'&&type.startsWith('kit_')) return '#7aa7d9';
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

// Depth-triggered story transmissions. Queued so two beats crossed in quick
// succession do not overwrite each other.
const storyQueue=[];
let activeStoryBeat=null;

socket.on('storyBeat', (beat) => {
  storyQueue.push(beat);
  soundManager.playSound('message_notification_short');
});

function updateStoryOverlay() {
  if (!renderer) return;
  const now=Date.now();

  if (!activeStoryBeat&&storyQueue.length>0) {
    activeStoryBeat={...storyQueue.shift(), shownAt: now};
  }
  if (!activeStoryBeat) return;

  // Long enough to read three lines, then it fades out on its own.
  const HOLD=11000;
  const age=now-activeStoryBeat.shownAt;
  if (age>HOLD) {activeStoryBeat=null; return;}

  renderer.drawStoryBeat(activeStoryBeat, age, HOLD);
}

socket.on('gameOver', (data) => {
  if (gameOverMenuEl) {
    if (data.won) {
      if (gameOverModalContent) gameOverModalContent.className='modal-content game-over-content victory-theme';
      if (gameOverBadge) gameOverBadge.textContent='MISSION ACCOMPLISHED';
      if (gameOverTitle) gameOverTitle.textContent='LUNAR CORE REACHED!';
      const reached=(data.depth||0).toLocaleString();
      const reveal=data.reveal;
      if (gameOverSubtitle) {
        gameOverSubtitle.innerHTML=reveal
          ? `<span style="color:#ff5544; font-size:0.8em; letter-spacing:1px">${reveal.from}</span><br>`+
            reveal.lines.map(l => `<span style="display:block; margin-top:6px">${l}</span>`).join('')+
            `<span style="display:block; margin-top:10px; opacity:0.6; font-size:0.85em">${reached}m beneath the Sea of Tranquility.</span>`
          : `You reached ${reached}m beneath the Sea of Tranquility.`;
      }
      soundManager.playSound('victory');
    } else {
      if (gameOverModalContent) gameOverModalContent.className='modal-content game-over-content defeat-theme';
      if (gameOverBadge) gameOverBadge.textContent='MISSION FAILED';
      if (gameOverTitle) gameOverTitle.textContent='COLONY LOST';
      if (gameOverSubtitle) gameOverSubtitle.textContent='All landers were destroyed and no spare parts remain for respawn.';
    }

    if (statEndingTime) statEndingTime.textContent=formatDuration(data.time||0);
    // Real measured depth from the server, not a hardcoded string.
    if (statEndingDepth) statEndingDepth.textContent=`${(data.depth||0).toLocaleString()}m`;
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
    // Cancel an armed building placement before falling through to the menu,
    // so ESC means "back out of what I am doing" rather than opening a modal.
    if (placementType) {
      cancelPlacement();
      return;
    }
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
  if (typeof type==='string'&&type.startsWith('kit_')) {
    return type.slice(4).replace(/_/g, ' ').toUpperCase()+' KIT';
  }
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

// ============================================
// NETWORK STATUS UI  (GDD 6.6)
// ============================================
// Shared vocabulary for the three networks. Function first, colour second --
// the name is what teaches a new player what the colour is for.
const NET_INFO={
  power: {label: 'Power', item: 'Power Cable (Red)', colour: '#ff4444', dim: 'rgba(255,68,68,0.35)'},
  fuel: {label: 'Fuel', item: 'Fuel Pipe (Green)', colour: '#44dd55', dim: 'rgba(68,221,85,0.35)'},
  data: {label: 'Data', item: 'Data Cable (Blue)', colour: '#4488ff', dim: 'rgba(68,136,255,0.35)'}
};

// Must match difficulty.buildCableMaxLength on the server (default 120).
const CABLE_MAX_RUN=120;

// Normalises every cable vocabulary the client deals with ('red', 'cable_red',
// 'power') down to the three network keys the server uses.
function cableNet(raw) {
  if (!raw) return null;
  const s=String(raw).toLowerCase();
  if (s.includes('power')||s.includes('red')) return 'power';
  if (s.includes('fuel')||s.includes('green')) return 'fuel';
  if (s.includes('data')||s.includes('blue')) return 'data';
  return null;
}

// Base Grid panel: supply vs demand, fuel on the network, and the data net.
function renderBaseGridPanel() {
  const net=gameState.networks;
  if (!net||!net.totals) return '';

  const t=net.totals;
  const strained=t.demand>t.supply;
  const shedding=(t.shed||[]).length>0;
  const powerColour=shedding? '#ff4444':(strained? '#ffaa00':'#44dd55');
  const loadPct=t.supply>0? Math.min(100, t.demand/t.supply*100):100;
  const bufPct=t.bufferCapacity>0? Math.min(100, t.buffer/t.bufferCapacity*100):0;

  // Fuel reachable over green pipe, plus whatever is in the pad's own tank.
  const fuelNets=net.fuel||[];
  const padTank=fuelNets.reduce((sum, f) => sum+(f.tanks?.landing_pad||0), 0);
  const pool=fuelNets.reduce((sum, f) => Math.max(sum, f.pool||0), 0);

  const dataNets=net.data||[];
  const antennaCount=dataNets.reduce((n, d) => n+d.coverage.length, 0);
  const reach=dataNets.reduce((m, d) => Math.max(m, ...d.coverage.map(c => c.r)), 0);

  const shedNames=(t.shed||[]).map(id => net.nodes?.[id]?.name||id);

  return `
    <div class="status-bar-item">
      <div class="status-bar-label">
        <span>POWER GRID</span>
        <span class="status-bar-val" style="color:${powerColour}">${t.demand} / ${t.supply} kW</span>
      </div>
      <div class="status-bar-track"><div class="status-bar-fill" style="width:${loadPct}%; background:${powerColour};"></div></div>
      <div class="status-bar-label" style="margin-top:3px; font-size:0.7rem; opacity:0.75">
        <span>BUFFER</span><span class="status-bar-val">${t.buffer} / ${t.bufferCapacity} kJ</span>
      </div>
      <div class="status-bar-track" style="height:4px"><div class="status-bar-fill" style="width:${bufPct}%; background:#0af;"></div></div>
      ${shedding? `<div style="margin-top:4px; font-size:0.72rem; color:#ff6666">⚠ SHEDDING: ${shedNames.join(', ')}</div>`:''}
      ${!shedding&&strained? `<div style="margin-top:4px; font-size:0.72rem; color:#ffaa00">⚠ Demand exceeds supply — running on buffer</div>`:''}
    </div>
    <div class="status-bar-item">
      <div class="status-bar-label">
        <span>FUEL NETWORK</span>
        <span class="status-bar-val" style="color:${padTank>0? '#44dd55':'#ff4444'}">Pad ${Math.floor(padTank)}</span>
      </div>
      <div class="status-bar-track"><div class="status-bar-fill" style="width:${Math.min(100, padTank/500*100)}%; background:#44dd55;"></div></div>
      <div style="margin-top:3px; font-size:0.7rem; opacity:0.75">Colony reserve ${Math.floor(pool)}${padTank<=0? ' — <span style="color:#ff6666">pad tank empty, cannot refuel</span>':''}</div>
    </div>
    <div class="status-bar-item">
      <div class="status-bar-label">
        <span>DATA NET</span>
        <span class="status-bar-val" style="color:${antennaCount>0? '#4488ff':'#ff4444'}">${dataNets.length} net${dataNets.length===1? '':'s'}</span>
      </div>
      <div style="margin-top:3px; font-size:0.7rem; opacity:0.75">
        ${antennaCount>0? `${antennaCount} antenna${antennaCount===1? '':'s'} · ${reach}m widest coverage`:'No antenna on air — minimap is static'}
      </div>
    </div>
  `;
}

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
      ${renderBaseGridPanel()}
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

    // Buildings are placed instances now, so a type can exist several times.
    const instances=b.instances||[];
    const instanceHtml=instances.length
      ? `<div style="margin:6px 0; font-size:0.72rem; color:#8b95a1">${
          instances.map(i => `<div style="display:flex; align-items:center; gap:6px; margin:2px 0">
              <span style="color:${i.powered? '#44dd55':'#ff5555'}">●</span>
              <span style="flex:1">${i.id} Lv${i.level}${i.powered? '':' <span style="color:#ff7777">(no power)</span>'}</span>
              <button class="upgrade-btn" style="padding:1px 6px; font-size:0.9em"
                      onclick="handleUpgradeBuilding('${i.id}')">▲</button>
              <button class="upgrade-btn" style="padding:1px 6px; font-size:0.9em; background:#5a2222"
                      onclick="handleDemolishBuilding('${i.id}')" title="Demolish (50% refund)">✕</button>
            </div>`).join('')
        }</div>`
      : '';

    card.innerHTML=`
        <div class="building-header" style="display:flex; justify-content:space-between; align-items:center">
            <h4 style="margin:0">${b.name} <span class="level-badge" style="background:#444; padding:2px 5px; border-radius:3px; font-size:0.7em">${instances.length? `x${instances.length}`:'not built'}</span></h4>
            ${!isBuilt? '<span class="new-badge" style="background:#f90; color:#000; padding:2px 5px; border-radius:3px; font-size:0.7em; font-weight:bold">NEW</span>':''}
        </div>
        <p class="building-desc" style="font-size: 0.8rem; color: #aaa; margin: 5px 0;">Effect: ${b.currentEffect||'None'} ${!isMax? '-> Increase':''}</p>
        ${instanceHtml}
        ${costHtml}
        <div style="display:flex; gap:6px; margin-top:8px">
          <button class="upgrade-btn select-btn" style="flex:1" onclick="handleCraftKit('${key}')">
              Craft Kit
          </button>
          <button class="upgrade-btn select-btn" style="flex:1" onclick="handlePlaceBuilding('${key}')">
              Place
          </button>
          <button class="upgrade-btn select-btn" ${!b.canUpgrade||isMax||!isBuilt? 'disabled':''} style="flex:1" onclick="handleUpgradeBuilding('${key}')">
              ${isMax? 'Max Level':'Upgrade'}
          </button>
        </div>
    `;

    buildingListEl.appendChild(card);
  });
}

// Make it global so HTML onclick works
// ---- Building placement mode -------------------------------------------
// "Build New" arms a ghost; the next world click places it. Escape cancels.
let placementType=null;

const PLACE_ERRORS={
  outside_build_zone: 'Outside the build zone — must be within range of a Landing Pad',
  too_close_to_building: 'Too close to another building',
  blocked_by_terrain: 'No headroom — that spot is inside rock',
  insufficient_materials: 'Not enough materials',
  unknown_building: 'Unknown building type',
  no_kit: 'No kit in the hold — craft one at a base and fly it here',
  must_be_at_base: 'Land at a base to craft a kit',
  no_cargo_space: 'No free cargo slot for the kit'
};

// Buildings are hauled: crafted into a kit at a base, flown to the site, and
// spent there. Crafting is where the materials are paid.
window.handleCraftKit=function(type) {
  socket.emit('craftBuildingKit', {type}, (res) => {
    const name=gameState.buildings?.[type]?.name||type;
    if (res&&res.success) {
      soundManager.playSound('ui_click');
      renderer?.showMessage(`${name} kit loaded into the hold — fly it to the site and press Place`);
      renderBuildingList();
    } else {
      renderer?.showMessage(PLACE_ERRORS[res?.reason]||`Cannot craft kit: ${res?.reason||'unknown'}`);
    }
  });
};

window.handlePlaceBuilding=function(type) {
  placementType=type;
  if (input) input.placementMode=true;
  // Get out of the menu so the player can see where they are putting it.
  if (stationMenuEl) stationMenuEl.classList.add('hidden');
  const name=gameState.buildings?.[type]?.name||type;
  renderer?.showMessage(`Placing ${name} — click a spot inside the build zone (ESC to cancel)`);
};

function cancelPlacement() {
  if (!placementType) return;
  placementType=null;
  if (input) input.placementMode=false;
  renderer?.showMessage('Placement cancelled');
}

window.addEventListener('placementClick', (e) => {
  if (!placementType||!renderer) return;
  const worldX=renderer.cameraX+e.detail.x;
  const worldY=renderer.cameraY+e.detail.y;

  socket.emit('placeBuilding', {type: placementType, x: worldX, y: worldY}, (res) => {
    if (res&&res.success) {
      soundManager.playSound('ui_click');
      renderer.showMessage(`${gameState.buildings?.[placementType]?.name||placementType} constructed`);
      placementType=null;
      if (input) input.placementMode=false;
    } else {
      // Stay armed so the player can just click somewhere better.
      renderer.showMessage(PLACE_ERRORS[res?.reason]||`Cannot build here: ${res?.reason||'unknown'}`);
    }
  });
});

const DEMOLISH_ERRORS={
  cannot_demolish_habitat: 'The Habitat is the colony — it cannot be demolished',
  last_landing_pad: 'That is your only Landing Pad — you would have nowhere to land',
  no_such_building: 'That building no longer exists'
};

window.handleDemolishBuilding=function(instanceId) {
  socket.emit('demolishBuilding', {instanceId}, (res) => {
    if (res&&res.success) {
      const parts=Object.entries(res.refund||{}).map(([m, a]) => `${a} ${m}`);
      renderer?.showMessage(parts.length? `Demolished — recovered ${parts.join(', ')}`:'Demolished');
      soundManager.playSound('ui_click');
      renderBuildingList();
    } else {
      renderer?.showMessage(DEMOLISH_ERRORS[res?.reason]||`Cannot demolish: ${res?.reason||'unknown'}`);
    }
  });
};

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

// Finds what the cursor is over, but only if the PLAYER is close enough to
// reach it. The cursor picks the target; the player's body decides whether it
// is legal. Without the second test you could wire two buildings a kilometre
// apart with two clicks and never walk the cable anywhere.
//
// `heldNet` filters out buildings that do not use the network being carried,
// so green pipe simply cannot see a power-only building as a target.
function getNearestInteractable(x, y, heldNet=null) {
  const cursorRadius=40;
  const me=gameState.players?.find(p => p.id===myId);
  const inPlayerRange=(tx, ty) => me&&Math.hypot(tx-me.x, ty-me.y)<=CABLE_ATTACH_RANGE;

  // Spools first -- they sit on top of everything else.
  if (gameState.cables) {
    for (const c of gameState.cables) {
      if (!c.isSpool) continue;
      if (Math.hypot(x-c.x2, y-c.y2)>cursorRadius) continue;
      if (!inPlayerRange(c.x2, c.y2)) return {type: 'spool', id: c.id, x: c.x2, y: c.y2, cableType: c.type, outOfRange: true};
      return {type: 'spool', id: c.id, x: c.x2, y: c.y2, cableType: c.type};
    }
  }

  // Buildings. Prefer the network status list, which carries per-network
  // capability; fall back to activeBuildings if it has not arrived yet.
  const nodes=gameState.networks?.nodes;
  const candidates=nodes
    ? Object.values(nodes).map(n => ({id: n.id, x: n.x, y: n.y, name: n.name, node: n}))
    : (gameState.activeBuildings||[]).map(b => ({id: b.id, x: b.x, y: b.y, name: b.id, node: null}));

  let best=null;
  let bestDist=cursorRadius;
  for (const b of candidates) {
    const d=Math.hypot(x-b.x, y-b.y);
    if (d>bestDist) continue;
    // A building that does not use the held network is not a target at all.
    if (heldNet&&b.node&&(!b.node[heldNet]||b.node[heldNet]==='na')) continue;
    best=b;
    bestDist=d;
  }

  if (best) {
    return {
      type: 'building',
      id: best.id,
      x: best.x,
      y: best.y,
      name: best.name,
      outOfRange: !inPlayerRange(best.x, best.y)
    };
  }

  return null;
}

// Turns a server failure code into something a player can act on. Every one of
// these used to fail silently, which is most of why cables felt broken.
const CABLE_ERRORS={
  no_materials: 'Not enough Basic material — each cable run costs 1',
  too_long: `Too far from the last anchor — runs are max ${CABLE_MAX_RUN}m`,
  cable_type_mismatch: 'That spool is a different cable type',
  invalid_cable_type: 'Unknown cable type',
  out_of_range: 'Move closer to attach',
  no_active_line: 'Start a run at a building first'
};

function cableResult(res) {
  if (!res) return;
  if (res.success) {
    soundManager.playSound('ui_click');
    return;
  }
  renderer.showMessage(CABLE_ERRORS[res.reason]||`Cable failed: ${res.reason||'unknown'}`);
}

window.addEventListener('cableClick', (e) => {
  if (!renderer||!myId) return;

  const heldNet=cableNet(input.state.cableType);
  if (!heldNet) {
    renderer.showMessage('Hold a cable to build — craft one at the Crafting Station, then select it (1-9)');
    return;
  }

  const worldX=renderer.cameraX+e.detail.x;
  const worldY=renderer.cameraY+e.detail.y;
  const target=getNearestInteractable(worldX, worldY, heldNet);

  if (target&&target.outOfRange) {
    renderer.showMessage(`Too far — fly closer to ${target.name||'the connector'} to attach`);
    return;
  }

  // Check if we are currently dragging a line (Server state)
  const activeLine=gameState.cables? gameState.cables.find(c => c.isPreview&&c.playerId===myId):null;

  if (activeLine) {
    // FINISH ACTION (Attach or Drop)
    if (target) {
      socket.emit('cableAction', {action: 'attach', x: target.x, y: target.y, targetId: target.id}, cableResult);
    } else {
      // Attaching to solid rock plants a pylon and keeps the run going.
      const gridX=Math.floor(worldX/renderer.tileSize);
      const gridY=Math.floor(worldY/renderer.tileSize);
      const isWall=renderer.voxelMap&&renderer.voxelMap[gridY]&&renderer.voxelMap[gridY][gridX]>0;

      socket.emit('cableAction', {
        action: isWall? 'attach':'drop',
        x: worldX,
        y: worldY
      }, cableResult);
    }
  } else {
    // START ACTION (Start or Pickup)
    if (!target) {
      renderer.showMessage('Start a run at a building connector or a dropped spool');
      return;
    }
    if (target.type==='spool') {
      socket.emit('cableAction', {action: 'pickup', spoolId: target.id}, cableResult);
    } else {
      socket.emit('cableAction', {
        action: 'start',
        x: target.x,
        y: target.y,
        type: heldNet,
        anchorId: target.id
      }, cableResult);
    }
  }
});

function updateCablePreview() {
  if (!input||!input.cableMode||!renderer) return;

  const heldNet=cableNet(input.state.cableType);
  const worldMouseX=renderer.cameraX+input.mouseX;
  const worldMouseY=renderer.cameraY+input.mouseY;
  const target=getNearestInteractable(worldMouseX, worldMouseY, heldNet);
  const activeLine=gameState.cables? gameState.cables.find(c => c.isPreview&&c.playerId===myId):null;
  const me=gameState.players?.find(p => p.id===myId);

  const ctx=renderer.ctx;
  ctx.save();
  ctx.font='12px Consolas, monospace'; // Monospace for tech feel
  ctx.textAlign='center';
  ctx.lineWidth=2;

  let actionText="";
  let color='#fff';

  // While a run is live, show how much of it is left. This is the single most
  // useful number when laying cable and it was never displayed.
  if (activeLine&&me) {
    const runLen=Math.hypot(me.x-activeLine.x1, me.y-activeLine.y1);
    const frac=Math.min(1, runLen/CABLE_MAX_RUN);
    const barW=140;
    const bx=renderer.canvas.width/2-barW/2;
    const by=renderer.canvas.height-96;
    const overrun=runLen>CABLE_MAX_RUN;

    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillRect(bx-4, by-14, barW+8, 26);
    ctx.fillStyle='#333';
    ctx.fillRect(bx, by, barW, 6);
    ctx.fillStyle=overrun? '#ff4444':(frac>0.8? '#ffaa00':(NET_INFO[heldNet]?.colour||'#fff'));
    ctx.fillRect(bx, by, barW*frac, 6);

    ctx.fillStyle=overrun? '#ff6666':'#ddd';
    ctx.fillText(
      overrun? `RUN TOO LONG — ${Math.round(runLen)}/${CABLE_MAX_RUN}m, anchor sooner`
        :`RUN ${Math.round(runLen)} / ${CABLE_MAX_RUN}m`,
      bx+barW/2, by-3);
  }

  if (activeLine) {
    // Dragging mode
    if (target) {
      if (target.type==='spool') {
        if (cableNet(activeLine.type)!==cableNet(target.cableType)) {
          actionText="WRONG TYPE";
          color='#f44';
        } else {
          actionText="EXTEND";
          color='#4f4';
        }
      } else {
        actionText=`ATTACH → ${target.name||''}`.trim();
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
        actionText="ANCHOR TO ROCK";
        color='#ff8';
      } else {
        actionText="DROP SPOOL";
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
        actionText=`START ${NET_INFO[heldNet]?.label.toUpperCase()||''} RUN`;
        color=NET_INFO[heldNet]?.colour||'#4f4';
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

  // Out-of-range targets are shown, but greyed and named, so the player learns
  // "fly closer" rather than clicking a dead target repeatedly.
  if (target&&target.outOfRange) {
    actionText='TOO FAR — FLY CLOSER';
    color='#888';
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

    // Network state overlays (GDD 6.6). Order matters: the cable-carrying
    // highlight dims the world, so it goes under the port dots and the preview.
    const myPlayerForNet=gameState.players?.find(p => p.id===myId);
    if (input?.cableMode) {
      renderer.drawCableTargeting(gameState, cableNet(input.state.cableType), myPlayerForNet,
        renderer.cameraX, renderer.cameraY);
    }
    renderer.drawNetworkStatus(gameState, renderer.cameraX, renderer.cameraY);
    if (input?.networkOverlay) {
      renderer.drawNetworkOverlay(gameState, renderer.cameraX, renderer.cameraY);
    }

    // Draw cable placement preview
    updateCablePreview();

    // Building placement ghost.
    if (placementType) {
      renderer.drawPlacementPreview(gameState, placementType,
        renderer.cameraX+input.mouseX, renderer.cameraY+input.mouseY,
        renderer.cameraX, renderer.cameraY);
    }

    // Story transmissions sit above everything else.
    updateStoryOverlay();


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

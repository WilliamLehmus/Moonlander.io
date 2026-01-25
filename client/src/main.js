import './style.css';
import {io} from 'socket.io-client';
import {Renderer} from './Renderer.js';
import {Input} from './Input.js';
import {SoundManager} from './SoundManager.js';

// Determine server URL (localhost for dev, same origin for production)
const serverUrl=window.location.hostname==='localhost'
  ? 'http://localhost:3000'
  :window.location.origin;

const socket=io(serverUrl);

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

// Initialize audio on first user interaction
document.addEventListener('click', () => {
  const splash=document.getElementById('splashScreen');
  if (splash) {
    splash.style.opacity='0';
    setTimeout(() => splash.classList.add('hidden'), 1000);
  }

  if (!soundManager.soundsLoaded) {
    soundManager.loadSounds().then(() => {
      if (!currentRoom) {
        soundManager.playMenuMusic();
      }
    });
  }
}, {once: true});


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

  // Start game loop if not running
  if (!gameLoopRunning) {
    gameLoopRunning=true;
    gameLoop();
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

  clearMessages();
}

function updatePlayerCount(count) {
  playerCountEl.textContent=`${count} player${count!==1? 's':''}`;
}

function toggleMenu() {
  isMenuOpen=!isMenuOpen;
  if (isMenuOpen) {
    escapeMenuEl.classList.remove('hidden');
    soundManager.playSound('menu_pop');
  } else {
    escapeMenuEl.classList.add('hidden');
    soundManager.playSound('menu_pop');
  }
}

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
});

// ============================================
// STATION MENU FUNCTIONS
// ============================================

function openStationMenu() {
  stationMenuEl.classList.remove('hidden');
  soundManager.playSound('menu_pop');
  renderShipList();
  renderBuildingList();
}

function closeStationMenu() {
  stationMenuEl.classList.add('hidden');
  soundManager.playSound('menu_pop');
}

closeStationBtn.addEventListener('click', closeStationMenu);

// Tab switching
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Deactivate all
    tabBtns.forEach(b => b.classList.remove('active'));
    stationTabs.forEach(t => t.classList.add('hidden'));

    // Activate selected
    btn.classList.add('active');
    const tabId=`tab-${btn.dataset.tab}`;
    document.getElementById(tabId).classList.remove('hidden');
    soundManager.playSound('menu_pop');
  });
});

const SHIP_TYPES=[
  {id: 'scout', name: 'Scout', cargo: 500, fuel: 500, desc: 'Fast, agile, standard lander.'},
  {id: 'cargo', name: 'Cargo Hauler', cargo: 1500, fuel: 1000, desc: 'Heavy, high capacity. Requires Ship Factory Lv2.', reqFactory: 2}
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
      if (b.nextCost.basic) costs.push(`<span class="cost-basic">${b.nextCost.basic} Bas</span>`);
      if (b.nextCost.industrial) costs.push(`<span class="cost-industrial">${b.nextCost.industrial} Ind</span>`);
      if (b.nextCost.advanced) costs.push(`<span class="cost-advanced">${b.nextCost.advanced} Adv</span>`);
      if (b.nextCost.quantum) costs.push(`<span class="cost-quantum">${b.nextCost.quantum} Qnt</span>`);
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

// ============================================
// GAME LOOP
// ============================================

function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (currentRoom&&renderer) {
    renderer.draw(gameState, myId);

    if (input) {
      const myPlayer=gameState.players.find(p => p.id===myId);
      if (myPlayer&&!myPlayer.dead) {
        renderer.setMousePos(input.mouseX, input.mouseY);
        input.updateSpotlight(myPlayer.x, myPlayer.y, renderer.cameraX, renderer.cameraY);

        // Update thrust sound
        soundManager.setThrust(input.state.up);

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

        // Low fuel warning
        const isLowFuel=(myPlayer.fuel/(myPlayer.maxFuel||500))<0.25&&!myPlayer.onPad;
        soundManager.setLowFuelWarning(isLowFuel);

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

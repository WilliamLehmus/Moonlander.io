import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Game } from './game/Game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from root .env
dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from the client dist directory (for production)
if (process.env.NODE_ENV === 'production') {
    const distPath = join(__dirname, '../client/dist');
    app.use(express.static(distPath));
    console.log('Serving production build from:', distPath);

    // Catch-all route to serve index.html for SPA
    app.get('*', (req, res) => {
        res.sendFile(join(distPath, 'index.html'));
    });
}

const PORT = process.env.PORT || 3010;

// ============================================
// ROOM MANAGEMENT SYSTEM
// ============================================

const rooms = new Map(); // roomCode -> Room object
const playerRooms = new Map(); // socketId -> roomCode

// Generate a random 6-character room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,1,I)
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    // Ensure uniqueness
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    return code;
}

class Room {
    constructor(code, hostId) {
        this.code = code;
        this.hostId = hostId;
        this.game = new Game();
        this.players = new Map(); // socketId -> nickname
        this.gameLoop = null;
        this.ready = false;
    }

    async initialize() {
        // Create a socket.io namespace/room for this game
        this.game.setIO(io, this.code);
        await this.game.init();
        this.ready = true;
        console.log(`Room ${this.code} initialized`);

        // Add any players who joined during initialization
        for (const [socketId, nickname] of this.players) {
            this.game.addPlayer(socketId, nickname);
        }

        // Start game loop for this room
        this.gameLoop = setInterval(() => {
            this.game.update();
            io.to(this.code).emit('gameState', this.game.getState());
        }, 1000 / 60);
    }

    addPlayer(socketId, nickname) {
        this.players.set(socketId, nickname);
        if (this.ready) {
            this.game.addPlayer(socketId, nickname);
        }
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        this.game.removePlayer(socketId);

        // If host leaves or room is empty, destroy the room
        if (this.players.size === 0) {
            this.destroy();
            rooms.delete(this.code);
            console.log(`Room ${this.code} destroyed (empty)`);
        } else if (socketId === this.hostId) {
            // Transfer host to another player
            this.hostId = Array.from(this.players.keys())[0];
            io.to(this.code).emit('hostChanged', { newHostId: this.hostId });
            console.log(`Room ${this.code} host transferred to ${this.hostId}`);
        }
    }

    destroy() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }

    getInfo() {
        return {
            code: this.code,
            hostId: this.hostId,
            playerCount: this.players.size,
            ready: this.ready
        };
    }
}

// ============================================
// SOCKET.IO CONNECTION HANDLING
// ============================================

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Send available actions to new connection
    socket.emit('connected', { id: socket.id });

    // CREATE ROOM
    socket.on('createRoom', async (data, callback) => {
        try {
            const nickname = data?.nickname || 'Explorer';
            // Check if player is already in a room
            if (playerRooms.has(socket.id)) {
                callback({ success: false, error: 'Already in a room' });
                return;
            }

            const code = generateRoomCode();
            const room = new Room(code, socket.id);
            rooms.set(code, room);
            playerRooms.set(socket.id, code);

            socket.join(code);
            room.addPlayer(socket.id, nickname);

            console.log(`Room ${code} created by ${socket.id}`);

            // Initialize the game (async)
            await room.initialize();

            // Send map data to the host
            const mapData = room.game.terrain.serialize();
            mapData.config = room.game.config;
            socket.emit('mapData', mapData);
            socket.emit('joinedRoom', { code, isHost: true });

            callback({ success: true, code });
        } catch (error) {
            console.error('Error creating room:', error);
            callback({ success: false, error: 'Failed to create room: ' + error.message });
        }
    });

    // JOIN ROOM
    socket.on('joinRoom', (data, callback) => {
        const { code, nickname } = data;
        const room = rooms.get(code?.toUpperCase());

        // Check if player is already in a room
        if (playerRooms.has(socket.id)) {
            callback({ success: false, error: 'Already in a room' });
            return;
        }

        // Check if room exists
        if (!room) {
            callback({ success: false, error: 'Room not found' });
            return;
        }

        // Check if room is ready
        if (!room.ready) {
            callback({ success: false, error: 'Room is still initializing' });
            return;
        }

        // Join the room
        socket.join(code);
        playerRooms.set(socket.id, code);
        room.addPlayer(socket.id, nickname || 'Explorer');

        console.log(`Player ${socket.id} joined room ${code}`);

        // Send map data to the joining player
        const mapData = room.game.terrain.serialize();
        mapData.config = room.game.config;
        socket.emit('mapData', mapData);
        socket.emit('joinedRoom', { code, isHost: false });

        // Notify other players
        socket.to(code).emit('playerJoined', { playerId: socket.id, playerCount: room.players.size });

        callback({ success: true, code, playerCount: room.players.size });
    });

    // LEAVE ROOM
    socket.on('leaveRoom', () => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room) {
                room.removePlayer(socket.id);
                socket.leave(code);
                socket.to(code).emit('playerLeft', { playerId: socket.id, playerCount: room.players.size });
            }
            playerRooms.delete(socket.id);
            socket.emit('leftRoom');
            console.log(`Player ${socket.id} left room ${code}`);
        }
    });

    // UPGRADE BUILDING
    socket.on('upgradeBuilding', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.upgradeBuilding(data.buildingKey);
                if (callback) callback({ success: result });
            }
        }
    });

    // CRAFT MATERIAL
    socket.on('craftMaterial', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.craftMaterial(data.tier, data.amount);
                if (callback) callback({ success: result });
            }
        }
    });

    // UPGRADE SHIP
    socket.on('upgradeShip', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.upgradeShip(socket.id, data.upgradeKey);
                if (callback) callback(result);
            }
        }
    });

    // PURCHASE SHIP
    socket.on('purchaseShip', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.purchaseShip(socket.id, data.type);
                if (callback) callback(result);
            }
        }
    });

    // CABLE ACTIONS
    socket.on('cableAction', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const game = room.game;
                let result = { success: false };

                if (data.action === 'start') {
                    result = game.cableSystem.startLine(socket.id, data.x, data.y, data.type, data.anchorId);
                } else if (data.action === 'attach') {
                    result = game.cableSystem.attachLine(socket.id, data.x, data.y, data.targetId);
                } else if (data.action === 'drop') {
                    result = game.cableSystem.dropLine(socket.id, data.x, data.y);
                } else if (data.action === 'pickup') {
                    result = game.cableSystem.pickupSpool(socket.id, data.spoolId);
                }

                if (callback) callback(result);
            }
        }
    });

    // PLACE BUILDING
    socket.on('placeBuilding', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (!code) return;
        const room = rooms.get(code);
        if (room && room.ready) {
            const result = room.game.placeBuilding(socket.id, data.type, data.x, data.y);
            if (callback) callback(result);
        }
    });

    // DEMOLISH BUILDING
    socket.on('demolishBuilding', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (!code) return;
        const room = rooms.get(code);
        if (room && room.ready) {
            const result = room.game.demolishBuilding(socket.id, data.instanceId);
            if (callback) callback(result);
        }
    });

    // CRAFT ITEM
    socket.on('craftItem', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.craftItem(socket.id, data.type);
                if (callback) callback(result);
            }
        }
    });

    // GET ROOM LIST (for debugging/admin)
    socket.on('getRooms', (callback) => {
        const roomList = Array.from(rooms.values()).map(r => r.getInfo());
        callback(roomList);
    });

    // GAME INPUT
    socket.on('input', (input) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                room.game.handleInput(socket.id, input);
            }
        }
    });

    // RESPAWN
    socket.on('respawn', () => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.respawnPlayer(socket.id);
                socket.emit('respawnResult', result);
                if (result.success) {
                    console.log(`Player ${socket.id} respawned in room ${code}`);
                }
            }
        }
    });

    // PING
    socket.on('ping', (data) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const player = room.game.players.get(socket.id);
                if (player && !player.dead) {
                    player.setPing(data.type);
                }
            }
        }
    });

    // TETHER
    socket.on('toggleTether', () => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                room.game.toggleTether(socket.id);
            }
        }
    });

    // JETTISON CARGO
    socket.on('jettisonCargo', () => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const player = room.game.players.get(socket.id);
                if (player && !player.dead) {
                    // Get jettisoned items with physics
                    const droppedItems = room.game.jettisonCargoWithPhysics(socket.id, 0.25);
                    if (droppedItems.length > 0) {
                        const totalAmount = droppedItems.reduce((sum, item) => sum + item.amount, 0);
                        console.log(`Player ${socket.id} jettisoned ${totalAmount} cargo (${droppedItems.length} types)`);
                        socket.emit('cargoJettisoned', { amount: totalAmount });
                        // BROADCAST JETTISON SOUND
                        room.game.broadcast('playSound', { type: 'jettison', playerId: socket.id });
                    }
                }
            }
        }
    });

    // SWITCH SHIP
    socket.on('switchShip', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.switchShip(socket.id, data.type);
                if (callback) callback(result);
            }
        }
    });

    // CHAT MESSAGE
    socket.on('chatMessage', (data) => {
        const code = playerRooms.get(socket.id);
        if (code && data.message && typeof data.message === 'string') {
            const room = rooms.get(code);
            if (!room) return;

            const nickname = room.players.get(socket.id) || 'Explorer';
            const message = data.message.trim().substring(0, 200);
            if (message.length > 0) {
                // Broadcast to all players in room
                io.to(code).emit('chatMessage', {
                    playerId: socket.id,
                    nickname: nickname,
                    message: message,
                    timestamp: Date.now()
                });
                console.log(`[${code}] ${socket.id}: ${message}`);
            }
        }
    });

    // DISCONNECT
    // INVENTORY TRANSFER
    socket.on('transferInventory', (data) => {
        const code = playerRooms.get(socket.id);
        if (!code) return;

        const room = rooms.get(code);
        if (!room || !room.ready) return;

        const game = room.game;
        const player = game.players.get(socket.id);
        if (!player || player.dead) return;

        if (data.from === 'ship' && data.to === 'station') {
            // Transfer cargo from ship to station
            const cargo = player.cargo[data.slotIndex];
            if (cargo) {
                // Map tile type ID to Storage Key
                const idToKey = {
                    10: 'iron', 11: 'copper', 12: 'bitite', 13: 'silver',
                    14: 'titanium', 15: 'gold', 16: 'platinum', 17: 'diamond', 18: 'helium3'
                };
                const storageKey = idToKey[cargo.type];
                if (storageKey && game.baseResources[storageKey] !== undefined) {
                    game.baseResources[storageKey] += cargo.amount;
                    player.cargo.splice(data.slotIndex, 1);
                    console.log(`Transferred ${cargo.amount} of ${storageKey} to station`);
                }
            }
        } else if (data.from === 'station' && data.to === 'ship') {
            // Transfer ore from station to ship
            const idToKey = {
                10: 'iron', 11: 'copper', 12: 'bitite', 13: 'silver',
                14: 'titanium', 15: 'gold', 16: 'platinum', 17: 'diamond', 18: 'helium3'
            };
            const keyToId = Object.fromEntries(Object.entries(idToKey).map(([k, v]) => [v, parseInt(k)]));
            const storageKey = data.oreType.toLowerCase();
            const tileId = keyToId[storageKey];

            if (game.baseResources[storageKey] > 0 && tileId) {
                const currentWeight = player.cargo.reduce((sum, c) => sum + c.amount, 0);
                const maxCargo = player.cargoCapacity || 500;
                const transferAmount = Math.min(game.baseResources[storageKey], maxCargo - currentWeight, 100);

                if (transferAmount > 0) {
                    const existingCargo = player.cargo.find(c => c.type === tileId);
                    if (existingCargo) {
                        existingCargo.amount += transferAmount;
                    } else {
                        player.cargo.push({ type: tileId, amount: transferAmount });
                    }
                    game.baseResources[storageKey] -= transferAmount;
                    console.log(`Transferred ${transferAmount} ${storageKey} to ship`);
                }
            }
        }
    });

    // DEPOSIT ALL ORES
    socket.on('depositAllOres', () => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const player = room.game.players.get(socket.id);
                if (player && !player.dead) {
                    room.game.unloadCargo(player);
                }
            }
        }
    });

    // DROP ITEM (from inventory)
    socket.on('dropItem', (data) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                // Call game method to drop item
                const result = room.game.dropInventoryItem(socket.id, data.slotIndex);
                if (result.success) {
                    console.log(`Player ${socket.id} dropped item from slot ${data.slotIndex}`);
                }
            }
        }
    });

    // PICKUP ITEM (from ground)
    socket.on('pickupItem', (data) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.pickupDroppedItem(socket.id, data.itemId);
            }
        }
    });

    // MOVE ITEM (reorder inventory)
    socket.on('moveItem', (data, callback) => {
        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room && room.ready) {
                const result = room.game.moveInventoryItem(socket.id, data.fromIndex, data.toIndex);
                if (callback) callback(result);
            }
        }
    });

    // NOTE: 'cableAction' is handled once, above. A second listener used to be
    // registered here calling game.handleCableAction(), which meant every cable
    // action ran twice -- placing two segments and charging two materials per click.

    socket.on('debugCommand', (data) => {
        const code = playerRooms.get(socket.id);
        if (!code) return;

        const room = rooms.get(code);
        if (!room || !room.ready) return;

        const game = room.game;
        const player = game.players.get(socket.id);

        console.log(`DEBUG: [Room ${code}] Player ${socket.id} issued ${data.command}`, data);

        switch (data.command) {
            case 'addFuel':
                // Add to base reserves
                game.baseResources.fuel = Math.min(game.baseResources.maxFuel, game.baseResources.fuel + (data.amount || 1000));
                // Also refuel the player ship if they issued the command
                if (player) {
                    player.fuel = player.maxFuel;
                }
                break;

            case 'addParts':
                game.baseResources.spareParts = Math.min(game.baseResources.maxSpareParts, game.baseResources.spareParts + (data.amount || 100));
                break;

            case 'addAllOres':
                const amount = data.amount || 500;
                const ores = ['iron', 'copper', 'bitite', 'silver', 'titanium', 'gold', 'platinum', 'diamond', 'helium3'];
                ores.forEach(key => {
                    if (game.baseResources[key] !== undefined) {
                        game.baseResources[key] = Math.min(game.baseResources.oreCapacity, game.baseResources[key] + amount);
                    }
                });
                break;

            case 'addAllMaterials':
                const matAmount = data.amount || 100;
                const mats = ['basic', 'industrial', 'advanced', 'quantum'];
                mats.forEach(key => {
                    if (game.baseResources[key] !== undefined) game.baseResources[key] += matAmount;
                });
                break;

            case 'repairShip':
                if (player) {
                    player.damage = 0;
                    console.log(`DEBUG: Repaired ship for player ${socket.id}`);
                }
                break;

            case 'spawnItem':
                if (player && data.type) {
                    const pos = player.getPosition();
                    // Spawn single item dropped above player
                    game.spawnDroppedItem(pos.x, pos.y - 60, data.type, data.amount || 1);
                    console.log(`DEBUG: Spawned ${data.type} for player ${socket.id} at (${pos.x}, ${pos.y})`);
                }
                break;

            case 'spawnShip':
                // Spawn a new vehicle at base
                if (game.voxelMap.landingPadPosition) {
                    const pos = game.voxelMap.landingPadPosition;
                    game.spawnVehicle(pos.x, pos.y - 50, data.type || 'scout');
                }
                break;

            case 'teleportBase':
                if (player && game.voxelMap.spawnPosition) {
                    const spawn = game.voxelMap.spawnPosition;
                    player.respawn(spawn.x, spawn.y);
                }
                break;

            case 'maxBuildings':
                // Place one of every building type at its authored position and
                // max it out. Writing game.buildings[key].level directly no
                // longer works: instances in game.structures are the source of
                // truth and syncBuildingLevels() would overwrite it immediately.
                for (const pos of game.voxelMap.buildingPositions || []) {
                    if (!game.buildings[pos.id]) continue;
                    const existing = game.structuresOfType(pos.id)[0];
                    if (existing) existing.level = 4;
                    else game.addStructure(pos.id, pos.x, pos.y, 4);
                }
                game.syncBuildingLevels();
                game.applyBuildingEffects();
                break;

            case 'killPlayer':
                if (player) {
                    player.takeDamage(100);
                }
                break;

            case 'infiniteFuel':
                if (player) {
                    player.infiniteFuel = !!data.enabled;
                }
                break;
        }

        // Broadcast resource update if change might have occurred
        game.broadcast('resourcesUpdated', game.getClientResources());
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const code = playerRooms.get(socket.id);
        if (code) {
            const room = rooms.get(code);
            if (room) {
                room.removePlayer(socket.id);
                socket.to(code).emit('playerLeft', { playerId: socket.id, playerCount: room.players.size });
            }
            playerRooms.delete(socket.id);
        }
    });
});

// ============================================
// START SERVER
// ============================================

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Waiting for players to create or join rooms...');
});

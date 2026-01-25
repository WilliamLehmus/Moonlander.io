import express from 'express';
import {createServer} from 'http';
import {Server} from 'socket.io';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {Game} from './game/Game.js';

const __filename=fileURLToPath(import.meta.url);
const __dirname=dirname(__filename);

const app=express();
const httpServer=createServer(app);
const io=new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from the client dist directory (for production)
if (process.env.NODE_ENV==='production') {
    app.use(express.static(join(__dirname, '../client/dist')));
}

const PORT=process.env.PORT||3000;

// ============================================
// ROOM MANAGEMENT SYSTEM
// ============================================

const rooms=new Map(); // roomCode -> Room object
const playerRooms=new Map(); // socketId -> roomCode

// Generate a random 6-character room code
function generateRoomCode() {
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,1,I)
    let code='';
    for (let i=0; i<6; i++) {
        code+=chars[Math.floor(Math.random()*chars.length)];
    }
    // Ensure uniqueness
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    return code;
}

class Room {
    constructor(code, hostId) {
        this.code=code;
        this.hostId=hostId;
        this.game=new Game();
        this.players=new Set();
        this.gameLoop=null;
        this.ready=false;
    }

    async initialize() {
        // Create a socket.io namespace/room for this game
        this.game.setIO(io, this.code);
        await this.game.init();
        this.ready=true;
        console.log(`Room ${this.code} initialized`);

        // Add any players who joined during initialization
        for (const socketId of this.players) {
            this.game.addPlayer(socketId);
        }

        // Start game loop for this room
        this.gameLoop=setInterval(() => {
            this.game.update();
            io.to(this.code).emit('gameState', this.game.getState());
        }, 1000/60);
    }

    addPlayer(socketId) {
        this.players.add(socketId);
        if (this.ready) {
            this.game.addPlayer(socketId);
        }
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        this.game.removePlayer(socketId);

        // If host leaves or room is empty, destroy the room
        if (this.players.size===0) {
            this.destroy();
            rooms.delete(this.code);
            console.log(`Room ${this.code} destroyed (empty)`);
        } else if (socketId===this.hostId) {
            // Transfer host to another player
            this.hostId=Array.from(this.players)[0];
            io.to(this.code).emit('hostChanged', {newHostId: this.hostId});
            console.log(`Room ${this.code} host transferred to ${this.hostId}`);
        }
    }

    destroy() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop=null;
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
    socket.emit('connected', {id: socket.id});

    // CREATE ROOM
    socket.on('createRoom', async (callback) => {
        try {
            // Check if player is already in a room
            if (playerRooms.has(socket.id)) {
                callback({success: false, error: 'Already in a room'});
                return;
            }

            const code=generateRoomCode();
            const room=new Room(code, socket.id);
            rooms.set(code, room);
            playerRooms.set(socket.id, code);

            socket.join(code);
            room.addPlayer(socket.id);

            console.log(`Room ${code} created by ${socket.id}`);

            // Initialize the game (async)
            await room.initialize();

            // Send map data to the host
            const mapData=room.game.terrain.serialize();
            mapData.config=room.game.config;
            socket.emit('mapData', mapData);
            socket.emit('joinedRoom', {code, isHost: true});

            callback({success: true, code});
        } catch (error) {
            console.error('Error creating room:', error);
            callback({success: false, error: 'Failed to create room: '+error.message});
        }
    });

    // JOIN ROOM
    socket.on('joinRoom', (data, callback) => {
        const code=data.code?.toUpperCase();

        // Check if player is already in a room
        if (playerRooms.has(socket.id)) {
            callback({success: false, error: 'Already in a room'});
            return;
        }

        // Check if room exists
        const room=rooms.get(code);
        if (!room) {
            callback({success: false, error: 'Room not found'});
            return;
        }

        // Check if room is ready
        if (!room.ready) {
            callback({success: false, error: 'Room is still initializing'});
            return;
        }

        // Join the room
        socket.join(code);
        room.addPlayer(socket.id);
        playerRooms.set(socket.id, code);

        console.log(`Player ${socket.id} joined room ${code}`);

        // Send map data to the joining player
        const mapData=room.game.terrain.serialize();
        mapData.config=room.game.config;
        socket.emit('mapData', mapData);
        socket.emit('joinedRoom', {code, isHost: false});

        // Notify other players
        socket.to(code).emit('playerJoined', {playerId: socket.id, playerCount: room.players.size});

        callback({success: true, code, playerCount: room.players.size});
    });

    // LEAVE ROOM
    socket.on('leaveRoom', () => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room) {
                room.removePlayer(socket.id);
                socket.leave(code);
                socket.to(code).emit('playerLeft', {playerId: socket.id, playerCount: room.players.size});
            }
            playerRooms.delete(socket.id);
            socket.emit('leftRoom');
            console.log(`Player ${socket.id} left room ${code}`);
        }
    });

    // GET ROOM LIST (for debugging/admin)
    socket.on('getRooms', (callback) => {
        const roomList=Array.from(rooms.values()).map(r => r.getInfo());
        callback(roomList);
    });

    // GAME INPUT
    socket.on('input', (input) => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room&&room.ready) {
                room.game.handleInput(socket.id, input);
            }
        }
    });

    // RESPAWN
    socket.on('respawn', () => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room&&room.ready) {
                const result=room.game.respawnPlayer(socket.id);
                socket.emit('respawnResult', result);
                if (result.success) {
                    console.log(`Player ${socket.id} respawned in room ${code}`);
                }
            }
        }
    });

    // PING
    socket.on('ping', (data) => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room&&room.ready) {
                const player=room.game.players.get(socket.id);
                if (player&&!player.dead) {
                    player.setPing(data.type);
                }
            }
        }
    });

    // TETHER
    socket.on('toggleTether', () => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room&&room.ready) {
                room.game.toggleTether(socket.id);
            }
        }
    });

    // JETTISON CARGO
    socket.on('jettisonCargo', () => {
        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room&&room.ready) {
                const player=room.game.players.get(socket.id);
                if (player&&!player.dead) {
                    const dropped=player.jettisonCargo(0.25); // Drop 25%
                    if (dropped>0) {
                        console.log(`Player ${socket.id} jettisoned ${dropped} cargo`);
                        socket.emit('cargoJettisoned', {amount: dropped});
                    }
                }
            }
        }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const code=playerRooms.get(socket.id);
        if (code) {
            const room=rooms.get(code);
            if (room) {
                room.removePlayer(socket.id);
                socket.to(code).emit('playerLeft', {playerId: socket.id, playerCount: room.players.size});
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

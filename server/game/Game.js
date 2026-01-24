import {VoxelMap} from './VoxelMap.js';
import {Player} from './Player.js';
import {PhysicsWorld} from './PhysicsWorld.js';

// Resource costs
const RESPAWN_COST = 50; // Spare parts to respawn
const REPAIR_COST_PER_DAMAGE = 5; // Spare parts per damage point repaired
const REFUEL_COST_PER_UNIT = 0.1; // Fuel units from base per unit refueled to player
const REFUEL_RATE = 100; // Fuel units per second when on pad
const REPAIR_RATE = 1; // Damage points per second when on pad

export class Game {
    constructor() {
        this.players=new Map();
        this.voxelMap=new VoxelMap(400, 500, 8); // 400x500 tiles at 8px = 3200x4000 world (deeper map)
        this.physics=new PhysicsWorld();
        this.lastTime=Date.now();
        this.ready=false;
        this.io=null; // Socket.io instance for broadcasting

        // Base resources
        this.baseResources = {
            spareParts: 200, // Starting spare parts for repairs and respawns
            fuel: 5000 // Starting fuel reserves
        };
    }

    setIO(io, roomCode = null) {
        this.io = io;
        this.roomCode = roomCode; // Room code for broadcasting to specific room
    }

    // Broadcast to room or all clients
    broadcast(event, data) {
        if (this.io) {
            if (this.roomCode) {
                this.io.to(this.roomCode).emit(event, data);
            } else {
                this.io.emit(event, data);
            }
        }
    }

    async init() {
        console.log('Game init: starting physics...');
        await this.physics.init();
        console.log('Game init: physics ready');

        // Generate voxel terrain
        console.log('Game init: generating terrain...');
        this.voxelMap.generate();
        console.log('Game init: terrain generated');

        this.voxelMap.setPhysicsWorld(this.physics);
        console.log('Game init: creating collision bodies...');
        this.voxelMap.createAllCollisionBodies();
        console.log('Game init: collision bodies created');

        this.ready=true;
        console.log('Game init: complete');
    }

    addPlayer(id) {
        const spawnPos=this.voxelMap.getSpawnPosition();
        const player=new Player(id, this.physics, spawnPos.x, spawnPos.y);
        this.players.set(id, player);
        return player;
    }

    // For backward compatibility with index.js terrain.serialize()
    get terrain() {
        return this.voxelMap;
    }

    destroyTile(gx, gy) {
        if (this.voxelMap.destroyTile(gx, gy)) {
            // Broadcast tile update to all clients in this room
            this.broadcast('tileUpdate', {x: gx, y: gy, value: 0});
            return true;
        }
        return false;
    }

    // Check for tile destruction based on impact
    checkTileDestruction(worldX, worldY, velocity) {
        const speed=Math.sqrt(velocity.vx*velocity.vx+velocity.vy*velocity.vy);
        if (speed>50) { // Threshold for destruction
            const grid=this.voxelMap.worldToGrid(worldX, worldY);
            // Destroy tiles in a small radius
            for (let dy=-1; dy<=1; dy++) {
                for (let dx=-1; dx<=1; dx++) {
                    this.destroyTile(grid.x+dx, grid.y+dy);
                }
            }
        }
    }

    removePlayer(id) {
        const player=this.players.get(id);
        if (player) {
            player.destroy(); // method to remove body from world
            this.players.delete(id);
        }
    }

    respawnPlayer(id) {
        const player = this.players.get(id);
        if (!player || !player.dead) {
            return { success: false, reason: 'not_dead' };
        }

        // Check if enough spare parts
        if (this.baseResources.spareParts < RESPAWN_COST) {
            return { success: false, reason: 'no_resources', required: RESPAWN_COST, available: this.baseResources.spareParts };
        }

        // Deduct resources
        this.baseResources.spareParts -= RESPAWN_COST;

        // Get spawn position
        const spawnPos = this.voxelMap.getSpawnPosition();

        // Respawn the player
        player.respawn(spawnPos.x, spawnPos.y);

        return { success: true, spareParts: this.baseResources.spareParts };
    }

    // Check if there are other alive players who could rescue
    canBeRescued(id) {
        for (const [playerId, player] of this.players) {
            if (playerId !== id && !player.dead) {
                return true;
            }
        }
        return false;
    }

    getAlivePlayerCount() {
        let count = 0;
        for (const player of this.players.values()) {
            if (!player.dead) count++;
        }
        return count;
    }

    handleInput(id, input) {
        const player=this.players.get(id);
        if (player) {
            player.setInput(input);
        }
    }

    update() {
        if (!this.ready) return;

        const now=Date.now();
        const dt=(now-this.lastTime)/1000;
        this.lastTime=now;

        // Store pre-collision velocities
        const preVelocities=new Map();
        for (const [id, player] of this.players) {
            preVelocities.set(id, player.getVelocity());
        }

        // Step Physics (Ammo handles positions)
        this.physics.step(dt);

        // Check for collisions (velocity changed significantly)
        for (const [id, player] of this.players) {
            if (player.dead) continue;

            const preVel=preVelocities.get(id);
            const postVel=player.getVelocity();
            const preSpeed=Math.sqrt(preVel.vx*preVel.vx+preVel.vy*preVel.vy);
            const postSpeed=Math.sqrt(postVel.vx*postVel.vx+postVel.vy*postVel.vy);
            const speedDrop=preSpeed-postSpeed;

            // Debug: log significant speed changes
            if (speedDrop>5) {
                console.log(`Collision: preSpeed=${preSpeed.toFixed(1)}, postSpeed=${postSpeed.toFixed(1)}, drop=${speedDrop.toFixed(1)}`);
            }

            // If significant speed drop, player collided
            if (speedDrop>10) {
                // Calculate damage based on impact speed
                const damageAmount=Math.min(3, Math.max(0.3, speedDrop/30));
                player.takeDamage(damageAmount);
                console.log(`Damage: ${damageAmount.toFixed(2)}, total: ${player.damage.toFixed(2)}`);

                // Destroy tiles on high-speed impacts
                if (preSpeed>60 && speedDrop>30) {
                    const pos=player.getPosition();
                    const collisionX=pos.x+(preVel.vx/preSpeed)*15;
                    const collisionY=pos.y+(preVel.vy/preSpeed)*15;
                    this.checkTileDestruction(collisionX, collisionY, preVel);
                }
            }
        }

        // Check for landing pad interactions (refuel/repair)
        for (const [id, player] of this.players) {
            if (player.dead) continue;

            const pos = player.getPosition();
            const vel = player.getVelocity();
            const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);

            // Check if player is on landing pad and moving slowly (landed)
            const isOnPad = this.voxelMap.isOnLandingPad(pos.x, pos.y);
            const isLanded = isOnPad && speed < 15;

            player.landed = isLanded;
            player.onPad = isOnPad;

            if (isLanded) {
                // Auto-refuel if base has fuel
                if (player.fuel < 1000 && this.baseResources.fuel > 0) {
                    const fuelNeeded = Math.min(REFUEL_RATE * dt, 1000 - player.fuel);
                    const fuelCost = fuelNeeded * REFUEL_COST_PER_UNIT;
                    const fuelAvailable = Math.min(fuelNeeded, this.baseResources.fuel / REFUEL_COST_PER_UNIT);

                    if (fuelAvailable > 0) {
                        player.fuel += fuelAvailable;
                        this.baseResources.fuel -= fuelAvailable * REFUEL_COST_PER_UNIT;
                    }
                }

                // Auto-repair if base has spare parts
                if (player.damage > 0 && this.baseResources.spareParts > 0) {
                    const repairAmount = Math.min(REPAIR_RATE * dt, player.damage);
                    const repairCost = repairAmount * REPAIR_COST_PER_DAMAGE;

                    if (this.baseResources.spareParts >= repairCost) {
                        player.damage = Math.max(0, player.damage - repairAmount);
                        this.baseResources.spareParts -= repairCost;
                    }
                }
            }
        }

        // Sync Player Logic (Inputs -> Force)
        for (const player of this.players.values()) {
            player.update(dt);
        }
    }

    getState() {
        if (!this.ready) return {players: [], baseResources: this.baseResources, respawnCost: RESPAWN_COST};
        return {
            players: Array.from(this.players.values()).map(p => p.serialize()),
            baseResources: this.baseResources,
            respawnCost: RESPAWN_COST,
            aliveCount: this.getAlivePlayerCount(),
            basePosition: this.voxelMap.basePosition,
            basePadBounds: this.voxelMap.basePadBounds
        };
    }
}

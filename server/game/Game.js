import {VoxelMap, TileTypes} from './VoxelMap.js';
import {Player} from './Player.js';
import {PhysicsWorld} from './PhysicsWorld.js';

// Resource costs
const RESPAWN_COST = 50; // Spare parts to respawn
const REPAIR_COST_PER_DAMAGE = 5; // Spare parts per damage point repaired
const REFUEL_COST_PER_UNIT = 0.1; // Fuel units from base per unit refueled to player
const REFUEL_RATE = 100; // Fuel units per second when on pad
const REPAIR_RATE = 1; // Damage points per second when on pad

// Mining config
const MINING_RANGE = 80; // World units to mine from
const MINING_SPEED = 0.5; // Progress per second (2 seconds to mine)

// Docking config
const DOCKING_DISTANCE = 40; // World units to be considered in docking range
const DOCKING_VELOCITY_MATCH = 15; // Max velocity difference to dock
const FUEL_TRANSFER_RATE = 50; // Fuel per second
const MIN_FUEL_TRANSFER = 100; // Minimum to complete a transfer

// Tether config
const TETHER_ATTACH_RANGE = 80; // Max distance to attach tether
const TETHER_MAX_LENGTH = 150; // Max length before tension
const TETHER_SNAP_LENGTH = 180; // Length at which tether snaps
const TETHER_STRENGTH = 0.8; // Force multiplier when taut

// Survival pod config
const POD_RESCUE_RANGE = 50; // How close to rescue a pod

// Hazard config
const GAS_POCKET_CHANCE = 0.15; // Chance a deep ore has a gas pocket
const GAS_FORCE = 80; // Force applied when gas erupts
const STALACTITE_FALL_CHANCE = 0.2; // Chance nearby tiles fall when tile destroyed

// Ore values and mining yields
const ORE_CONFIG = {
    [TileTypes.IRON_ORE]: { name: 'Iron', value: 10, yield: 25 },
    [TileTypes.COPPER_ORE]: { name: 'Copper', value: 15, yield: 20 },
    [TileTypes.TITANIUM_ORE]: { name: 'Titanium', value: 30, yield: 15 },
    [TileTypes.GOLD_ORE]: { name: 'Gold', value: 75, yield: 10 },
    [TileTypes.PLATINUM_ORE]: { name: 'Platinum', value: 150, yield: 8 },
    [TileTypes.HELIUM3_DEPOSIT]: { name: 'Helium-3', value: 300, yield: 5 }
};

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
            fuel: 5000, // Starting fuel reserves
            // Ore storage
            iron: 0,
            copper: 0,
            titanium: 0,
            gold: 0,
            platinum: 0,
            helium3: 0,
            // Total value delivered
            totalValue: 0
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

    destroyTile(gx, gy, triggeredByPlayer = null) {
        const tile = this.voxelMap.get(gx, gy);

        if (this.voxelMap.destroyTile(gx, gy)) {
            // Broadcast tile update to all clients in this room
            this.broadcast('tileUpdate', {x: gx, y: gy, value: 0});

            // Check for chain reactions (stalactites falling)
            this.checkChainReaction(gx, gy);

            // Check for gas pocket eruption on deep tiles
            if (triggeredByPlayer && gy > this.voxelMap.height * 0.3) {
                this.checkGasPocket(gx, gy, triggeredByPlayer);
            }

            return true;
        }
        return false;
    }

    // Check for chain reaction when tile destroyed
    checkChainReaction(gx, gy) {
        // Check tiles above for potential fall
        for (let dy = -2; dy <= 0; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;

                const checkX = gx + dx;
                const checkY = gy + dy;

                const tile = this.voxelMap.get(checkX, checkY);
                if (tile === TileTypes.EMPTY || tile === TileTypes.PAD || tile === TileTypes.BASE) continue;

                // Check if tile is now unsupported (empty below)
                const belowTile = this.voxelMap.get(checkX, checkY + 1);
                if (belowTile === TileTypes.EMPTY && Math.random() < STALACTITE_FALL_CHANCE) {
                    // Schedule this tile to fall
                    this.scheduleFallingTile(checkX, checkY, tile);
                }
            }
        }
    }

    // Schedule a tile to fall
    scheduleFallingTile(gx, gy, tileType) {
        // Destroy the tile
        this.voxelMap.set(gx, gy, TileTypes.EMPTY);
        this.broadcast('tileUpdate', {x: gx, y: gy, value: 0});

        // Create a falling debris event
        const worldPos = this.voxelMap.gridToWorld(gx, gy);
        this.broadcast('fallingDebris', {
            x: worldPos.x,
            y: worldPos.y,
            tileType: tileType
        });

        // After a delay, deal damage to players in the area below
        setTimeout(() => {
            this.checkFallingDebrisDamage(worldPos.x, worldPos.y);
        }, 500);
    }

    // Check if falling debris hits a player
    checkFallingDebrisDamage(worldX, worldY) {
        const damageRadius = 30;
        const fallDistance = 100;

        for (const player of this.players.values()) {
            if (player.dead) continue;

            const pos = player.getPosition();
            const dx = pos.x - worldX;
            const dy = pos.y - (worldY + fallDistance);

            if (Math.abs(dx) < damageRadius && Math.abs(dy) < 50) {
                player.takeDamage(1.5);
                console.log(`Player ${player.id} hit by falling debris`);

                // Apply downward force
                const ammo = this.physics.ammo;
                player.body.applyCentralForce(new ammo.btVector3(0, 200, 0));
            }
        }
    }

    // Check for gas pocket eruption
    checkGasPocket(gx, gy, player) {
        // Deeper = more likely to have gas
        const depthFactor = gy / this.voxelMap.height;

        if (Math.random() < GAS_POCKET_CHANCE * depthFactor) {
            // Gas eruption!
            const pos = player.getPosition();
            const worldPos = this.voxelMap.gridToWorld(gx, gy);

            // Calculate push direction (away from eruption)
            const dx = pos.x - worldPos.x;
            const dy = pos.y - worldPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            // Apply force
            const ammo = this.physics.ammo;
            const forceX = (dx / dist) * GAS_FORCE;
            const forceY = (dy / dist) * GAS_FORCE - 50; // Also push upward

            player.body.applyCentralForce(new ammo.btVector3(forceX, forceY, 0));

            // Small damage
            player.takeDamage(0.5);

            console.log(`Gas pocket eruption at ${gx},${gy} - pushing player ${player.id}`);

            // Broadcast gas eruption effect
            this.broadcast('gasEruption', {
                x: worldPos.x,
                y: worldPos.y
            });
        }
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

                // Auto-unload cargo when landed
                if (player.cargo.length > 0) {
                    this.unloadCargo(player);
                }
            }
        }

        // Mining logic
        for (const [id, player] of this.players) {
            if (player.dead) continue;

            this.updateMining(player, dt);
        }

        // Update pings (clear expired)
        for (const player of this.players.values()) {
            player.updatePing(5000); // 5 second duration
        }

        // Docking and fuel transfer
        this.updateDocking(dt);

        // Tether physics
        this.updateTethers(dt);

        // Survival pods
        this.updatePods(dt);

        // Sync Player Logic (Inputs -> Force)
        for (const player of this.players.values()) {
            player.update(dt);
        }
    }

    // Unload cargo from player to base
    unloadCargo(player) {
        if (player.cargo.length === 0) return;

        let totalUnloaded = 0;
        let valueDelivered = 0;

        for (const cargoItem of player.cargo) {
            const oreType = cargoItem.type;
            const amount = cargoItem.amount;
            const oreConfig = ORE_CONFIG[oreType];

            if (!oreConfig) continue;

            // Add to base storage
            const oreName = oreConfig.name.toLowerCase();
            if (this.baseResources.hasOwnProperty(oreName)) {
                this.baseResources[oreName] += amount;
            }

            // Calculate value
            const value = Math.floor(amount * oreConfig.value / oreConfig.yield);
            valueDelivered += value;
            totalUnloaded += amount;

            // Generate spare parts from ore (conversion ratio)
            const spareParts = Math.floor(amount * 0.2);
            this.baseResources.spareParts += spareParts;

            // Generate fuel from Helium-3
            if (oreType === TileTypes.HELIUM3_DEPOSIT) {
                const fuelGenerated = amount * 10;
                this.baseResources.fuel += fuelGenerated;
            }
        }

        // Clear player cargo
        player.cargo = [];
        player.updateMass();

        // Update total value
        this.baseResources.totalValue += valueDelivered;

        if (totalUnloaded > 0) {
            console.log(`Player ${player.id} delivered ${totalUnloaded} cargo, value: ${valueDelivered}`);

            // Broadcast cargo delivery
            this.broadcast('cargoDelivered', {
                playerId: player.id,
                amount: totalUnloaded,
                value: valueDelivered,
                totalValue: this.baseResources.totalValue
            });
        }
    }

    // Find nearest ore within range
    findNearestOre(playerX, playerY, range) {
        const grid = this.voxelMap.worldToGrid(playerX, playerY);
        const searchRadius = Math.ceil(range / this.voxelMap.tileSize);
        let nearest = null;
        let nearestDist = Infinity;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const gx = grid.x + dx;
                const gy = grid.y + dy;

                if (gx < 0 || gx >= this.voxelMap.width || gy < 0 || gy >= this.voxelMap.height) continue;

                const tile = this.voxelMap.get(gx, gy);

                // Check if it's an ore type
                if (tile >= TileTypes.IRON_ORE && tile <= TileTypes.HELIUM3_DEPOSIT) {
                    const worldPos = this.voxelMap.gridToWorld(gx, gy);
                    const distX = worldPos.x - playerX;
                    const distY = worldPos.y - playerY;
                    const dist = Math.sqrt(distX * distX + distY * distY);

                    if (dist <= range && dist < nearestDist) {
                        nearestDist = dist;
                        nearest = { gx, gy, tile, worldX: worldPos.x, worldY: worldPos.y, dist };
                    }
                }
            }
        }

        return nearest;
    }

    // Update mining for a player
    updateMining(player, dt) {
        const pos = player.getPosition();

        if (!player.mining) {
            // Not mining - reset progress
            player.miningProgress = 0;
            player.miningTarget = null;
            return;
        }

        // Find nearest ore within range
        const nearest = this.findNearestOre(pos.x, pos.y, player.miningRange);

        if (!nearest) {
            // No ore in range
            player.miningProgress = 0;
            player.miningTarget = null;
            return;
        }

        // Check if target changed
        if (!player.miningTarget || player.miningTarget.gx !== nearest.gx || player.miningTarget.gy !== nearest.gy) {
            player.miningProgress = 0;
            player.miningTarget = { gx: nearest.gx, gy: nearest.gy, worldX: nearest.worldX, worldY: nearest.worldY };
        }

        // Progress mining
        player.miningProgress += MINING_SPEED * dt;

        // Check if mining complete
        if (player.miningProgress >= 1) {
            const tile = this.voxelMap.get(nearest.gx, nearest.gy);
            const oreConfig = ORE_CONFIG[tile];

            if (oreConfig) {
                // Extract ore
                const extracted = player.addCargo(tile, oreConfig.yield);

                if (extracted > 0) {
                    // Remove the ore tile (pass player for hazard checks)
                    this.destroyTile(nearest.gx, nearest.gy, player);
                    console.log(`Player ${player.id} mined ${oreConfig.name}: +${extracted} units`);
                }
            }

            player.miningProgress = 0;
            player.miningTarget = null;
        }
    }

    // Update docking detection and fuel transfer
    updateDocking(dt) {
        const playerList = Array.from(this.players.values()).filter(p => !p.dead);

        // Reset docking targets
        for (const player of playerList) {
            player.dockingTarget = null;
            player.isDocked = false;
        }

        // Check all pairs for docking proximity
        for (let i = 0; i < playerList.length; i++) {
            for (let j = i + 1; j < playerList.length; j++) {
                const p1 = playerList[i];
                const p2 = playerList[j];

                const pos1 = p1.getPosition();
                const pos2 = p2.getPosition();
                const vel1 = p1.getVelocity();
                const vel2 = p2.getVelocity();

                // Calculate distance
                const dx = pos2.x - pos1.x;
                const dy = pos2.y - pos1.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Calculate velocity difference
                const dvx = vel2.vx - vel1.vx;
                const dvy = vel2.vy - vel1.vy;
                const velDiff = Math.sqrt(dvx * dvx + dvy * dvy);

                // Check if in docking range
                if (distance <= DOCKING_DISTANCE) {
                    p1.dockingTarget = p2.id;
                    p2.dockingTarget = p1.id;

                    // Check if velocities match (can dock)
                    if (velDiff <= DOCKING_VELOCITY_MATCH) {
                        p1.isDocked = true;
                        p2.isDocked = true;

                        // Handle fuel transfer
                        this.handleFuelTransfer(p1, p2, dt);
                    }
                }
            }
        }

        // Reset transfer state for players not transferring
        for (const player of playerList) {
            if (!player.fuelTransferring) {
                player.fuelTransferred = 0;
            }
        }
    }

    // Handle fuel transfer between two docked players
    handleFuelTransfer(p1, p2, dt) {
        // Check if either player is initiating transfer
        if (p1.inputs.transferFuel && p1.fuel > 0 && p2.fuel < 1000) {
            // P1 transfers to P2
            const amount = Math.min(FUEL_TRANSFER_RATE * dt, p1.fuel, 1000 - p2.fuel);
            p1.fuel -= amount;
            p2.fuel += amount;
            p1.fuelTransferring = true;
            p1.fuelTransferred += amount;
        } else if (p2.inputs.transferFuel && p2.fuel > 0 && p1.fuel < 1000) {
            // P2 transfers to P1
            const amount = Math.min(FUEL_TRANSFER_RATE * dt, p2.fuel, 1000 - p1.fuel);
            p2.fuel -= amount;
            p1.fuel += amount;
            p2.fuelTransferring = true;
            p2.fuelTransferred += amount;
        } else {
            p1.fuelTransferring = false;
            p2.fuelTransferring = false;
        }
    }

    // Toggle tether for a player
    toggleTether(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.dead) return;

        // If already tethered, detach
        if (player.tetheredTo) {
            this.detachTether(player);
            return;
        }

        // Find nearest player to tether to
        const pos = player.getPosition();
        let nearest = null;
        let nearestDist = Infinity;

        for (const [id, other] of this.players) {
            if (id === playerId || other.dead) continue;

            const otherPos = other.getPosition();
            const dx = otherPos.x - pos.x;
            const dy = otherPos.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= TETHER_ATTACH_RANGE && dist < nearestDist) {
                nearestDist = dist;
                nearest = other;
            }
        }

        if (nearest) {
            this.attachTether(player, nearest);
        }
    }

    // Attach tether between two players
    attachTether(p1, p2) {
        p1.tetheredTo = p2.id;
        p2.tetheredTo = p1.id;

        const pos1 = p1.getPosition();
        const pos2 = p2.getPosition();
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        p1.tetherLength = dist;
        p2.tetherLength = dist;

        console.log(`Tether attached between ${p1.id} and ${p2.id}, length: ${dist.toFixed(1)}`);
    }

    // Detach tether
    detachTether(player) {
        const otherId = player.tetheredTo;
        const other = this.players.get(otherId);

        player.tetheredTo = null;
        player.tetherLength = 0;
        player.tetherTension = 0;

        if (other) {
            other.tetheredTo = null;
            other.tetherLength = 0;
            other.tetherTension = 0;
        }

        console.log(`Tether detached from ${player.id}`);
    }

    // Update all tethers - apply physics constraints
    updateTethers(dt) {
        const processed = new Set();

        for (const [id, player] of this.players) {
            if (!player.tetheredTo || processed.has(id)) continue;

            const other = this.players.get(player.tetheredTo);
            if (!other || other.dead) {
                // Other player gone or dead, detach
                this.detachTether(player);
                continue;
            }

            processed.add(id);
            processed.add(player.tetheredTo);

            // If this player is dead, tether can drag them
            // (This enables rescue towing)

            const pos1 = player.getPosition();
            const pos2 = other.getPosition();

            const dx = pos2.x - pos1.x;
            const dy = pos2.y - pos1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Update tether length
            player.tetherLength = dist;
            other.tetherLength = dist;

            // Check for snap
            if (dist > TETHER_SNAP_LENGTH) {
                console.log(`Tether snapped! Length: ${dist.toFixed(1)}`);
                this.detachTether(player);
                continue;
            }

            // Calculate tension (0 when slack, 1 at max)
            const tension = Math.max(0, (dist - TETHER_MAX_LENGTH) / (TETHER_SNAP_LENGTH - TETHER_MAX_LENGTH));
            player.tetherTension = tension;
            other.tetherTension = tension;

            // Apply constraint force when taut
            if (dist > TETHER_MAX_LENGTH) {
                // Normalize direction
                const nx = dx / dist;
                const ny = dy / dist;

                // Force proportional to how much we've exceeded max length
                const excess = dist - TETHER_MAX_LENGTH;
                const forceMag = excess * TETHER_STRENGTH * 2; // Multiply for stronger pull

                const ammo = this.physics.ammo;

                // Apply force pulling them together
                if (!player.dead) {
                    player.body.applyCentralForce(new ammo.btVector3(nx * forceMag, ny * forceMag, 0));
                }
                if (!other.dead) {
                    other.body.applyCentralForce(new ammo.btVector3(-nx * forceMag, -ny * forceMag, 0));
                }
            }
        }
    }

    // Update survival pods
    updatePods(dt) {
        const alivePlayers = Array.from(this.players.values()).filter(p => !p.dead);
        const podPlayers = Array.from(this.players.values()).filter(p => p.inPod);

        for (const podPlayer of podPlayers) {
            // Update pod physics
            const expired = podPlayer.updatePod(dt, 10); // Gravity of 10

            if (expired) {
                // Pod life support ran out - truly dead
                console.log(`Player ${podPlayer.id}'s pod life support expired`);
                continue;
            }

            // Check for rescue by alive players
            for (const rescuer of alivePlayers) {
                const rescuerPos = rescuer.getPosition();

                if (podPlayer.checkRescue(rescuerPos, POD_RESCUE_RANGE)) {
                    // Rescue! Respawn near the rescuer
                    const spawnPos = this.voxelMap.getSpawnPosition();
                    podPlayer.performRescue(spawnPos.x, spawnPos.y);

                    console.log(`Player ${podPlayer.id} rescued by ${rescuer.id}!`);

                    // Broadcast rescue event
                    this.broadcast('playerRescued', {
                        rescuedId: podPlayer.id,
                        rescuerId: rescuer.id
                    });

                    break;
                }
            }
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

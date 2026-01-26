import {VoxelMap, TileTypes} from './VoxelMap.js';
import {Player} from './Player.js';
import {PhysicsWorld} from './PhysicsWorld.js';
import {readFileSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const __filename=fileURLToPath(import.meta.url);
const __dirname=dirname(__filename);
const configPath=join(__dirname, '../game_config.json');

// Load default config
const defaultConfig=JSON.parse(readFileSync(configPath, 'utf8'));

// Resource costs
// Constants that don't need to be in config or are derived
const DOCKING_DISTANCE=40;
const DOCKING_VELOCITY_MATCH=15;
const FUEL_TRANSFER_RATE=50;
const MIN_FUEL_TRANSFER=100;
const POD_RESCUE_RANGE=50;
const GAS_FORCE=80;
const STALACTITE_FALL_CHANCE=0.2;
const MAX_HEIGHT_CEILING=100; // Players cannot fly higher than this (y coordinate, starts at 0 at top edge)
const GAS_POCKET_CHANCE=0.15; // 15% chance of gas pocket at depth

// Ore values and mining yields
// Values increase significantly with depth/rarity
const ORE_CONFIG={
    [TileTypes.REGOLITH]: {name: 'Regolith', value: 0, yield: 5, color: '#c0c0c0', isResource: false},
    [TileTypes.ROCK]: {name: 'Rock', value: 0, yield: 5, color: '#808080', isResource: false},
    [TileTypes.HARD_ROCK]: {name: 'Hard Rock', value: 0, yield: 5, color: '#404040', isResource: false},
    [TileTypes.IRON_ORE]: {name: 'Iron', value: 5, yield: 25, color: '#8b4513', isResource: true},
    [TileTypes.COPPER_ORE]: {name: 'Copper', value: 10, yield: 20, color: '#b87333', isResource: true},
    [TileTypes.BITITE]: {name: 'Bitite', value: 15, yield: 18, color: '#2f2f2f', fuelMaterial: true, isResource: true},
    [TileTypes.SILVER_ORE]: {name: 'Silver', value: 25, yield: 15, color: '#c0c0c0', isResource: true},
    [TileTypes.TITANIUM_ORE]: {name: 'Titanium', value: 40, yield: 12, color: '#708090', isResource: true},
    [TileTypes.GOLD_ORE]: {name: 'Gold', value: 75, yield: 10, color: '#ffd700', isResource: true},
    [TileTypes.PLATINUM_ORE]: {name: 'Platinum', value: 150, yield: 8, color: '#e5e4e2', isResource: true},
    [TileTypes.DIAMOND]: {name: 'Diamond', value: 500, yield: 3, color: '#b9f2ff', isResource: true}
};

export class Game {
    constructor() {
        this.players=new Map();
        // 400x1200 tiles at 8px = 3200x9600 world (much deeper map)
        this.voxelMap=new VoxelMap(400, 1200, 8);
        this.physics=new PhysicsWorld();
        this.lastTime=Date.now();
        this.ready=false;
        this.io=null; // Socket.io instance for broadcasting

        // Load config
        try {
            this.config=JSON.parse(readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error("Failed to load game config, using defaults", e);
            this.config=defaultConfig;
        }

        // Base resources
        this.baseResources={
            spareParts: 200, // Starting spare parts for repairs and respawns
            fuel: 5000, // Starting fuel reserves
            oxygen: 1000, // Starting oxygen
            maxOxygen: 1000,
            // Ore storage (8 ore types)
            iron: 0,
            copper: 0,
            bitite: 0,     // Fuel-producing material
            silver: 0,
            titanium: 0,
            gold: 0,
            platinum: 0,
            diamond: 0,
            // Building materials (4 tiers)
            basicMaterials: 0,      // Tier 1: From Iron, Copper
            industrialMaterials: 0, // Tier 2: From Silver, Titanium
            advancedMaterials: 0,   // Tier 3: From Gold, Platinum
            quantumMaterials: 0,    // Tier 4: From Diamond
            // Station Stats
            oreCapacity: 1000,
            maxFuel: 10000,
            maxSpareParts: 1000,
            processingRate: 5, // Units per second
            // Power system
            power: 100,           // Current power
            maxPower: 100,        // Max power capacity
            powerGeneration: 10,  // Power generated per second (from solar)
            powerConsumption: 5,  // Base power consumption
            // Total value delivered
            totalValue: 0
        };

        // Buildings system
        // Each building has levels 0-5 (0 = not built, 1-5 = upgrade levels)
        this.buildings={
            // Storage
            ore_storage: {level: 0, name: 'Ore Storage', effect: 'oreCapacity', baseValue: 0, perLevel: 500},
            fuel_depot: {level: 0, name: 'Fuel Depot', effect: 'maxFuel', baseValue: 0, perLevel: 5000},
            parts_warehouse: {level: 0, name: 'Parts Warehouse', effect: 'maxSpareParts', baseValue: 0, perLevel: 500},

            // Production
            fuel_refinery: {level: 0, name: 'Fuel Refinery', effect: 'fuelProduction', baseValue: 0, perLevel: 0.5},
            solar_array: {level: 0, name: 'Solar Array', effect: 'powerGeneration', baseValue: 0, perLevel: 10},
            fuel_generator: {level: 0, name: 'Fuel Generator', effect: 'fuelPower', baseValue: 0, perLevel: 20},

            // Utility
            communications_antenna: {level: 0, name: 'Comms Antenna', effect: 'antennaRange', baseValue: 0, perLevel: 400},
            ship_factory: {level: 0, name: 'Ship Factory', effect: 'shipTypes', baseValue: 0, perLevel: 1},
            crafting_station: {level: 0, name: 'Crafting Station', effect: 'crafting', baseValue: 0, perLevel: 1}
        };

        // Building upgrade costs (materials required per level)
        // Building upgrade costs (materials required per level)
        // Level 0 -> 1 is construction cost
        // Building upgrade costs (materials required per level)
        // Level 0 -> 1 is construction cost
        this.buildingCosts={
            ore_storage: [
                {basic: 50}, {basic: 100}, {industrial: 25}, {industrial: 75}, {advanced: 50},
                {advanced: 100}, {advanced: 200}, {quantum: 20}, {quantum: 40}, {quantum: 80}, {quantum: 150}, {quantum: 300}
            ],
            fuel_depot: [
                {basic: 50}, {basic: 100}, {industrial: 25}, {industrial: 75}, {advanced: 50},
                {advanced: 100}, {advanced: 200}, {quantum: 20}, {quantum: 40}, {quantum: 80}, {quantum: 150}, {quantum: 300}
            ],
            parts_warehouse: [
                {basic: 50}, {basic: 100}, {industrial: 25}, {industrial: 75}, {advanced: 50},
                {advanced: 100}, {advanced: 200}, {quantum: 20}, {quantum: 40}, {quantum: 80}, {quantum: 150}, {quantum: 300}
            ],
            fuel_refinery: [
                {basic: 75}, {industrial: 50}, {industrial: 100}, {advanced: 75}, {quantum: 10},
                {quantum: 25}, {quantum: 50}, {quantum: 100}, {quantum: 200}, {quantum: 400}, {quantum: 600}, {quantum: 1000}
            ],
            solar_array: [
                {basic: 50}, {industrial: 40}, {industrial: 80}, {advanced: 60}, {quantum: 20},
                {quantum: 40}, {quantum: 80}, {quantum: 150}, {quantum: 300}, {quantum: 500}, {quantum: 800}, {quantum: 1200}
            ],
            fuel_generator: [
                {industrial: 75}, {industrial: 100}, {advanced: 50}, {advanced: 100}, {quantum: 40},
                {quantum: 80}, {quantum: 160}, {quantum: 320}, {quantum: 640}, {quantum: 1000}, {quantum: 1500}, {quantum: 2500}
            ],
            communications_antenna: [
                {basic: 100}, {industrial: 75}, {industrial: 150}, {advanced: 100}, {quantum: 25},
                {quantum: 50}, {quantum: 100}, {quantum: 200}, {quantum: 400}, {quantum: 600}, {quantum: 800}, {quantum: 1200}
            ],
            ship_factory: [
                {industrial: 100}, {advanced: 75}, {advanced: 150}, {quantum: 50}, {quantum: 100},
                {quantum: 200}, {quantum: 400}, {quantum: 800}, {quantum: 1200}, {quantum: 1600}, {quantum: 2000}, {quantum: 3000}
            ],
            crafting_station: [
                {basic: 75}, {industrial: 75}, {advanced: 50}, {advanced: 100}, {quantum: 30},
                {quantum: 60}, {quantum: 120}, {quantum: 240}, {quantum: 480}, {quantum: 800}, {quantum: 1200}, {quantum: 2000}
            ]
        };

        // Exploration Fog of War
        // Grid of 20x20 tile chunks (160x160 world units)
        this.chunkSize=20;
        this.chunksX=Math.ceil(this.voxelMap.width/this.chunkSize);
        this.chunksY=Math.ceil(this.voxelMap.height/this.chunkSize);
        this.explorationGrid=new Uint8Array(this.chunksX*this.chunksY); // 0 = unexplored, 1 = explored

        // Ship wreckages - destroyed ships that can be salvaged
        this.wreckages=new Map(); // wreckageId -> {x, y, cargo, spareParts, playerId, body}
        this.nextWreckageId=1;

        // Parked vehicles (ships without players)
        this.vehicles=new Map(); // vehicleId -> {id, x, y, angle, type, fuel, power, damage, cargo, body}
        this.nextVehicleId=1;

        // Dropped items (jettisoned ore that falls to ground)
        this.droppedItems=new Map(); // itemId -> {id, x, y, type, amount, body}
        this.nextDroppedItemId=1;
    }

    // Get the effective value for a building stat
    getBuildingEffect(buildingKey) {
        const building=this.buildings[buildingKey];
        if (!building) return 0;
        return building.baseValue+(building.level-1)*building.perLevel;
    }

    // Get antenna range for minimap
    // Get antenna range for minimap
    getAntennaRange() {
        return 200+this.getBuildingEffect('communications_antenna');
    }

    canAffordUpgrade(buildingKey) {
        const building=this.buildings[buildingKey];
        if (!building||building.level>=12) return false;

        const costs=this.buildingCosts[buildingKey];
        if (!costs||building.level>=costs.length) return false;

        const levelCost=costs[building.level];
        const materialMap={
            basic: 'basicMaterials',
            industrial: 'industrialMaterials',
            advanced: 'advancedMaterials',
            quantum: 'quantumMaterials'
        };

        for (const [matType, amount] of Object.entries(levelCost)) {
            const key=materialMap[matType];
            if (!key||this.baseResources[key]<amount) {
                return false;
            }
        }
        return true;
    }

    // Upgrade a building
    upgradeBuilding(buildingKey) {
        if (!this.canAffordUpgrade(buildingKey)) return false;

        const building=this.buildings[buildingKey];
        const costs=this.buildingCosts[buildingKey];
        const levelCost=costs[building.level];

        const materialMap={
            basic: 'basicMaterials',
            industrial: 'industrialMaterials',
            advanced: 'advancedMaterials',
            quantum: 'quantumMaterials'
        };

        // Deduct materials
        for (const [matType, amount] of Object.entries(levelCost)) {
            const key=materialMap[matType];
            this.baseResources[key]-=amount;
        }

        // Increase level
        building.level++;

        // Apply effects to base resources
        this.applyBuildingEffects();

        console.log(`Upgraded ${building.name} to level ${building.level}`);

        // Broadcast the upgrade
        this.broadcast('buildingUpgraded', {
            building: buildingKey,
            newLevel: building.level,
            name: building.name
        });

        return true;
    }

    // Apply all building effects to base resources
    applyBuildingEffects() {
        // Storage buildings (Base value + effect)
        // Base stats (without buildings)
        const baseOre=500;
        const baseFuel=2000;
        const baseParts=200;

        this.baseResources.oreCapacity=baseOre+this.getBuildingEffect('ore_storage');
        this.baseResources.maxFuel=baseFuel+this.getBuildingEffect('fuel_depot');
        this.baseResources.maxSpareParts=baseParts+this.getBuildingEffect('parts_warehouse');

        // Power generation from solar
        this.baseResources.powerGeneration=10+this.getBuildingEffect('solar_array');

        // Fuel generator provides extra power from fuel (handled in processStationResources)
    }

    setIO(io, roomCode=null) {
        this.io=io;
        this.roomCode=roomCode; // Room code for broadcasting to specific room
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
        this.voxelMap.generate(Math.random());
        console.log('Game init: terrain generated');

        this.voxelMap.setPhysicsWorld(this.physics);
        console.log('Game init: creating collision bodies...');
        this.voxelMap.createAllCollisionBodies();
        console.log('Game init: collision bodies created');

        this.ready=true;
        console.log('Game init: complete');
    }

    addPlayer(id, nickname) {
        const spawnPos=this.voxelMap.getSpawnPosition();
        const player=new Player(id, this.physics, spawnPos.x, spawnPos.y, this.config, nickname);
        this.players.set(id, player);
        return player;
    }

    // For backward compatibility with index.js terrain.serialize()
    get terrain() {
        return this.voxelMap;
    }

    destroyTile(gx, gy, triggeredByPlayer=null) {
        const tile=this.voxelMap.get(gx, gy);

        if (this.voxelMap.destroyTile(gx, gy)) {
            // Broadcast tile update to all clients in this room
            this.broadcast('tileUpdate', {x: gx, y: gy, value: 0});

            // Check for chain reactions (stalactites falling)
            this.checkChainReaction(gx, gy);

            // Check for gas pocket eruption on deep tiles
            if (triggeredByPlayer&&gy>this.voxelMap.height*0.3) {
                this.checkGasPocket(gx, gy, triggeredByPlayer);
            }

            return true;
        }
        return false;
    }

    // Check for chain reaction when tile destroyed
    checkChainReaction(gx, gy) {
        // Check tiles above for potential fall
        for (let dy=-2; dy<=0; dy++) {
            for (let dx=-1; dx<=1; dx++) {
                if (dx===0&&dy===0) continue;

                const checkX=gx+dx;
                const checkY=gy+dy;

                const tile=this.voxelMap.get(checkX, checkY);
                if (tile===TileTypes.EMPTY||tile===TileTypes.PAD||tile===TileTypes.BASE) continue;

                // Check if tile is now unsupported (empty below)
                const belowTile=this.voxelMap.get(checkX, checkY+1);
                if (belowTile===TileTypes.EMPTY&&Math.random()<STALACTITE_FALL_CHANCE) {
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
        const worldPos=this.voxelMap.gridToWorld(gx, gy);
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
        const damageRadius=30;
        const fallDistance=100;

        for (const player of this.players.values()) {
            if (player.dead) continue;

            const pos=player.getPosition();
            const dx=pos.x-worldX;
            const dy=pos.y-(worldY+fallDistance);

            if (Math.abs(dx)<damageRadius&&Math.abs(dy)<50) {
                player.takeDamage(1.5);
                console.log(`Player ${player.id} hit by falling debris`);

                // Apply downward force
                const ammo=this.physics.ammo;
                player.body.applyCentralForce(new ammo.btVector3(0, 200, 0));
            }
        }
    }

    // Check for gas pocket eruption
    checkGasPocket(gx, gy, player) {
        // Deeper = more likely to have gas
        const depthFactor=gy/this.voxelMap.height;

        if (Math.random()<GAS_POCKET_CHANCE*depthFactor) {
            // Gas eruption!
            const pos=player.getPosition();
            const worldPos=this.voxelMap.gridToWorld(gx, gy);

            // Calculate push direction (away from eruption)
            const dx=pos.x-worldPos.x;
            const dy=pos.y-worldPos.y;
            const dist=Math.sqrt(dx*dx+dy*dy)||1;

            // Apply force
            const ammo=this.physics.ammo;
            const forceX=(dx/dist)*GAS_FORCE;
            const forceY=(dy/dist)*GAS_FORCE-50; // Also push upward

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
        const player=this.players.get(id);
        if (!player||!player.dead) {
            return {success: false, reason: 'not_dead'};
        }

        // Check if enough spare parts
        if (this.baseResources.spareParts<this.config.resources.respawnCost) {
            return {success: false, reason: 'no_resources', required: this.config.resources.respawnCost, available: this.baseResources.spareParts};
        }

        // Deduct resources
        this.baseResources.spareParts-=this.config.resources.respawnCost;

        // Get spawn position
        const spawnPos=this.voxelMap.getSpawnPosition();

        // Respawn the player
        player.respawn(spawnPos.x, spawnPos.y);

        return {success: true, spareParts: this.baseResources.spareParts};
    }

    // Check if there are other alive players who could rescue
    canBeRescued(id) {
        for (const [playerId, player] of this.players) {
            if (playerId!==id&&!player.dead) {
                return true;
            }
        }
        return false;
    }

    getAlivePlayerCount() {
        let count=0;
        for (const player of this.players.values()) {
            if (!player.dead) count++;
        }
        return count;
    }

    handleInput(id, input) {
        const player=this.players.get(id);
        if (player) {
            // Handle exit vehicle (X held for 2 seconds) - only when NOT in EVA mode
            if (input.exitVehicle&&!player.lastExitVehicle&&!player.dead&&player.shipType!=='eva') {
                this.exitVehicle(player);
            }

            // Handle enter vehicle (E pressed) - only when in EVA mode near a vehicle
            if (input.enterVehicle&&!player.lastEnterVehicle&&!player.dead&&player.shipType==='eva') {
                this.tryBoardVehicle(player);
            }

            // Check for system toggles for sounds
            if (input.toggleLights&&!player.lastLightsInput) {
                this.broadcast('playSound', {type: 'toggle_light', playerId: id});
            }
            if (input.toggleSpotlight&&!player.lastSpotlightInput) {
                this.broadcast('playSound', {type: 'toggle_light', playerId: id});
            }
            if (input.toggleAntenna&&!player.lastAntennaInput) {
                this.broadcast('playSound', {type: 'toggle_light', playerId: id});
            }

            player.setInput(input);
        }
    }

    // Try to board nearby vehicle when in EVA mode
    tryBoardVehicle(player) {
        const pos=player.getPosition();
        let nearestVehicle=null;
        let minDist=40;

        for (const vehicle of this.vehicles.values()) {
            const dx=vehicle.x-pos.x;
            const dy=vehicle.y-pos.y;
            const dist=Math.sqrt(dx*dx+dy*dy);
            if (dist<minDist) {
                minDist=dist;
                nearestVehicle=vehicle;
            }
        }

        if (nearestVehicle) {
            this.boardVehicle(player, nearestVehicle);
        }
    }

    exitVehicle(player) {
        // Must be landed or moving slowly to exit? 
        // Let's allow exit anywhere if not too fast, but usually moonlander games are strict.
        const vel=player.getVelocity();
        const speed=Math.sqrt(vel.vx*vel.vx+vel.vy*vel.vy);
        if (speed>30) {
            // Too fast to exit!
            return;
        }

        const pos=player.getPosition(); // START FIX: Capture position BEFORE switching to EVA
        const stats=player.setShipType('eva'); // Returns previous ship state
        if (!stats) return;

        const vehicleId=`veh_${this.nextVehicleId++}`;

        // Create physics body for parked vehicle
        const body=this.physics.createBox(pos.x, pos.y, stats.width, stats.height, 1.5);
        body.setActivationState(4);
        body.setFriction(0.8);

        const vehicle={
            id: vehicleId,
            x: pos.x,
            y: pos.y,
            angle: stats.angle||0,
            type: stats.type,
            fuel: stats.fuel,
            power: stats.power,
            damage: stats.damage,
            oxygen: stats.oxygen||100,
            cargo: stats.cargo,
            ownerId: player.id,
            body: body
        };

        this.vehicles.set(vehicleId, vehicle);
        console.log(`Player ${player.id} exited ${stats.type}, vehicle created: ${vehicleId}`);

        this.broadcast('vehicleCreated', {
            id: vehicleId,
            x: pos.x,
            y: pos.y,
            type: stats.type
        });
    }

    boardVehicle(player, vehicle) {
        console.log(`Player ${player.id} boarding ${vehicle.type} (${vehicle.id})`);

        // Recreate player body and restore stats from vehicle
        player.setShipType(vehicle.type, vehicle);

        // Remove vehicle physics
        if (vehicle.body) {
            this.physics.world.removeRigidBody(vehicle.body);
        }

        // Remove from map
        this.vehicles.delete(vehicle.id);

        this.broadcast('vehicleRemoved', {id: vehicle.id});
    }

    // Remove all vehicles owned by a specific player
    removePlayerVehicles(playerId) {
        for (const [vehicleId, vehicle] of this.vehicles) {
            if (vehicle.ownerId===playerId) {
                if (vehicle.body) {
                    this.physics.world.removeRigidBody(vehicle.body);
                }
                this.vehicles.delete(vehicleId);
                this.broadcast('vehicleRemoved', {id: vehicleId});
                console.log(`Removed vehicle ${vehicleId} belonging to player ${playerId}`);
            }
        }
    }

    // Debug helper: Spawn a vehicle at position
    spawnVehicle(x, y, type='scout') {
        const SHIP_TYPES={
            scout: {width: 20, height: 20, mass: 1.0, fuel: 500, power: 100, damage: 0},
            cargo: {width: 30, height: 30, mass: 2.5, fuel: 1000, power: 150, damage: 0}
        };

        const stats=SHIP_TYPES[type]||SHIP_TYPES.scout;
        const vehicleId=`veh_${this.nextVehicleId++}`;
        const body=this.physics.createBox(x, y, stats.width, stats.height, stats.mass);

        const vehicle={
            id: vehicleId,
            type: type,
            x: x,
            y: y,
            angle: 0,
            fuel: stats.fuel,
            power: stats.power,
            damage: 0,
            cargo: [],
            body: body,
            ownerId: null // Spawned vehicle, no owner
        };

        this.vehicles.set(vehicleId, vehicle);
        console.log(`Debug: Spawned ${type} vehicle at (${x}, ${y})`);
    }

    // Recalculate all building effects (called after debug changes)
    recalculateBuildingEffects() {
        // Nothing special to recalculate for now, effects are calculated on-demand
        console.log('Building effects recalculated');
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
                // Calculate damage based on orientation
                // Ships landing with bottom facing down take less damage
                const rotation=player.getRotation();
                const TOLERANCE_ANGLE=Math.PI/4; // 45 degrees tolerance for "correct" landing

                // Calculate impact direction (velocity angle)
                const impactAngle=Math.atan2(preVel.vy, preVel.vx);

                // Ship's "down" direction (bottom of ship) at angle=0, bottom points at +PI/2
                const shipBottomAngle=rotation+Math.PI/2;

                // Check if velocity is approximately opposite to ship bottom direction
                // For a good landing, the ship should be falling (velocity pointing down)
                // and ship bottom should be pointing down (toward the surface)
                const normalizedShipBottom=((shipBottomAngle%(2*Math.PI))+(2*Math.PI))%(2*Math.PI);
                const isBottomFacingDown=Math.abs(normalizedShipBottom-Math.PI/2)<TOLERANCE_ANGLE||
                    Math.abs(normalizedShipBottom-(Math.PI*5/2))<TOLERANCE_ANGLE;

                // Check if movement is primarily downward (landing)
                const isMovingDown=preVel.vy>Math.abs(preVel.vx)*0.5; // Moving more down than sideways

                // Correct landing orientation: bottom facing down while moving down
                const isCorrectLanding=isBottomFacingDown&&isMovingDown;

                let damage;
                if (isCorrectLanding) {
                    // Correct landing orientation - much higher threshold, reduced damage
                    const LANDING_THRESHOLD=20; // Higher threshold for good landings
                    if (speedDrop<=LANDING_THRESHOLD) {
                        damage=0; // Safe landing!
                    } else {
                        // Still some damage but reduced
                        damage=Math.floor((speedDrop-LANDING_THRESHOLD)/15);
                    }
                } else {
                    // Bad orientation - side/top collision, normal damage
                    damage=Math.floor(speedDrop/10);
                }

                if (damage>0) {
                    player.takeDamage(damage);
                    console.log(`Damage: ${damage.toFixed(2)}, total: ${player.damage.toFixed(2)}, correctLanding: ${isCorrectLanding}`);
                }

                // If player was EVA and died, remove their parked ship
                if (player.dead&&player.shipType==='eva') {
                    this.removePlayerVehicles(player.id);
                }

                // Destroy tiles on high-speed impacts
                if (preSpeed>60&&speedDrop>30) {
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

            const pos=player.getPosition();
            const vel=player.getVelocity();
            const speed=Math.sqrt(vel.vx*vel.vx+vel.vy*vel.vy);

            // Check if player is on landing pad and moving slowly (landed)
            const isOnPad=this.voxelMap.isOnLandingPad(pos.x, pos.y);
            const isLanded=isOnPad&&speed<15;

            player.landed=isLanded;
            player.onPad=isOnPad;

            if (isLanded) {
                // Auto-refuel if base has fuel (use player's maxFuel)
                if (player.fuel<player.maxFuel&&this.baseResources.fuel>0) {
                    const fuelNeeded=Math.min(this.config.resources.refuelRate*dt, player.maxFuel-player.fuel);
                    const fuelCost=fuelNeeded*this.config.resources.refuelCostPerUnit;
                    const fuelAvailable=Math.min(fuelNeeded, this.baseResources.fuel/this.config.resources.refuelCostPerUnit);

                    if (fuelAvailable>0) {
                        player.fuel+=fuelAvailable;
                        this.baseResources.fuel-=fuelAvailable*this.config.resources.refuelCostPerUnit;
                    }
                }

                // Auto-repair if base has spare parts
                if (player.damage>0&&this.baseResources.spareParts>0) {
                    const repairAmount=Math.min(this.config.resources.repairRate*dt, player.damage);
                    const repairCost=repairAmount*this.config.resources.repairCostPerDamage;

                    if (this.baseResources.spareParts>=repairCost) {
                        player.damage=Math.max(0, player.damage-repairAmount);
                        this.baseResources.spareParts-=repairCost;
                    }
                }

                // Recharge power faster on pad (already handled in Player.update with onPad check)

                // Manual cargo transfer (Hold T)
                if (player.inputs.transferCargo) {
                    player.transferring=player.cargo.length>0;
                    this.transferCargoToStation(player, dt);
                } else {
                    player.transferring=false;
                }

                // Recharge oxygen at Habitat (on pad)
                if (player.oxygen<player.maxOxygen&&this.baseResources.oxygen>0) {
                    const rechargeRate=player.shipType==='eva'? 20:5; // EVA suit recharges faster
                    const rechargeAmount=Math.min(rechargeRate*dt, player.maxOxygen-player.oxygen);
                    const available=Math.min(rechargeAmount, this.baseResources.oxygen);
                    player.oxygen+=available;
                    this.baseResources.oxygen-=available;
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

        // Update vehicles
        this.updateVehicles(dt);

        // Update dropped items (jettisoned ore)
        this.updateDroppedItems(dt);

        // Update wreckages
        this.updateWreckages(dt);

        // Survival pods
        this.updatePods(dt);

        // Station Processing
        this.processStationResources(dt);

        // Sync Player Logic (Inputs -> Force)
        for (const player of this.players.values()) {
            const wasDead=player.dead;
            player.update(dt);

            // Check for death from other causes (oxygen, etc)
            if (player.dead&&!wasDead&&player.shipType==='eva') {
                this.removePlayerVehicles(player.id);
            }
        }

        // Enforce flight ceiling
        this.enforceFlightCeiling();

        // Update Exploration
        this.updateExploration();
    }

    // Switch ship type for a player
    switchShip(playerId, type) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false, reason: 'invalid_player'};

        // Must be on landing pad to switch
        if (!player.onPad) {
            return {success: false, reason: 'not_landed'};
        }

        // Check if ship type is unlocked (e.g. requires Ship Factory level)
        // Hardcoded for now: Cargo ship requires level 2 factory
        if (type==='cargo') {
            const factoryLevel=this.buildings.shipFactory.level;
            if (factoryLevel<2) {
                return {success: false, reason: 'locked', requiredLevel: 2};
            }
        }

        if (player.setShipType(type)) {
            console.log(`Player ${player.id} switched to ${type}`);
            return {success: true};
        }

        return {success: false, reason: 'unknown_error'};
    }

    // Create a wreckage when a player's ship is destroyed
    createWreckage(player) {
        const pos=player.getPosition();
        const wreckageId=`wreck_${this.nextWreckageId++}`;

        // Create physics body for wreckage (can be towed)
        const body=this.physics.createBox(pos.x, pos.y, 25, 25, 2); // Heavier than player
        body.setActivationState(4); // DISABLE_DEACTIVATION
        body.setFriction(0.8);

        // Copy cargo from player
        const cargo=[...player.cargo];
        const spareParts=Math.floor(20+Math.random()*30); // Salvageable parts from the ship

        const wreckage={
            id: wreckageId,
            x: pos.x,
            y: pos.y,
            shipType: player.shipType||'scout',
            angle: -player.getRotation(), // Capture rotation at death
            cargo,
            spareParts,
            originalPlayerId: player.id,
            body,
            tetheredTo: null,
            tetherLength: 0
        };

        this.wreckages.set(wreckageId, wreckage);

        console.log(`Wreckage ${wreckageId} created at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) with ${cargo.length} cargo types`);

        // Broadcast wreckage creation
        this.broadcast('wreckageCreated', {
            id: wreckageId,
            x: pos.x,
            y: pos.y,
            hasCargo: cargo.length>0
        });

        return wreckageId;
    }

    // Salvage a wreckage at the landing pad
    salvageWreckage(wreckageId) {
        const wreckage=this.wreckages.get(wreckageId);
        if (!wreckage) return;

        // Add cargo to base storage
        for (const cargoItem of wreckage.cargo) {
            const oreConfig=ORE_CONFIG[cargoItem.type];
            if (oreConfig) {
                const oreNameMap={
                    'Iron': 'iron', 'Copper': 'copper', 'Bitite': 'bitite',
                    'Silver': 'silver', 'Titanium': 'titanium', 'Gold': 'gold',
                    'Platinum': 'platinum', 'Diamond': 'diamond'
                };
                const storageKey=oreNameMap[oreConfig.name];
                if (storageKey) {
                    this.baseResources[storageKey]+=cargoItem.amount;
                }
            }
        }

        // Add salvaged spare parts
        this.baseResources.spareParts=Math.min(
            this.baseResources.maxSpareParts,
            this.baseResources.spareParts+wreckage.spareParts
        );

        // Remove physics body
        if (wreckage.body) {
            this.physics.world.removeRigidBody(wreckage.body);
        }

        // Remove from wreckages
        this.wreckages.delete(wreckageId);

        console.log(`Wreckage ${wreckageId} salvaged: +${wreckage.spareParts} parts`);

        // Broadcast
        this.broadcast('wreckageSalvaged', {
            id: wreckageId,
            spareParts: wreckage.spareParts
        });
    }

    // Jettison cargo with physics - creates dropped items that fall
    jettisonCargoWithPhysics(playerId, percentage=0.25) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return [];

        const pos=player.getPosition();
        const vel=player.getVelocity();
        const droppedItems=[];

        // Get items to drop from player's cargo
        for (const cargoItem of player.cargo) {
            if (cargoItem.amount<=0) continue;

            const dropAmount=Math.ceil(cargoItem.amount*percentage);
            if (dropAmount<=0) continue;

            cargoItem.amount-=dropAmount;

            // Create physics body for dropped item
            const itemId=`drop_${this.nextDroppedItemId++}`;
            const offsetX=(Math.random()-0.5)*30; // Spread items out
            const offsetY=(Math.random()-0.5)*20;
            const itemX=pos.x+offsetX;
            const itemY=pos.y+offsetY;

            // Create small box for the dropped item
            const body=this.physics.createBox(itemX, itemY, 6, 6, 0.5);

            // Apply initial velocity (inherit some from ship, plus random scatter)
            const ammo=this.physics.ammo;
            const scatterVx=(Math.random()-0.5)*50;
            const scatterVy=(Math.random()-0.5)*30+10; // Slight downward bias
            body.setLinearVelocity(new ammo.btVector3(vel.vx*0.5+scatterVx, vel.vy*0.5+scatterVy, 0));

            const droppedItem={
                id: itemId,
                x: itemX,
                y: itemY,
                type: cargoItem.type,
                amount: dropAmount,
                body: body,
                lifetime: 60 // Despawn after 60 seconds
            };

            this.droppedItems.set(itemId, droppedItem);
            droppedItems.push({type: cargoItem.type, amount: dropAmount});
        }

        // Remove empty cargo entries
        player.cargo=player.cargo.filter(c => c.amount>0);

        // Broadcast dropped items
        this.broadcast('itemsDropped', {
            playerId: playerId,
            items: droppedItems.map(item => ({type: item.type, amount: item.amount})),
            x: pos.x,
            y: pos.y
        });

        return droppedItems;
    }

    // Update dropped items physics
    updateDroppedItems(dt) {
        const toRemove=[];

        for (const [id, item] of this.droppedItems) {
            // Update position from physics
            const transform=new this.physics.ammo.btTransform();
            item.body.getMotionState().getWorldTransform(transform);
            const origin=transform.getOrigin();

            item.x=origin.x();
            item.y=origin.y();

            // Decrease lifetime
            item.lifetime-=dt;
            if (item.lifetime<=0) {
                toRemove.push(id);
                continue;
            }

            // Check if on landing pad - auto-collect
            if (this.voxelMap.isOnLandingPad(item.x, item.y)) {
                const vel=item.body.getLinearVelocity();
                const speed=Math.sqrt(vel.x()*vel.x()+vel.y()*vel.y());
                if (speed<15) { // Moving slowly enough to collect
                    // Add to base storage
                    const oreKey=item.type.toLowerCase().replace('_ore', '');
                    if (this.baseResources.ores[oreKey]!==undefined) {
                        this.baseResources.ores[oreKey]+=item.amount;
                    }
                    toRemove.push(id);
                    console.log(`Collected dropped ${item.type} x${item.amount} at landing pad`);
                }
            }

            // Check if player can pick up (nearby and has cargo space)
            for (const [playerId, player] of this.players) {
                if (player.dead||player.shipType==='eva') continue;

                const dx=item.x-player.x;
                const dy=item.y-player.y;
                const dist=Math.sqrt(dx*dx+dy*dy);

                if (dist<30) { // Pickup range
                    // Check if player has cargo space
                    const currentWeight=player.cargo.reduce((sum, c) => sum+c.amount, 0);
                    const maxCargo=player.maxCargoCapacity||500;
                    if (currentWeight+item.amount<=maxCargo) {
                        // Add to player cargo
                        const existingCargo=player.cargo.find(c => c.type===item.type);
                        if (existingCargo) {
                            existingCargo.amount+=item.amount;
                        } else {
                            player.cargo.push({type: item.type, amount: item.amount});
                        }
                        toRemove.push(id);
                        console.log(`Player ${playerId} picked up ${item.type} x${item.amount}`);
                        break;
                    }
                }
            }
        }

        // Remove collected/expired items
        for (const id of toRemove) {
            const item=this.droppedItems.get(id);
            if (item&&item.body) {
                this.physics.world.removeRigidBody(item.body);
            }
            this.droppedItems.delete(id);
        }
    }

    // Update wreckage physics and check for salvage
    updateWreckages(dt) {
        for (const [id, wreckage] of this.wreckages) {
            // Update position from physics
            const transform=new this.physics.ammo.btTransform();
            wreckage.body.getMotionState().getWorldTransform(transform);
            const origin=transform.getOrigin();
            const rot=transform.getRotation();

            wreckage.x=origin.x();
            wreckage.y=origin.y();

            // Get rotation z
            const z=rot.z();
            const w=rot.w();
            wreckage.angle=2*Math.atan2(z, w);

            // Check if wreckage is on landing pad
            if (this.voxelMap.isOnLandingPad(wreckage.x, wreckage.y)) {
                const vel=wreckage.body.getLinearVelocity();
                const speed=Math.sqrt(vel.x()*vel.x()+vel.y()*vel.y());
                if (speed<10) { // Moving slowly enough to salvage
                    this.salvageWreckage(id);
                }
            }
        }
    }

    // Prevent players from flying too high (into space)
    enforceFlightCeiling() {
        for (const player of this.players.values()) {
            if (player.dead) continue;

            const pos=player.getPosition();

            // If player is above ceiling, push them back down
            if (pos.y<MAX_HEIGHT_CEILING) {
                const ammo=this.physics.ammo;
                const vel=player.getVelocity();

                // Cancel upward velocity
                if (vel.vy<0) {
                    player.body.setLinearVelocity(new ammo.btVector3(vel.vx, Math.abs(vel.vy)*0.3, 0));
                }

                // Apply downward force
                player.body.applyCentralForce(new ammo.btVector3(0, 50, 0));
            }
        }
    }

    updateExploration() {
        if (!this.ready) return;

        const EXPLORE_RADIUS=3; // Chunks radius (3 * 20 * 8 = 480px, approx screen half-width)

        for (const player of this.players.values()) {
            if (player.dead) continue;

            const pos=player.getPosition();
            const grid=this.voxelMap.worldToGrid(pos.x, pos.y);

            const chunkX=Math.floor(grid.x/this.chunkSize);
            const chunkY=Math.floor(grid.y/this.chunkSize);

            // Mark surrounding chunks as explored
            for (let dy=-EXPLORE_RADIUS; dy<=EXPLORE_RADIUS; dy++) {
                for (let dx=-EXPLORE_RADIUS; dx<=EXPLORE_RADIUS; dx++) {
                    const cx=chunkX+dx;
                    const cy=chunkY+dy;

                    if (cx>=0&&cx<this.chunksX&&cy>=0&&cy<this.chunksY) {
                        const idx=cy*this.chunksX+cx;
                        this.explorationGrid[idx]=1;
                    }
                }
            }
        }
    }

    // Unload cargo from player to base
    unloadCargo(player) {
        if (player.cargo.length===0) return;

        let totalUnloaded=0;
        let valueDelivered=0;

        for (const cargoItem of player.cargo) {
            const oreType=cargoItem.type;
            const amount=cargoItem.amount;
            const oreConfig=ORE_CONFIG[oreType];

            if (!oreConfig) continue;

            // Add to base storage using proper key mapping
            const oreNameMap={
                'Iron': 'iron',
                'Copper': 'copper',
                'Bitite': 'bitite',
                'Silver': 'silver',
                'Titanium': 'titanium',
                'Gold': 'gold',
                'Platinum': 'platinum',
                'Diamond': 'diamond'
            };
            const storageKey=oreNameMap[oreConfig.name];
            if (storageKey&&this.baseResources.hasOwnProperty(storageKey)) {
                this.baseResources[storageKey]+=amount;
            }

            // Calculate value
            const value=Math.floor(amount*oreConfig.value/oreConfig.yield);
            valueDelivered+=value;
            totalUnloaded+=amount;

            // Generate some immediate spare parts from ore (small amount)
            const spareParts=Math.floor(amount*0.1);
            this.baseResources.spareParts=Math.min(
                this.baseResources.maxSpareParts,
                this.baseResources.spareParts+spareParts
            );

            // Generate fuel immediately from Bitite (in addition to refinery processing)
            if (oreConfig.fuelMaterial) {
                const fuelGenerated=amount*2; // Small immediate bonus
                this.baseResources.fuel=Math.min(
                    this.baseResources.maxFuel,
                    this.baseResources.fuel+fuelGenerated
                );
            }
        }

        // Clear player cargo
        player.cargo=[];
        player.updateMass();

        // Update total value
        this.baseResources.totalValue+=valueDelivered;

        if (totalUnloaded>0) {
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

    // Find target tile based on distance and pointing angle
    findTargetTile(playerX, playerY, range, spotlightAngle) {
        const grid=this.voxelMap.worldToGrid(playerX, playerY);
        const searchRadius=Math.ceil(range/this.voxelMap.tileSize);
        let bestTarget=null;
        let bestScore=-Infinity; // Higher is better

        for (let dy=-searchRadius; dy<=searchRadius; dy++) {
            for (let dx=-searchRadius; dx<=searchRadius; dx++) {
                const gx=grid.x+dx;
                const gy=grid.y+dy;

                if (gx<0||gx>=this.voxelMap.width||gy<0||gy>=this.voxelMap.height) continue;

                const tile=this.voxelMap.get(gx, gy);
                if (tile===TileTypes.EMPTY||tile===TileTypes.BASE||tile===TileTypes.PAD) continue;

                const worldPos=this.voxelMap.gridToWorld(gx, gy);
                const distX=worldPos.x-playerX;
                const distY=worldPos.y-playerY;
                const dist=Math.sqrt(distX*distX+distY*distY);

                if (dist<=range) {
                    // Calculate alignment with spotlight angle
                    const tileAngle=Math.atan2(distY, distX);
                    let angleDiff=Math.abs(spotlightAngle-tileAngle);
                    while (angleDiff>Math.PI) angleDiff=Math.abs(angleDiff-2*Math.PI);

                    // Score: emphasize proximity to the line of sight (angle) first, then distance
                    // Alignment score: 1.0 at 0 diff, 0.0 at PI diff
                    const alignment=1.0-(angleDiff/Math.PI);
                    // Proximity score: 1.0 at dist=0, 0.0 at dist=range
                    const proximity=1.0-(dist/range);

                    // We heavily weight the directional alignment to give the player control
                    const score=alignment*10.0+proximity;

                    if (score>bestScore) {
                        bestScore=score;
                        let targetTile=tile;
                        bestTarget={gx, gy, tile: targetTile, worldX: worldPos.x, worldY: worldPos.y, dist, score};
                    }
                }
            }
        }

        return bestTarget;
    }

    // Keep findNearestOre for backward compatibility if needed, but link to new logic
    findNearestOre(playerX, playerY, range) {
        return this.findTargetTile(playerX, playerY, range, 0);
    }

    // Update mining for a player
    updateMining(player, dt) {
        const pos=player.getPosition();

        if (!player.mining) {
            player.miningProgress=0;
            player.miningTarget=null;
            return;
        }

        if (!player.canMine()) {
            player.miningProgress=0;
            player.miningTarget=null;
            return;
        }

        // Find target tile based on directional pointing
        const target=this.findTargetTile(pos.x, pos.y, player.miningRange, player.spotlightAngle);

        // Only consider it "Mining Resource" for UI if it's actually an ore
        const isOre=target&&ORE_CONFIG[target.tile]&&ORE_CONFIG[target.tile].isResource;
        player.isMiningResource=!!isOre;

        if (!target) {
            player.miningProgress=0;
            player.miningTarget=null;
            return;
        }

        if (!player.miningTarget||player.miningTarget.gx!==target.gx||player.miningTarget.gy!==target.gy) {
            player.miningProgress=0;
            player.miningTarget={gx: target.gx, gy: target.gy, worldX: target.worldX, worldY: target.worldY};
        }

        if (!player.consumeMiningPower(dt)) return;

        // Progress mining
        player.miningProgress+=this.config.mining.speedBase*this.config.difficulty.miningSpeedMultiplier*dt;

        if (player.miningProgress>=1) {
            const tile=this.voxelMap.get(target.gx, target.gy);
            const oreConfig=ORE_CONFIG[tile];

            if (oreConfig&&oreConfig.isResource) {
                const extracted=player.addCargo(tile, oreConfig.yield);
                if (extracted>0) {
                    this.destroyTile(target.gx, target.gy, player);
                    this.broadcast('orePickup', {
                        playerId: player.id,
                        oreName: oreConfig.name,
                        amount: extracted,
                        x: target.worldX,
                        y: target.worldY,
                        color: oreConfig.color
                    });
                }
            } else {
                // Not a resource, just destroy it
                this.destroyTile(target.gx, target.gy, player);
            }

            player.miningProgress=0;
            player.miningTarget=null;
        }
    }

    // Update docking detection and fuel transfer
    updateDocking(dt) {
        const playerList=Array.from(this.players.values()).filter(p => !p.dead);

        // Reset docking targets
        for (const player of playerList) {
            player.dockingTarget=null;
            player.isDocked=false;
        }

        // Check all pairs for docking proximity
        for (let i=0; i<playerList.length; i++) {
            for (let j=i+1; j<playerList.length; j++) {
                const p1=playerList[i];
                const p2=playerList[j];

                const pos1=p1.getPosition();
                const pos2=p2.getPosition();
                const vel1=p1.getVelocity();
                const vel2=p2.getVelocity();

                // Calculate distance
                const dx=pos2.x-pos1.x;
                const dy=pos2.y-pos1.y;
                const distance=Math.sqrt(dx*dx+dy*dy);

                // Calculate velocity difference
                const dvx=vel2.vx-vel1.vx;
                const dvy=vel2.vy-vel1.vy;
                const velDiff=Math.sqrt(dvx*dvx+dvy*dvy);

                // Check if in docking range
                if (distance<=DOCKING_DISTANCE) {
                    p1.dockingTarget=p2.id;
                    p2.dockingTarget=p1.id;

                    // Check if velocities match (can dock)
                    if (velDiff<=DOCKING_VELOCITY_MATCH) {
                        p1.isDocked=true;
                        p2.isDocked=true;

                        // Handle fuel transfer
                        this.handleFuelTransfer(p1, p2, dt);
                    }
                }
            }
        }

        // Reset transfer state for players not transferring
        for (const player of playerList) {
            if (!player.fuelTransferring) {
                player.fuelTransferred=0;
            }
        }
    }

    // Handle fuel transfer between two docked players
    handleFuelTransfer(p1, p2, dt) {
        // Check if either player is initiating transfer
        if (p1.inputs.transferFuel&&p1.fuel>0&&p2.fuel<1000) {
            // P1 transfers to P2
            const amount=Math.min(FUEL_TRANSFER_RATE*dt, p1.fuel, 1000-p2.fuel);
            p1.fuel-=amount;
            p2.fuel+=amount;
            p1.fuelTransferring=true;
            p1.fuelTransferred+=amount;
        } else if (p2.inputs.transferFuel&&p2.fuel>0&&p1.fuel<1000) {
            // P2 transfers to P1
            const amount=Math.min(FUEL_TRANSFER_RATE*dt, p2.fuel, 1000-p1.fuel);
            p2.fuel-=amount;
            p1.fuel+=amount;
            p2.fuelTransferring=true;
            p2.fuelTransferred+=amount;
        } else {
            p1.fuelTransferring=false;
            p2.fuelTransferring=false;
        }
    }

    // Toggle tether for a player
    toggleTether(playerId) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return;

        // If already tethered, detach
        if (player.tetheredTo) {
            this.detachTether(player);
            return;
        }

        // Find nearest player or wreckage to tether to
        const pos=player.getPosition();
        let nearest=null;
        let nearestDist=Infinity;
        let nearestType='player';

        // Check players
        for (const [id, other] of this.players) {
            if (id===playerId||other.dead) continue;

            const otherPos=other.getPosition();
            const dx=otherPos.x-pos.x;
            const dy=otherPos.y-pos.y;
            const dist=Math.sqrt(dx*dx+dy*dy);

            if (dist<=this.config.tether.attachRange&&dist<nearestDist) {
                nearestDist=dist;
                nearest=other;
                nearestType='player';
            }
        }

        // Check wreckages
        for (const [id, wreckage] of this.wreckages) {
            const dx=wreckage.x-pos.x;
            const dy=wreckage.y-pos.y;
            const dist=Math.sqrt(dx*dx+dy*dy);

            if (dist<=this.config.tether.attachRange&&dist<nearestDist) {
                nearestDist=dist;
                nearest=wreckage;
                nearestType='wreckage';
            }
        }

        if (nearest) {
            if (nearestType==='player') {
                this.attachTether(player, nearest);
            } else {
                this.attachTetherToWreckage(player, nearest);
            }
        }
    }

    // Attach tether to wreckage
    attachTetherToWreckage(player, wreckage) {
        player.tetheredTo=wreckage.id;
        wreckage.tetheredTo=player.id;

        const pos=player.getPosition();
        const dx=wreckage.x-pos.x;
        const dy=wreckage.y-pos.y;
        const dist=Math.sqrt(dx*dx+dy*dy);

        player.tetherLength=dist;
        wreckage.tetherLength=dist;

        console.log(`Tether attached between ${player.id} and wreckage ${wreckage.id}`);
    }

    // Attach tether between two players
    attachTether(p1, p2) {
        p1.tetheredTo=p2.id;
        p2.tetheredTo=p1.id;

        const pos1=p1.getPosition();
        const pos2=p2.getPosition();
        const dx=pos2.x-pos1.x;
        const dy=pos2.y-pos1.y;
        const dist=Math.sqrt(dx*dx+dy*dy);

        p1.tetherLength=dist;
        p2.tetherLength=dist;

        console.log(`Tether attached between ${p1.id} and ${p2.id}, length: ${dist.toFixed(1)}`);
    }

    // Detach tether
    detachTether(player) {
        const otherId=player.tetheredTo;
        let other=this.players.get(otherId);
        if (!other) other=this.wreckages.get(otherId);

        player.tetheredTo=null;
        player.tetherLength=0;
        player.tetherTension=0;

        if (other) {
            other.tetheredTo=null;
            other.tetherLength=0;
            // Wreckages don't have tetherTension property usually, but let's be safe
            if (other.tetherTension!==undefined) other.tetherTension=0;
        }

        console.log(`Tether detached from ${player.id}`);
    }

    // Update all tethers - apply physics constraints
    updateTethers(dt) {
        const processed=new Set();

        for (const [id, player] of this.players) {
            if (!player.tetheredTo||processed.has(id)) continue;

            let other=this.players.get(player.tetheredTo);
            let isWreckage=false;

            if (!other) {
                other=this.wreckages.get(player.tetheredTo);
                isWreckage=!!other;
            }

            if (!other||(!isWreckage&&other.dead)) {
                // Other object gone or dead, detach
                this.detachTether(player);
                continue;
            }

            processed.add(id);
            if (!isWreckage) processed.add(player.tetheredTo);

            // If this player is dead, tether can drag them
            // (This enables rescue towing)

            const pos1=player.getPosition();
            let pos2;

            if (isWreckage) {
                pos2={x: other.x, y: other.y};
            } else {
                pos2=other.getPosition();
            }

            const dx=pos2.x-pos1.x;
            const dy=pos2.y-pos1.y;
            const dist=Math.sqrt(dx*dx+dy*dy);

            // Update tether length
            player.tetherLength=dist;
            if (isWreckage) {
                other.tetherLength=dist;
            } else {
                other.tetherLength=dist;
            }

            // Check for snap
            if (dist>this.config.tether.snapLength) {
                console.log(`Tether snapped! Length: ${dist.toFixed(1)}`);
                this.detachTether(player);
                continue;
            }

            // Calculate tension (0 when slack, 1 at max)
            const cableLen=this.config.difficulty.cableMaxLength||150;
            const tension=Math.max(0, (dist-cableLen)/(this.config.tether.snapLength-cableLen));
            player.tetherTension=tension;
            if (!isWreckage) other.tetherTension=tension;

            // Apply constraint force when taut
            if (dist>cableLen) {
                // Normalize direction
                const nx=dx/dist;
                const ny=dy/dist;

                // Force proportional to how much we've exceeded max length
                const excess=dist-cableLen;
                const forceMag=excess*this.config.tether.strength*2; // Multiply for stronger pull

                const ammo=this.physics.ammo;

                // Apply force pulling them together
                if (!player.dead) {
                    player.body.applyCentralForce(new ammo.btVector3(nx*forceMag, ny*forceMag, 0));
                }

                if (isWreckage) {
                    // Apply force to wreckage
                    if (other.body) {
                        other.body.activate(true); // Ensure it's active
                        other.body.applyCentralForce(new ammo.btVector3(-nx*forceMag, -ny*forceMag, 0));
                    }
                } else if (!other.dead) {
                    other.body.applyCentralForce(new ammo.btVector3(-nx*forceMag, -ny*forceMag, 0));

                    // POWER SHARING: Gradually equalize power between linked players
                    if (player.power!==other.power) {
                        const transferRate=5*dt; // 5 units per second
                        if (player.power>other.power) {
                            const diff=Math.min(transferRate, (player.power-other.power)/2);
                            player.power-=diff;
                            other.power+=diff;
                        } else {
                            const diff=Math.min(transferRate, (other.power-player.power)/2);
                            other.power-=diff;
                            player.power+=diff;
                        }
                    }
                }
            }
        }
    }

    // Update survival pods
    updatePods(dt) {
        const alivePlayers=Array.from(this.players.values()).filter(p => !p.dead);
        const podPlayers=Array.from(this.players.values()).filter(p => p.inPod);

        for (const podPlayer of podPlayers) {
            // Update pod physics
            const expired=podPlayer.updatePod(dt, 10); // Gravity of 10

            if (expired) {
                // Pod life support ran out - truly dead
                console.log(`Player ${podPlayer.id}'s pod life support expired`);
                continue;
            }

            // Check for rescue by alive players
            for (const rescuer of alivePlayers) {
                const rescuerPos=rescuer.getPosition();

                if (podPlayer.checkRescue(rescuerPos, POD_RESCUE_RANGE)) {
                    // Rescue! Respawn near the rescuer
                    const spawnPos=this.voxelMap.getSpawnPosition();
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

    // Transfer cargo from player to station (gradual)
    transferCargoToStation(player, dt) {
        if (player.cargo.length===0) return;

        const TRANSFER_RATE=50; // Units per second
        let amountToTransfer=TRANSFER_RATE*dt;
        let totalTransferred=0;
        let valueDelivered=0;

        // Ore name to storage key mapping
        const oreNameMap={
            'Iron': 'iron',
            'Copper': 'copper',
            'Bitite': 'bitite',
            'Silver': 'silver',
            'Titanium': 'titanium',
            'Gold': 'gold',
            'Platinum': 'platinum',
            'Diamond': 'diamond'
        };

        // Process cargo items
        for (let i=player.cargo.length-1; i>=0; i--) {
            if (amountToTransfer<=0) break;

            const cargoItem=player.cargo[i];
            const transferAmount=Math.min(amountToTransfer, cargoItem.amount);

            // Check station capacity
            const currentOre=this.baseResources.iron+this.baseResources.copper+
                this.baseResources.bitite+this.baseResources.silver+
                this.baseResources.titanium+this.baseResources.gold+
                this.baseResources.platinum+this.baseResources.diamond;

            if (currentOre+transferAmount>this.baseResources.oreCapacity) {
                // Station full
                break;
            }

            const oreConfig=ORE_CONFIG[cargoItem.type];
            if (oreConfig) {
                const storageKey=oreNameMap[oreConfig.name];
                if (storageKey&&this.baseResources.hasOwnProperty(storageKey)) {
                    this.baseResources[storageKey]+=transferAmount;
                }

                // Calculate partial value
                const value=Math.floor(transferAmount*oreConfig.value/oreConfig.yield);
                valueDelivered+=value;
            }

            // Remove from player
            cargoItem.amount-=transferAmount;
            if (cargoItem.amount<=0) {
                player.cargo.splice(i, 1);
            }

            amountToTransfer-=transferAmount;
            totalTransferred+=transferAmount;
        }

        player.updateMass();
        this.baseResources.totalValue+=valueDelivered;
    }

    // Process station resources over time
    processStationResources(dt) {
        let isRefining=false;
        // Process ores into fuel, spare parts, and tiered building materials
        // 4 Tiers of materials:
        // Basic (Tier 1): Iron, Copper
        // Industrial (Tier 2): Silver, Titanium
        // Advanced (Tier 3): Gold, Platinum
        // Quantum (Tier 4): Diamond

        const PROCESSING_SPEED=this.baseResources.processingRate*dt;

        // Process Bitite to Fuel (primary fuel source)
        if (this.baseResources.bitite>0&&this.baseResources.fuel<this.baseResources.maxFuel) {
            const amount=Math.min(PROCESSING_SPEED*2, this.baseResources.bitite);
            this.baseResources.bitite-=amount;
            // Bitite is efficient for fuel production
            this.baseResources.fuel=Math.min(this.baseResources.maxFuel, this.baseResources.fuel+amount*8);
            isRefining=true;
        }

        // Process Tier 1 ores (Iron, Copper) -> Basic Materials + Spare Parts
        let processingPower=PROCESSING_SPEED;
        const tier1Ores=['iron', 'copper'];
        for (const ore of tier1Ores) {
            if (processingPower<=0) break;
            if (this.baseResources[ore]>0) {
                const amount=Math.min(processingPower, this.baseResources[ore]);
                this.baseResources[ore]-=amount;
                // Basic materials production
                this.baseResources.basicMaterials+=amount*0.6;
                // Some spare parts
                if (this.baseResources.spareParts<this.baseResources.maxSpareParts) {
                    this.baseResources.spareParts+=amount*0.4;
                }
                processingPower-=amount;
                isRefining=true;
            }
        }

        // Process Tier 2 ores (Silver, Titanium) -> Industrial Materials + Spare Parts
        processingPower=PROCESSING_SPEED*0.8; // Slightly slower processing
        const tier2Ores=['silver', 'titanium'];
        for (const ore of tier2Ores) {
            if (processingPower<=0) break;
            if (this.baseResources[ore]>0) {
                const amount=Math.min(processingPower, this.baseResources[ore]);
                this.baseResources[ore]-=amount;
                this.baseResources.industrialMaterials+=amount*0.7;
                if (this.baseResources.spareParts<this.baseResources.maxSpareParts) {
                    this.baseResources.spareParts+=amount*0.5;
                }
                processingPower-=amount;
                isRefining=true;
            }
        }

        // Process Tier 3 ores (Gold, Platinum) -> Advanced Materials + Spare Parts
        processingPower=PROCESSING_SPEED*0.5; // Even slower
        const tier3Ores=['gold', 'platinum'];
        for (const ore of tier3Ores) {
            if (processingPower<=0) break;
            if (this.baseResources[ore]>0) {
                const amount=Math.min(processingPower, this.baseResources[ore]);
                this.baseResources[ore]-=amount;
                this.baseResources.advancedMaterials+=amount*0.8;
                if (this.baseResources.spareParts<this.baseResources.maxSpareParts) {
                    this.baseResources.spareParts+=amount*0.8;
                }
                processingPower-=amount;
                isRefining=true;
            }
        }

        // Process Tier 4 ore (Diamond) -> Quantum Materials
        processingPower=PROCESSING_SPEED*0.2; // Very slow
        if (this.baseResources.diamond>0) {
            const amount=Math.min(processingPower, this.baseResources.diamond);
            this.baseResources.diamond-=amount;
            this.baseResources.quantumMaterials+=amount*1.0;
            // Diamonds also generate spare parts (they're very valuable)
            if (this.baseResources.spareParts<this.baseResources.maxSpareParts) {
                this.baseResources.spareParts+=amount*2.0;
            }
            isRefining=true;
        }

        this.isRefining=isRefining;

        // Update power generation (base solar power for now)
        const powerDelta=(this.baseResources.powerGeneration-this.baseResources.powerConsumption)*dt;
        this.baseResources.power=Math.max(0, Math.min(this.baseResources.maxPower, this.baseResources.power+powerDelta));

        // Update oxygen generation (1.5 per sec, matches 1 player consumption)
        this.baseResources.oxygen=Math.min(this.baseResources.maxOxygen, this.baseResources.oxygen+1.5*dt);
    }

    getState() {
        if (!this.ready) return {players: [], baseResources: this.baseResources, respawnCost: this.config.resources.respawnCost};
        return {
            players: Array.from(this.players.values()).map(p => p.serialize()),
            baseResources: this.baseResources,
            buildings: this.serializeBuildings(),
            respawnCost: this.config.resources.respawnCost,
            aliveCount: this.getAlivePlayerCount(),
            basePosition: this.voxelMap.basePosition,
            basePadBounds: this.voxelMap.basePadBounds,
            explorationGrid: this.explorationGrid, // Send explored chunks
            antennaRange: this.getAntennaRange(),  // For minimap range
            wreckages: this.serializeWreckages(),  // Send active wreckages
            vehicles: this.serializeVehicles(),    // Send parked vehicles
            droppedItems: this.serializeDroppedItems(), // Send jettisoned ore items
            refining: this.isRefining,
            activeBuildings: this.getActiveBuildings() // NEW: Send only built buildings
        };
    }

    getActiveBuildings() {
        const active=[];
        for (const [key, building] of Object.entries(this.buildings)) {
            if (building.level>0) {
                const pos=this.voxelMap.getBuildingLocation(key);
                if (pos) {
                    active.push({
                        id: key,
                        x: pos.x,
                        y: pos.y
                    });
                }
            }
        }
        return active;
    }

    // Serialize vehicles for client
    serializeVehicles() {
        const result=[];
        for (const vehicle of this.vehicles.values()) {
            result.push({
                id: vehicle.id,
                x: vehicle.x,
                y: vehicle.y,
                angle: vehicle.angle||0,
                type: vehicle.type,
                damage: vehicle.damage,
                oxygen: vehicle.oxygen||100
            });
        }
        return result;
    }

    updateVehicles(dt) {
        for (const vehicle of this.vehicles.values()) {
            const transform=new this.physics.ammo.btTransform();
            vehicle.body.getMotionState().getWorldTransform(transform);
            const origin=transform.getOrigin();
            const rot=transform.getRotation();

            vehicle.x=origin.x();
            vehicle.y=origin.y();

            const z=rot.z();
            const w=rot.w();
            vehicle.angle=2*Math.atan2(z, w);
        }
    }

    // Serialize wreckages for client
    serializeWreckages() {
        const result=[];
        for (const [id, wreckage] of this.wreckages) {
            result.push({
                id: wreckage.id,
                x: wreckage.x,
                y: wreckage.y,
                angle: wreckage.angle||0,
                shipType: wreckage.shipType,
                cargo: wreckage.cargo,
                spareParts: wreckage.spareParts,
                tetheredTo: wreckage.tetheredTo
            });
        }
        return result;
    }

    // Serialize dropped items for client
    serializeDroppedItems() {
        const result=[];
        for (const [id, item] of this.droppedItems) {
            result.push({
                id: item.id,
                x: item.x,
                y: item.y,
                type: item.type,
                amount: item.amount
            });
        }
        return result;
    }

    // Serialize buildings for client
    serializeBuildings() {
        const result={};
        for (const [key, building] of Object.entries(this.buildings)) {
            result[key]={
                level: building.level,
                name: building.name,
                maxLevel: 5,
                canUpgrade: this.canAffordUpgrade(key),
                currentEffect: this.getBuildingEffect(key),
                nextCost: building.level<5? this.buildingCosts[key][building.level]:null
            };
        }
        return result;
    }
}

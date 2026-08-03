import {VoxelMap, TileTypes} from './VoxelMap.js';
import {Player} from './Player.js';
import {PhysicsWorld} from './PhysicsWorld.js';
import {CableSystem} from './CableSystem.js';
import {NetworkSystem} from './NetworkSystem.js';
import {Story, CORE_REVEAL} from './Story.js';
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

// Fraction of total map depth at which the Core Chamber sits and the endgame
// fires. 0.94 puts it inside the Core biome and just above the solid map floor.
const CORE_WIN_DEPTH_FRACTION=0.94;

// Ore values and mining yields
// Values increase significantly with depth/rarity
const ORE_CONFIG={
    [TileTypes.REGOLITH]: {name: 'Regolith', value: 0, yield: 5, color: '#c0c0c0', isResource: false},
    [TileTypes.ROCK]: {name: 'Rock', value: 0, yield: 5, color: '#808080', isResource: false},
    [TileTypes.HARD_ROCK]: {name: 'Hard Rock', value: 0, yield: 5, color: '#404040', isResource: false},
    [TileTypes.IRON_ORE]: {name: 'Iron', value: 5, yield: 4, color: '#8b4513', isResource: true},
    [TileTypes.COPPER_ORE]: {name: 'Copper', value: 10, yield: 4, color: '#b87333', isResource: true},
    [TileTypes.BITITE]: {name: 'Bitite', value: 15, yield: 18, color: '#2f2f2f', fuelMaterial: true, isResource: true},
    [TileTypes.SILVER_ORE]: {name: 'Silver', value: 25, yield: 3, color: '#c0c0c0', isResource: true},
    [TileTypes.TITANIUM_ORE]: {name: 'Titanium', value: 40, yield: 3, color: '#708090', isResource: true},
    [TileTypes.GOLD_ORE]: {name: 'Gold', value: 75, yield: 2, color: '#ffd700', isResource: true},
    [TileTypes.PLATINUM_ORE]: {name: 'Platinum', value: 150, yield: 2, color: '#e5e4e2', isResource: true},
    [TileTypes.DIAMOND]: {name: 'Diamond', value: 500, yield: 1, color: '#b9f2ff', isResource: true},
    [TileTypes.HELIUM3]: {name: 'Helium3', value: 200, yield: 1, color: '#c0ffc0', fuelMaterial: true, isResource: true}
};

export class Game {
    constructor() {
        this.players=new Map();
        // 400x1200 tiles at 8px = 3200x9600 world (much deeper map)
        this.voxelMap=new VoxelMap(400, 1200, 8);
        this.physics=new PhysicsWorld();
        this.cableSystem=new CableSystem(this);
        this.lastTime=Date.now();
        // Assigned after config load, below -- NetworkSystem reads difficulty tunables.
        this.networks=null;
        this.networkAccum=0;
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
            helium3: 0,
            // Building materials (4 tiers)
            basic: 0,      // Tier 1: From Iron, Copper
            industrial: 0, // Tier 2: From Silver, Titanium
            advanced: 0,   // Tier 3: From Gold, Platinum
            quantum: 0,    // Tier 4: From Diamond
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
        // Each building has levels 0-12
        this.buildings={
            // Core
            landing_pad: {level: 1, name: 'Landing Pad', effect: 'radius', baseValue: 200, perLevel: 0, powerCost: 5, powerScale: 2},

            // Storage
            ore_storage: {level: 0, name: 'Ore Storage', effect: 'oreCapacity', baseValue: 500, perLevel: 500, powerCost: 1, powerScale: 0.5},
            fuel_depot: {level: 0, name: 'Fuel Depot', effect: 'maxFuel', baseValue: 2000, perLevel: 5000, powerCost: 1, powerScale: 0.5},
            parts_warehouse: {level: 0, name: 'Parts Warehouse', effect: 'maxSpareParts', baseValue: 200, perLevel: 500, powerCost: 1, powerScale: 0.5},

            // Production & Power
            fuel_refinery: {level: 0, name: 'Fuel Refinery', effect: 'fuelProduction', baseValue: 0, perLevel: 0.5, powerCost: 15, powerScale: 5},
            solar_array: {level: 0, name: 'Solar Array', effect: 'powerGeneration', baseValue: 10, perLevel: 5, powerCost: 0, powerScale: 0}, // Generates power
            fuel_generator: {level: 0, name: 'Fuel Generator', effect: 'fuelPower', baseValue: 50, perLevel: 25, powerCost: 0, powerScale: 0}, // Generates power

            // Utility
            communications_antenna: {level: 0, name: 'Comms Antenna', effect: 'antennaRange', baseValue: 100, perLevel: 100, powerCost: 5, powerScale: 2},
            ship_factory: {level: 0, name: 'Ship Factory', effect: 'shipTypes', baseValue: 0, perLevel: 1, powerCost: 20, powerScale: 10},
            crafting_station: {level: 0, name: 'Crafting Station', effect: 'crafting', baseValue: 0, perLevel: 1, powerCost: 10, powerScale: 5},

            // Starts built alongside the Landing Pad: the Habitat is the colony's
            // generator, its 50m antenna, and its starter refinery (GDD 5.4).
            habitat: {level: 1, name: 'Habitat', effect: 'utility', baseValue: 0, perLevel: 0, powerCost: 2, powerScale: 1}
        };

        // Building upgrade costs (materials required per level)
        // Level 1: Construction (20 Basic usually)
        // Level 2-4: Upgrades
        function generateCost(buildAmt, tier2, tier3, tier4) {
            return [
                {basic: buildAmt}, // L1
                {industrial: tier2||5}, // L2
                {advanced: tier3||5}, // L3
                {quantum: tier4||5} // L4
            ];
        }

        // Specific overrides based on GDD table (4 levels only)
        this.buildingCosts={
            landing_pad: generateCost(20, 10, 10, 10),
            ore_storage: generateCost(20, 5, 5, 5),
            fuel_depot: generateCost(20, 5, 5, 5),
            parts_warehouse: generateCost(20, 5, 5, 5),
            fuel_refinery: generateCost(20, 20, 20, 20),
            solar_array: generateCost(20, 10, 10, 10),
            fuel_generator: generateCost(20, 10, 10, 10),
            communications_antenna: generateCost(20, 5, 5, 5),
            ship_factory: generateCost(50, 30, 30, 30),
            crafting_station: generateCost(20, 10, 10, 10),
            habitat: generateCost(20, 5, 5, 5)
        };

        // Fix special costs manually
        // Fuel Refinery (2 Industrial base)
        this.buildingCosts.fuel_refinery=[
            {industrial: 2}, // 0->1
            {industrial: 2}, {industrial: 2}, // 1->3
            {industrial: 2}, {industrial: 2}, {industrial: 2}, // 4->6
            {advanced: 2}, {advanced: 2}, {advanced: 2}, // 7->9
            {quantum: 2}, {quantum: 2}, {quantum: 2} // 10->12
        ];

        // Solar Array (1 Industrial base)
        this.buildingCosts.solar_array=[
            {industrial: 1},
            {industrial: 1}, {industrial: 1},
            {industrial: 1}, {industrial: 1}, {industrial: 1},
            {advanced: 1}, {advanced: 1}, {advanced: 1},
            {quantum: 1}, {quantum: 1}, {quantum: 1}
        ];

        // Ship Factory (5 Industrial base, 3 per level)
        this.buildingCosts.ship_factory=[
            {industrial: 5},
            {industrial: 3}, {industrial: 3},
            {industrial: 3}, {industrial: 3}, {industrial: 3},
            {advanced: 3}, {advanced: 3}, {advanced: 3},
            {quantum: 3}, {quantum: 3}, {quantum: 3}
        ];

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

        // Upgrade multipliers config (4 levels)
        this.shipUpgradeCosts=[
            {basic: 5},      // Level 1
            {industrial: 5}, // Level 2
            {advanced: 5},   // Level 3
            {quantum: 5}     // Level 4
        ];

        // Resolves the power / fuel / data graphs over the built buildings.
        this.networks=new NetworkSystem(this);

        // Depth-triggered transmissions (why anyone is digging down here).
        this.story=new Story(this);

        // Placed building instances. Populated by initStructures() once terrain
        // generation has produced positions.
        this.structures=new Map();

        // Session statistics
        this.startTime=Date.now();
        this.totalDeaths=0;
        this.totalOreCollected=0;
        this.gameEnded=false;
    }

    // Which buildings are doing work right now, and so draw their active load
    // rather than their idle load (GDD 6.3).
    getBuildingActivity() {
        let anyoneOnPad=false;
        for (const player of this.players.values()) {
            if (!player.dead&&player.landed) {anyoneOnPad=true; break;}
        }
        return {
            // The pad draws its full load while servicing a ship.
            landing_pad: anyoneOnPad,
            // The Factory and Crafting Station are only reachable from the pad.
            ship_factory: anyoneOnPad,
            crafting_station: anyoneOnPad,
            fuel_refinery: !!this.isRefining
        };
    }

    // ---- Placed structures ------------------------------------------------
    // `this.structures` is the source of truth: every building that physically
    // exists, with its own level and position. `this.buildings` survives as the
    // per-type definition table, and its `level` field is kept in sync as the
    // highest level among that type's instances so older call sites still work.
    //
    // The first instance of a type is given the bare type name as its id
    // ('landing_pad'), later ones get 'landing_pad#2'. That keeps every existing
    // id -- network node ids, shed ordering, isPowered('landing_pad') -- valid.
    makeStructureId(type) {
        if (!this.structures.has(type)) return type;
        let n=2;
        while (this.structures.has(`${type}#${n}`)) n++;
        return `${type}#${n}`;
    }

    addStructure(type, x, y, level=1) {
        const def=this.buildings[type];
        if (!def) return null;
        const id=this.makeStructureId(type);
        const structure={id, type, level, x, y};
        this.structures.set(id, structure);
        this.syncBuildingLevels();
        return structure;
    }

    // Mirror instance levels back onto the type table.
    syncBuildingLevels() {
        for (const [key, def] of Object.entries(this.buildings)) {
            let best=0;
            for (const s of this.structures.values()) {
                if (s.type===key&&s.level>best) best=s.level;
            }
            def.level=best;
        }
        this.networks?.markDirty();
    }

    structuresOfType(type) {
        return Array.from(this.structures.values()).filter(s => s.type===type);
    }

    // Seed the starting base from the map's authored building positions. Called
    // once after terrain generation, when positions exist.
    initStructures() {
        // Snapshot the authored starting levels FIRST. addStructure() calls
        // syncBuildingLevels(), which recomputes every type's level from the
        // instances that exist so far -- so reading def.level inside the loop
        // would see types zeroed out before their turn came up, and only the
        // first building would ever be created.
        const startingLevels={};
        for (const [key, def] of Object.entries(this.buildings)) {
            startingLevels[key]=def.level;
        }

        this.structures.clear();
        for (const pos of this.voxelMap.buildingPositions||[]) {
            if (!this.buildings[pos.id]) continue;
            // Only types that start built become instances; the rest are placed
            // by the player later.
            const level=startingLevels[pos.id]||0;
            if (level>0) this.addStructure(pos.id, pos.x, pos.y, level);
        }
        this.syncBuildingLevels();
    }

    // Total effect of a building type, summed over every instance that is
    // actually connected and powered. Capacity sums across instances -- building
    // a second depot really does add storage -- and the cost of doing so is the
    // extra power draw each instance puts on the grid.
    //
    // Gating on the network matters: without it a Fuel Depot cabled to nothing
    // would still raise global storage, which would make the whole network
    // system cosmetic for capacities.
    getBuildingEffect(buildingKey) {
        const def=this.buildings[buildingKey];
        if (!def) return 0;

        let total=0;
        for (const s of this.structuresOfType(buildingKey)) {
            if (s.level<=0) continue;
            if (this.networks&&!this.networks.isPowered(s.id)) continue;
            // Formula unchanged from before instances (base + level*perLevel) so
            // this change does not move existing balance. See Appendix C item 12
            // for the long-standing off-by-one in that convention.
            total+=def.baseValue+(s.level*def.perLevel);
        }
        return total;
    }

    // Largest coverage bubble currently on the air, used by the minimap as a
    // fallback radius. Real per-antenna coverage is in networks.serialize().data,
    // and per-player signal is resolved in getState().
    getAntennaRange() {
        let best=0;
        for (const net of this.networks.state.dataNets) {
            for (const c of net.coverage) best=Math.max(best, c.r);
        }
        return best;
    }

    canAffordUpgrade(buildingKey) {
        // Resolves to the instance that upgradeBuilding() would actually pick, so
        // the UI's enabled/disabled state matches what the button will do.
        const structure=this.resolveStructure(buildingKey);
        if (!structure) return false;

        const building=this.buildings[structure.type];
        if (!building||structure.level>=4) return false;

        const costs=this.buildingCosts[structure.type];
        if (!costs||structure.level>=costs.length) return false;

        const levelCost=costs[structure.level]; // Cost for NEXT level
        const materialMap={
            basic: 'basic',
            industrial: 'industrial',
            advanced: 'advanced',
            quantum: 'quantum'
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
    // Upgrades one placed instance. `target` may be an instance id
    // ('fuel_depot#2') or a bare type, in which case the lowest-level instance
    // of that type is upgraded so repeated clicks level a base evenly.
    upgradeBuilding(target) {
        const structure=this.resolveStructure(target);
        if (!structure) return false;

        const def=this.buildings[structure.type];
        const costs=this.buildingCosts[structure.type];
        if (!def||!costs) return false;
        if (structure.level>=4||structure.level>=costs.length) return false;

        const levelCost=costs[structure.level]; // Cost to get to next level
        const materials=['basic', 'industrial', 'advanced', 'quantum'];

        for (const [matType, amount] of Object.entries(levelCost)) {
            if (!materials.includes(matType)||this.baseResources[matType]<amount) return false;
        }
        for (const [matType, amount] of Object.entries(levelCost)) {
            this.baseResources[matType]-=amount;
        }

        structure.level++;
        this.syncBuildingLevels();
        this.applyBuildingEffects();

        console.log(`Upgraded ${def.name} (${structure.id}) to level ${structure.level}`);

        this.broadcast('buildingUpgraded', {
            building: structure.type,
            instanceId: structure.id,
            newLevel: structure.level,
            name: def.name
        });
        this.broadcast('resourcesUpdated', this.baseResources);

        return true;
    }

    // ---- Placing new buildings -------------------------------------------
    // Radius of the buildable zone a Landing Pad projects (GDD 5.2).
    //
    // 400, not the 200 originally specced. Building sprites render 92 units wide
    // and need ~100 units of spacing, and the deck band is only +/-60 tall, so a
    // 200 radius leaves room for roughly three buildings once the pad and
    // Habitat have taken their places -- not enough for a working base out of
    // eleven building types. At 400 a base fits about seven.
    get buildRadius() {
        return this.config?.difficulty?.buildRadius??400;
    }

    // Minimum spacing between buildings. Sprites render 92 units wide, so
    // anything closer overlaps visibly.
    get buildSpacing() {
        return this.config?.difficulty?.buildSpacing??100;
    }

    // Can `type` be placed at (x,y)? Returns {ok} or {ok:false, reason}.
    canPlaceBuilding(type, x, y) {
        const def=this.buildings[type];
        if (!def) return {ok: false, reason: 'unknown_building'};

        const costs=this.buildingCosts[type];
        if (!costs) return {ok: false, reason: 'unknown_building'};
        const cost=costs[0];
        for (const [mat, amount] of Object.entries(cost)) {
            if ((this.baseResources[mat]||0)<amount) {
                return {ok: false, reason: 'insufficient_materials', required: cost};
            }
        }

        // Build zone is checked before terrain: for a click far off in the rock
        // both are true, and "outside the build zone" is the more useful reason.
        // The Landing Pad is the anchor -- it establishes a new base and so is
        // the one building that does not need to be inside an existing zone.
        if (type!=='landing_pad') {
            const pads=this.structuresOfType('landing_pad');
            const inZone=pads.some(p => Math.hypot(p.x-x, p.y-y)<=this.buildRadius);
            if (!inZone) return {ok: false, reason: 'outside_build_zone'};
        }

        // A building's anchor sits ON the ground, so the anchor tile itself is
        // solid by definition -- testing it would reject even the authored
        // starting positions. What matters is headroom: the space the building
        // actually occupies, above the anchor, must be clear.
        const headroom=this.voxelMap.tileSize*2;
        if (this.voxelMap.isSolidAtWorld(x, y-headroom)) {
            return {ok: false, reason: 'blocked_by_terrain'};
        }

        // Spacing.
        for (const s of this.structures.values()) {
            if (Math.hypot(s.x-x, s.y-y)<this.buildSpacing) {
                return {ok: false, reason: 'too_close_to_building'};
            }
        }

        return {ok: true};
    }

    // Place a new building instance, paying from base materials.
    placeBuilding(playerId, type, x, y) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false, reason: 'dead'};

        const check=this.canPlaceBuilding(type, x, y);
        if (!check.ok) return {success: false, ...check};

        const cost=this.buildingCosts[type][0];
        for (const [mat, amount] of Object.entries(cost)) {
            this.baseResources[mat]-=amount;
        }

        const structure=this.addStructure(type, x, y, 1);
        this.applyBuildingEffects();

        console.log(`Placed ${type} as ${structure.id} at (${Math.round(x)}, ${Math.round(y)})`);

        this.broadcast('buildingPlaced', {
            instanceId: structure.id,
            type,
            x: structure.x,
            y: structure.y,
            name: this.buildings[type].name
        });
        this.broadcast('resourcesUpdated', this.baseResources);

        return {success: true, instanceId: structure.id};
    }

    // Accepts an instance id or a bare type name.
    resolveStructure(target) {
        if (!target) return null;
        if (this.structures.has(target)) return this.structures.get(target);
        const ofType=this.structuresOfType(target);
        if (ofType.length===0) return null;
        return ofType.reduce((lowest, s) => s.level<lowest.level? s:lowest, ofType[0]);
    }

    craftMaterial(tier, amount=1) {
        // Obsolete: Materials are now automatically refined.
        // But let's keep it if we need manual fallback.
        return false;
    }

    purchaseShip(playerId, type) {
        const player=this.players.get(playerId);
        // Requirement: Player must be on pad or docked? GDD doesn't specify but implies "at base".
        // We'll require player to be on pad.
        if (!player||!player.onPad) return {success: false, reason: 'must_be_on_pad'};

        // Cost: Cargo Hauler = 50 Industrial
        if (type==='cargo') {
            const cost=50;
            if (this.baseResources.industrial<cost) {
                return {success: false, reason: 'insufficient_materials', required: cost};
            }
            this.baseResources.industrial-=cost;
            player.setShipType('cargo');
            this.broadcast('resourcesUpdated', this.baseResources);
            return {success: true};
        }

        return {success: false, reason: 'unknown_ship'};
    }

    upgradeShip(playerId, upgradeKey) {
        const player=this.players.get(playerId);
        if (!player||!player.onPad) return {success: false, reason: 'must_be_on_pad'};

        // Check if upgrade exists
        const currentLevel=player.upgrades[upgradeKey];
        if (currentLevel===undefined) return {success: false, reason: 'invalid_upgrade'};
        if (currentLevel>=4) return {success: false, reason: 'max_level'};

        // Determine cost (5 materials of current level's tier)
        const costConfig=this.shipUpgradeCosts[currentLevel];
        const materialMap={
            basic: 'basic',
            industrial: 'industrial',
            advanced: 'advanced',
            quantum: 'quantum'
        };

        // Check affordability
        for (const [matType, amount] of Object.entries(costConfig)) {
            const key=materialMap[matType];
            if (this.baseResources[key]<amount) {
                return {success: false, reason: 'insufficient_materials'};
            }
        }

        // Deduct
        for (const [matType, amount] of Object.entries(costConfig)) {
            const key=materialMap[matType];
            this.baseResources[key]-=amount;
        }

        // Apply Upgrade
        player.upgrades[upgradeKey]++;
        player.applyUpgrades();

        this.broadcast('resourcesUpdated', this.baseResources);
        return {success: true, level: player.upgrades[upgradeKey]};
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

        // Power generation and consumption are no longer derived here -- they are
        // resolved per-network by NetworkSystem from what is actually built and
        // connected. See processStationResources() for where the totals land.

        // Building levels changed, so the network graph must be rebuilt.
        this.networks?.markDirty();
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

        // Building positions only exist after generation, so the starting
        // structures, the network graph and the landing pad's starting fuel are
        // all seeded here rather than in the constructor.
        this.initStructures();
        this.networks.markDirty();
        this.networks.seedStartingTanks();
        this.networks.solve(0.1, this.getBuildingActivity());
        console.log(`Game init: networks resolved (${this.networks.state.totals.supply} kW supply)`);

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

    // Removed: handleCableAction() was a second, duplicate entry point into
    // CableSystem. index.js registered listeners for both it and the direct
    // cableSystem calls, so every cable action was applied twice. Socket
    // handling now goes through the single 'cableAction' listener in index.js.

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

            // A pad with no power provides no services at all (GDD 5.2).
            const padPowered=this.networks.isPowered('landing_pad');
            player.padPowered=padPowered;
            player.padFuel=this.networks.padFuelAvailable('landing_pad');

            if (isLanded&&padPowered) {
                // Refuel from the pad's own tank. The tank refills over the green
                // network; a pad with no fuel line runs dry and cannot refuel.
                if (player.fuel<player.maxFuel) {
                    const fuelNeeded=Math.min(this.config.resources.refuelRate*dt, player.maxFuel-player.fuel);
                    const fuelAvailable=this.networks.consumePadFuel(fuelNeeded, 'landing_pad');
                    if (fuelAvailable>0) player.fuel+=fuelAvailable;
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

        // Update persistent voxel health (slowly heal voxels not being mined)
        this.updateVoxelPersistence(dt);

        // Update cable spools
        this.cableSystem.update(dt);

        // Resolve the power / fuel / data networks. This is graph work over every
        // building, so it runs at 10Hz rather than every frame; the accumulated dt
        // is passed through so energy and fuel integrate correctly regardless.
        this.networkAccum+=dt;
        if (this.networkAccum>=0.1) {
            this.networks.solve(this.networkAccum, this.getBuildingActivity());
            this.baseResources.fuel=Math.max(0, this.baseResources.fuel-this.networks.burnGeneratorFuel(this.networkAccum));
            this.networkAccum=0;
        }

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

            if (player.dead&&!wasDead) {
                this.totalDeaths++;
                if (player.shipType==='eva') {
                    this.removePlayerVehicles(player.id);
                }
            }
        }

        // Enforce flight ceiling
        this.enforceFlightCeiling();

        // Update Exploration
        this.updateExploration();

        // Check conditions
        this.story.update();
        this.checkWinCondition();
        this.checkLoseCondition();
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
            const factoryLevel=this.buildings.ship_factory.level;
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
                    'Platinum': 'platinum', 'Diamond': 'diamond', 'Helium3': 'helium3'
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

    // Spawn a dropped item at specific coordinates
    spawnDroppedItem(x, y, type, amount) {
        const itemId=`drop_${this.nextDroppedItemId++}`;

        // Random slight scatter
        const dropX=x+(Math.random()-0.5)*20;
        const dropY=y+(Math.random()-0.5)*20;

        // Create physics body
        const body=this.physics.createBox(dropX, dropY, 6, 6, 0.5);
        if (body) {
            // Give it a little random velocity
            const ammo=this.physics.ammo;
            body.setLinearVelocity(new ammo.btVector3((Math.random()-0.5)*10, (Math.random()-0.5)*10, 0));
        }

        const droppedItem={
            id: itemId,
            x: dropX,
            y: dropY,
            type: type,
            amount: amount,
            body: body,
            lifetime: 300 // 5 minutes
        };

        this.droppedItems.set(itemId, droppedItem);

        // Broadcast
        this.broadcast('itemsDropped', {
            playerId: null, // System spawn
            items: [{type: type, amount: amount}],
            x: dropX,
            y: dropY
        });

        return {success: true, itemId};
    }

    // Jettison cargo with physics - creates dropped items that fall
    // Drop specific item from inventory (100% of stack)
    dropInventoryItem(playerId, slotIndex) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false};

        if (slotIndex<0||slotIndex>=player.cargo.length) return {success: false};

        const item=player.cargo[slotIndex];
        if (!item) return {success: false};

        // Remove from inventory
        player.cargo.splice(slotIndex, 1);

        // Spawn in world
        const pos=player.getPosition();
        const vel=player.getVelocity();

        const itemId=`drop_${this.nextDroppedItemId++}`;
        const dropX=pos.x+(Math.random()-0.5)*20;
        const dropY=pos.y+(Math.random()-0.5)*20;

        // Create physics body
        const body=this.physics.createBox(dropX, dropY, 6, 6, 0.5);
        if (body) {
            const ammo=this.physics.ammo;
            body.setLinearVelocity(new ammo.btVector3(vel.vx, vel.vy, 0));
        }

        const droppedItem={
            id: itemId,
            x: dropX,
            y: dropY,
            type: item.type,
            amount: item.amount,
            body: body,
            lifetime: 300 // 5 minutes
        };

        this.droppedItems.set(itemId, droppedItem);

        // Broadcast
        this.broadcast('itemsDropped', {
            playerId: playerId,
            items: [{type: item.type, amount: item.amount}],
            x: dropX,
            y: dropY
        });

        // Loophole: If it was a cable, we should check if they were in cable mode?
        // Actually, cable mode is just client side input state mostly.

        return {success: true};
    }

    // Explicit pickup of dropped item (when clicking in UI)
    pickupDroppedItem(playerId, itemId) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false};

        const item=this.droppedItems.get(itemId);
        if (!item) return {success: false, reason: 'not_found'};

        // Check distance
        const dx=item.x-player.x;
        const dy=item.y-player.y;
        const dist=Math.sqrt(dx*dx+dy*dy);

        if (dist>100) return {success: false, reason: 'too_far'}; // Generous pickup range for UI interaction

        // Check capacity
        const currentWeight=player.cargo.reduce((sum, c) => sum+c.amount, 0);
        const maxCargo=player.maxCargoCapacity||500;

        if (currentWeight+item.amount>maxCargo) return {success: false, reason: 'full'};

        // Add to cargo
        const existing=player.cargo.find(c => c.type===item.type);
        if (existing) {
            existing.amount+=item.amount;
        } else {
            player.cargo.push({type: item.type, amount: item.amount});
        }

        // Remove from world
        if (item.body) {
            this.physics.world.removeRigidBody(item.body);
        }
        this.droppedItems.delete(itemId);

        return {success: true};
    }

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
                    // Check if it's a valid resource type
                    if (this.baseResources[oreKey]!==undefined) {
                        this.baseResources[oreKey]+=item.amount;
                        toRemove.push(id);
                        console.log(`Collected dropped ${item.type} x${item.amount} at landing pad`);
                    }
                    // Non-resource items (like cables) are left alone on the pad
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

    // Unload cargo from player to base (Instant transfer for ores)
    unloadCargo(player) {
        if (player.cargo.length===0) return;

        let totalUnloaded=0;
        let valueDelivered=0;
        const nonOreCargo=[];

        console.log(`Unloading cargo for player ${player.id}, items: ${player.cargo.length}`);

        for (const cargoItem of player.cargo) {
            const oreType=cargoItem.type;
            const amount=cargoItem.amount;
            const oreConfig=ORE_CONFIG[oreType];

            // If not an ore, save it for later re-assignment
            if (!oreConfig||!oreConfig.isResource) {
                nonOreCargo.push(cargoItem);
                continue;
            }

            // Add to base storage using proper key mapping
            const oreNameMap={
                'Iron': 'iron',
                'Copper': 'copper',
                'Bitite': 'bitite',
                'Silver': 'silver',
                'Titanium': 'titanium',
                'Gold': 'gold',
                'Platinum': 'platinum',
                'Diamond': 'diamond',
                'Helium3': 'helium3'
            };
            const storageKey=oreNameMap[oreConfig.name];
            if (storageKey&&this.baseResources.hasOwnProperty(storageKey)) {
                this.baseResources[storageKey]+=amount;
                console.log(`Base Resources Updated: ${storageKey} += ${amount} (New Total: ${this.baseResources[storageKey]})`);
            } else {
                console.warn(`Could not find storage key for ore: ${oreConfig.name}`);
                nonOreCargo.push(cargoItem);
                continue;
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

        // Keep only non-ore items (like cables)
        player.cargo=nonOreCargo;
        player.updateMass();

        // Update total value
        this.baseResources.totalValue+=valueDelivered;

        if (totalUnloaded>0) {
            console.log(`Player ${player.id} delivered ${totalUnloaded} cargo successfully.`);

            // Broadcast cargo delivery
            this.broadcast('cargoDelivered', {
                playerId: player.id,
                amount: totalUnloaded,
                value: valueDelivered,
                totalValue: this.baseResources.totalValue
            });

            // Immediately broadcast resource update to all players
            this.broadcast('resourcesUpdated', this.getClientResources());
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

        // Target changed? 
        if (!player.miningTarget||player.miningTarget.gx!==target.gx||player.miningTarget.gy!==target.gy) {
            player.miningTarget={gx: target.gx, gy: target.gy, worldX: target.worldX, worldY: target.worldY};
        }

        if (!player.consumeMiningPower(dt)) return;

        // Progress mining - now stored in VoxelMap for persistence
        const damageAmount=this.config.mining.speedBase*this.config.difficulty.miningSpeedMultiplier*dt;
        const totalProgress=this.voxelMap.damageTile(target.gx, target.gy, damageAmount);

        // Sync player local progress for HUD/UI (this allows the client to still see the bar)
        player.miningProgress=totalProgress;

        if (totalProgress>=1) {
            const tile=this.voxelMap.get(target.gx, target.gy);
            const oreConfig=ORE_CONFIG[tile];

            if (oreConfig&&oreConfig.isResource) {
                const extracted=player.addCargo(tile, oreConfig.yield);
                if (extracted>0) {
                    this.totalOreCollected+=extracted;
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

    // Slowly heal voxels that aren't being actively mined
    updateVoxelPersistence(dt) {
        if (!this.voxelMap.damagedVoxels||this.voxelMap.damagedVoxels.size===0) return;

        // Get all voxels currently being targeted by players
        const activeTargets=new Set();
        for (const player of this.players.values()) {
            if (player.mining&&player.miningTarget) {
                activeTargets.add(`${player.miningTarget.gx},${player.miningTarget.gy}`);
            }
        }

        const toRemove=[];
        const HEAL_SPEED=0.04; // 4% per second - takes 25s for full recovery

        for (const key of this.voxelMap.damagedVoxels) {
            if (activeTargets.has(key)) continue;

            const [gx, gy]=key.split(',').map(Number);
            const idx=gy*this.voxelMap.width+gx;

            this.voxelMap.miningProgress[idx]-=HEAL_SPEED*dt;
            if (this.voxelMap.miningProgress[idx]<=0) {
                this.voxelMap.miningProgress[idx]=0;
                toRemove.push(key);
            }
        }

        for (const key of toRemove) {
            this.voxelMap.damagedVoxels.delete(key);
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

        // Hand-filling a building's tank from the ship (hold F near it).
        for (const player of playerList) {
            this.updateHandFill(player, dt);
        }

        // Reset transfer state for players not transferring
        for (const player of playerList) {
            if (!player.fuelTransferring) {
                player.fuelTransferred=0;
            }
        }
    }

    // Pour fuel from a ship into a nearby building tank. This is how a remote
    // base gets started: its Fuel Generator needs fuel, but fuel only flows from
    // a POWERED Fuel Depot, which needs the generator already running. Flying
    // fuel down and pouring it in by hand is what breaks that circle (GDD 6.3).
    updateHandFill(player, dt) {
        const targets=this.networks.handFillableAt(player.x, player.y);
        player.handFillTarget=targets.length? targets[0]:null;

        if (!player.inputs.transferFuel||player.fuel<=0||!targets.length) return;
        // Don't fight the ship-to-ship transfer for the same keypress.
        if (player.fuelTransferring) return;

        const target=targets[0];
        const wanted=Math.min(FUEL_TRANSFER_RATE*dt, player.fuel);
        const poured=this.networks.fillTank(target.id, wanted);
        if (poured>0) {
            player.fuel-=poured;
            player.handFilling=true;
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
        // Throughput is the sum of every powered refiner: the Habitat's small
        // built-in refinery (always available, since the Habitat powers itself)
        // plus a Fuel Refinery if one is built and currently has power.
        const PROCESSING_SPEED=this.networks.refiningRate()*dt;

        // Refining logic:
        const refineOres=(type, outputKey, bonuses) => {
            if (this.baseResources[type]>0) {
                const amount=Math.min(PROCESSING_SPEED, this.baseResources[type]);
                const config=this.config.ores[type];
                const yieldAmt=config? config.yield:1;

                // Primary output
                const primaryOutput=amount*yieldAmt;
                this.baseResources[outputKey]+=primaryOutput;

                // Bonus outputs (lower tiers)
                if (bonuses) {
                    for (const [bonusKey, fraction] of Object.entries(bonuses)) {
                        this.baseResources[bonusKey]+=primaryOutput*fraction;
                    }
                }

                this.baseResources[type]-=amount;
                isRefining=true;
            }
        };

        // Bitite to Fuel. Stalls when no powered refiner has anywhere to put the
        // fuel it makes -- no depot on its green network and every pad tank full.
        if (this.baseResources.bitite>0&&this.baseResources.fuel<this.baseResources.maxFuel&&this.networks.canRefineFuel()) {
            const amount=Math.min(PROCESSING_SPEED, this.baseResources.bitite);
            const yieldAmt=this.config.ores.bitite.yield;
            this.baseResources.bitite-=amount;
            this.baseResources.fuel=Math.min(this.baseResources.maxFuel, this.baseResources.fuel+amount*yieldAmt);
            isRefining=true;
        }

        // Iron/Copper -> Basic (100%)
        refineOres('iron', 'basic');
        refineOres('copper', 'basic');

        // Silver/Titanium -> Industrial (90%) + Basic (10%)
        refineOres('silver', 'industrial', {basic: 0.1});
        refineOres('titanium', 'industrial', {basic: 0.1});

        // Gold/Platinum -> Advanced (80%) + Industrial (10%) + Basic (10%)
        refineOres('gold', 'advanced', {industrial: 0.1, basic: 0.1});
        refineOres('platinum', 'advanced', {industrial: 0.1, basic: 0.1});

        // Diamond/Helium-3 -> Quantum (70%) + Advanced (10%) + Industrial (10%) + Basic (10%)
        refineOres('diamond', 'quantum', {advanced: 0.1, industrial: 0.1, basic: 0.1});
        refineOres('helium3', 'quantum', {advanced: 0.1, industrial: 0.1, basic: 0.1});

        this.isRefining=isRefining;

        // Power is resolved per-network by NetworkSystem (flow in kW, with a
        // buffer in kJ). These aggregate fields are kept in sync purely so the
        // existing HUD keeps working: `power`/`maxPower` are the grid buffer.
        const totals=this.networks.state.totals;
        this.baseResources.powerGeneration=totals.supply;
        this.baseResources.powerConsumption=totals.demand;
        this.baseResources.power=totals.buffer;
        this.baseResources.maxPower=Math.max(1, totals.bufferCapacity);

        // Update oxygen generation
        this.baseResources.oxygen=Math.min(this.baseResources.maxOxygen, this.baseResources.oxygen+1.5*dt);
    }

    checkWinCondition() {
        // Without this guard the victory broadcast re-fires every tick at 60Hz
        // for as long as anyone stands past the win line. checkLoseCondition()
        // already had it; this one set gameEnded but never read it.
        if (this.gameEnded) return;

        // Win: reach the Core Chamber at the bottom of the map. Depth comes from
        // VoxelMap's authoritative scale rather than a hardcoded surface Y --
        // the old constant (1200) sat ~270m above the real surface, so the game
        // was won at 4732m in the Crystal Caverns while claiming 5000m.
        const TARGET_DEPTH=this.voxelMap.TOTAL_DEPTH_METERS*CORE_WIN_DEPTH_FRACTION;

        for (const player of this.players.values()) {
            if (!player.dead&&this.voxelMap.getDepthMeters(player.y)>=TARGET_DEPTH) {
                this.broadcast('gameOver', {
                    won: true,
                    reason: 'core_reached',
                    // Real measured depth, not a constant. The client used to be
                    // told 5000 regardless of where the player actually was.
                    depth: Math.round(this.voxelMap.getDepthMeters(player.y)),
                    time: (Date.now()-this.startTime)/1000,
                    oreCollected: this.totalOreCollected||0,
                    deaths: this.totalDeaths||0,
                    reveal: CORE_REVEAL
                });
                this.gameEnded=true;
                return;
            }
        }
    }

    checkLoseCondition() {
        if (this.gameEnded) return;

        const alive=this.getAlivePlayerCount()>0;
        if (alive) return;

        // Everyone dead. Can we respawn?
        const canRespawn=this.baseResources.spareParts>=this.config.resources.respawnCost;
        if (!canRespawn) {
            this.broadcast('gameOver', {
                won: false,
                reason: 'colony_lost',
                time: (Date.now()-this.startTime)/1000,
                oreCollected: this.totalOreCollected||0,
                deaths: this.totalDeaths||0
            });
            this.gameEnded=true;
        }
    }

    getClientResources() {
        return {
            ...this.baseResources,
            ores: {
                iron: this.baseResources.iron,
                copper: this.baseResources.copper,
                bitite: this.baseResources.bitite,
                silver: this.baseResources.silver,
                titanium: this.baseResources.titanium,
                gold: this.baseResources.gold,
                platinum: this.baseResources.platinum,
                diamond: this.baseResources.diamond,
                helium3: this.baseResources.helium3
            },
            materials: {
                basic: this.baseResources.basic,
                industrial: this.baseResources.industrial,
                advanced: this.baseResources.advanced,
                quantum: this.baseResources.quantum
            }
        };
    }

    getState() {
        if (!this.ready) return {players: [], baseResources: this.baseResources, respawnCost: this.config.resources.respawnCost};

        const clientResources=this.getClientResources();

        return {
            // Each player carries the Data Net they are currently standing in.
            // Two players on different nets cannot see each other's live blip,
            // which is resolved here rather than trusted to the client (GDD 7.3).
            players: Array.from(this.players.values()).map(p => {
                const s=p.serialize();
                s.dataNet=this.networks.dataNetAt(p.x, p.y);
                // Nearest tank the player could pour fuel into, for the HUD prompt.
                s.handFillTarget=p.handFillTarget||null;
                // Authoritative depth, so the HUD and the victory screen can
                // never disagree with the win condition about how deep you are.
                s.depth=Math.round(this.voxelMap.getDepthMeters(p.y));
                return s;
            }),
            totalDepth: this.voxelMap.TOTAL_DEPTH_METERS,
            coreDepth: Math.round(this.voxelMap.TOTAL_DEPTH_METERS*CORE_WIN_DEPTH_FRACTION),
            // Placement rules, so the ghost preview draws the same zones the
            // server validates against rather than its own guesses.
            buildRadius: this.buildRadius,
            buildSpacing: this.buildSpacing,
            baseBusBand: this.networks.baseBusElevationBand,
            baseResources: clientResources,
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
            activeBuildings: this.getActiveBuildings(), // NEW: Send only built buildings
            cables: this.cableSystem.serialize(), // Send active cables
            networks: this.networks.serialize(),  // Power/fuel/data status per building
            timestamp: Date.now()
        };
    }

    // Every placed building, for rendering and cable targeting. `id` is the
    // instance id; `type` is what sprite to draw.
    getActiveBuildings() {
        const active=[];
        for (const s of this.structures.values()) {
            if (s.level<=0) continue;
            active.push({id: s.id, type: s.type, x: s.x, y: s.y, level: s.level});
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
        const items=[];
        for (const [id, item] of this.droppedItems) {
            items.push({
                id: item.id,
                x: item.x,
                y: item.y,
                type: item.type,
                amount: item.amount
            });
        }
        return items;
    }

    // Serialize buildings for client
    serializeBuildings() {
        const result={};
        for (const [key, building] of Object.entries(this.buildings)) {
            result[key]={
                level: building.level,
                name: building.name,
                maxLevel: 4,
                canUpgrade: this.canAffordUpgrade(key),
                currentEffect: this.getBuildingEffect(key),
                nextCost: building.level<4? this.buildingCosts[key][building.level]:null,
                // How many of this type physically exist, and where.
                instances: this.structuresOfType(key).map(s => ({
                    id: s.id,
                    level: s.level,
                    x: s.x,
                    y: s.y,
                    powered: this.networks? this.networks.isPowered(s.id):true
                }))
            };
        }
        return result;
    }
    placeCableSegment(playerId, segmentData) {
        const {x1, y1, x2, y2, type}=segmentData;
        const player=this.players.get(playerId);

        if (!player) return {success: false};

        // Cost Check (1 Basic Material)
        if (this.baseResources.basic<1&&!player.infiniteFuel) {
            return {success: false, reason: 'no_materials'};
        }

        const result=this.cableSystem.addSegment(x1, y1, x2, y2, type);

        if (result.success) {
            if (!player.infiniteFuel) {
                this.baseResources.basic--;
            }
            this.broadcast('resourcesUpdated', this.baseResources);
        }

        return result;
    }

    craftItem(playerId, type) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false, reason: 'dead'};

        // Define recipes (now use basic material as requested)
        const recipes={
            'cable_red': {basic: 20},
            'cable_green': {basic: 20},
            'cable_blue': {basic: 20},
            'light': {basic: 20}
        };

        const recipe=recipes[type];
        if (!recipe) return {success: false, reason: 'invalid_item'};

        // Check costs
        for (const [res, amt] of Object.entries(recipe)) {
            if ((this.baseResources[res]||0)<amt) {
                return {success: false, reason: 'insufficient_resources'};
            }
        }

        // Check capacity
        const currentWeight=player.cargo.reduce((sum, c) => sum+c.amount, 0);
        const maxCargo=player.maxCargoCapacity||500;
        if (currentWeight+1>maxCargo) return {success: false, reason: 'cargo_full'};

        // Deduct resources
        for (const [res, amt] of Object.entries(recipe)) {
            this.baseResources[res]-=amt;
        }

        // Add to cargo
        const existing=player.cargo.find(c => c.type===type);
        if (existing) {
            existing.amount+=1;
        } else {
            player.cargo.push({type: type, amount: 1});
        }

        player.updateMass();
        this.broadcast('resourcesUpdated', this.baseResources);

        return {success: true};
    }
    moveInventoryItem(playerId, fromIndex, toIndex) {
        const player=this.players.get(playerId);
        if (!player||player.dead) return {success: false};

        const cargo=player.cargo;
        if (fromIndex<0||fromIndex>=cargo.length) return {success: false};

        // If toIndex is beyond current length, just push if room?
        // Actually, let's assume fixed slots if we want specific hotbar positions.
        // But player.cargo is a dynamic array.
        // We might need to pad it with nulls or just handle sparse array.

        // Let's ensure toIndex is within a reasonable range (e.g. 0-19)
        if (toIndex<0||toIndex>=20) return {success: false};

        // Padding cargo up to the required slots if needed
        while (cargo.length<=Math.max(fromIndex, toIndex)) {
            cargo.push(null);
        }

        const temp=cargo[fromIndex];
        cargo[fromIndex]=cargo[toIndex];
        cargo[toIndex]=temp;

        // Clean up trailing nulls maybe? Or keep them to maintain positions.
        // If we keep them, the length shows the "active range".

        return {success: true};
    }
}

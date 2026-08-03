// NetworkSystem.js
//
// Resolves the three independent building networks described in GDD section 6:
//   - Power Grid (red)  : kW of supply vs demand, with a buffer and load shedding
//   - Fuel Line (green) : moves refined fuel from sources to depots / landing pads
//   - Data Net (blue)   : merges antenna coverage into shared minimap networks
//
// A "node" is a built building. Today the game supports exactly one instance of
// each building type, so node id === building key. Every place that enumerates
// nodes goes through collectNodes(), so moving to multiple placed instances later
// is a change to that one method rather than to the solver.

export const NET_POWER='power';
export const NET_FUEL='fuel';
export const NET_DATA='data';
export const NETWORKS=[NET_POWER, NET_FUEL, NET_DATA];

// Cable types arrive from several places using different vocabularies:
// the client sends 'power'/'fuel'/'data', crafted inventory items are named
// 'cable_red'/'cable_green'/'cable_blue', and older code used bare colours.
// Everything is normalised to the NET_* constants at the boundary.
export function normalizeCableType(raw) {
    if (!raw) return null;
    const s=String(raw).toLowerCase();
    if (s.includes('power')||s.includes('red')) return NET_POWER;
    if (s.includes('fuel')||s.includes('green')) return NET_FUEL;
    if (s.includes('data')||s.includes('blue')) return NET_DATA;
    return null;
}

// Per-building network behaviour. Values are Level 1; `perLevel` is added for
// each level above 1 (so Level 1 == the base value, matching GDD 6.3).
//
// NOTE: this deliberately does not use Game.getBuildingEffect(), which computes
// base + level*perLevel and so already over-counts at Level 1 (see GDD Appendix C
// item 10). Power/fuel/data scaling is computed here from the level directly.
export const BUILDING_NETWORK_SPEC={
    habitat: {
        power: {gen: 15, genPerLevel: 5, idle: 2, active: 2, drawPerLevel: 1, selfPowered: true, buffer: 100, bufferPerLevel: 50},
        // Sized to cover the whole landing pad deck: the Habitat sits 136 units
        // from the pad centre and the pad bounds run ~90 further, so a 50m bubble
        // would leave a fresh game with no minimap at its own base.
        data: {range: 250, rangePerLevel: 0},
        // The Habitat contains a small built-in refinery -- the starter kit. It is
        // slow, but because the Habitat powers itself it can never be shut off, so
        // the player can always process ore into materials and Bitite into fuel.
        refine: {rate: 3, ratePerLevel: 1},
        fuel: {role: 'source'}
    },
    landing_pad: {
        power: {idle: 2, active: 5, drawPerLevel: 2},
        // Starts full: this tank is the fuel a fresh game runs on, before any
        // depot exists to reach the colony's wider reserves.
        fuel: {role: 'dispense', tank: 500, tankPerLevel: 250, startsFull: true}
    },
    ore_storage: {power: {idle: 1, active: 1, drawPerLevel: 0.5}},
    fuel_depot: {
        power: {idle: 1, active: 1, drawPerLevel: 0.5},
        fuel: {role: 'store'}
    },
    parts_warehouse: {power: {idle: 1, active: 1, drawPerLevel: 0.5}},
    fuel_refinery: {
        power: {idle: 3, active: 15, drawPerLevel: 5},
        fuel: {role: 'source', tank: 200, tankPerLevel: 0},
        // Roughly 3x the Habitat's built-in refinery at Level 1 and scaling far
        // harder -- but it costs 15 kW, which a starting base cannot supply.
        refine: {rate: 8, ratePerLevel: 4}
    },
    solar_array: {
        power: {gen: 10, genPerLevel: 5, solar: true, buffer: 50, bufferPerLevel: 0}
    },
    fuel_generator: {
        power: {gen: 50, genPerLevel: 25, buffer: 100, bufferPerLevel: 0},
        fuel: {role: 'burn', tank: 100, tankPerLevel: 0, burnAtFullLoad: 0.4}
    },
    communications_antenna: {
        power: {idle: 5, active: 5, drawPerLevel: 2},
        data: {range: 100, rangePerLevel: 100}
    },
    ship_factory: {power: {idle: 4, active: 20, drawPerLevel: 10}},
    crafting_station: {power: {idle: 2, active: 10, drawPerLevel: 5}},
    placeable_light: {power: {idle: 1, active: 1, drawPerLevel: 0}}
};

// Lowest priority first. The last things to lose power are the ones that get a
// stranded player home (GDD 6.3). The Habitat is absent because it is
// self-powering and is never shed.
const SHED_ORDER=[
    'placeable_light',
    'crafting_station',
    'ship_factory',
    'fuel_refinery',
    'ore_storage',
    'parts_warehouse',
    'fuel_depot',
    'communications_antenna',
    'landing_pad'
];

// Buffer must be at least this full before a shed building is allowed back on.
// Without it, shedding frees capacity, the buffer recharges, the building is
// restored, and the grid immediately browns out again -- a visible flicker loop.
const RESTORE_BUFFER_FRACTION=0.5;

// Endpoint coordinates are snapped to this grid before being compared, so a
// cable run that ends "on" a building matches the building's own position.
const ENDPOINT_SNAP=4;

class UnionFind {
    constructor() {this.parent=new Map();}

    add(key) {
        if (!this.parent.has(key)) this.parent.set(key, key);
        return key;
    }

    find(key) {
        if (!this.parent.has(key)) return null;
        let root=key;
        while (this.parent.get(root)!==root) root=this.parent.get(root);
        // Path compression
        let cur=key;
        while (this.parent.get(cur)!==root) {
            const next=this.parent.get(cur);
            this.parent.set(cur, root);
            cur=next;
        }
        return root;
    }

    union(a, b) {
        this.add(a);
        this.add(b);
        const ra=this.find(a);
        const rb=this.find(b);
        if (ra!==rb) this.parent.set(ra, rb);
    }
}

export class NetworkSystem {
    constructor(game) {
        this.game=game;

        // Tunables. baseBusRadius now matches the Landing Pad's build radius
        // (GDD 5.2): anything you can place around a pad is on its bus, and
        // anything further away needs cable.
        //
        // It was temporarily 1400 to cover the authored nine-building surface
        // row. That row is no longer instantiated at startup -- only the Landing
        // Pad and Habitat are -- so the wide radius had become actively wrong:
        // it auto-connected a second base 1200 units away that should have
        // needed a cable run.
        // Read the radius off Game rather than re-deriving it from config, so
        // there is exactly one default. (These briefly disagreed -- Game
        // defaulted to 400 and NetworkSystem to 200 -- which silently left every
        // building past 200 units off the bus.)
        const diff=game.config?.difficulty||{};
        this.baseBusRadius=diff.baseBusRadius??game.buildRadius;
        this.baseBusElevationBand=diff.baseBusElevationBand??60;
        this.solarZeroDepth=diff.solarZeroDepth??60;
        this.fuelThroughput=diff.fuelThroughput??20; // units/second per run

        // Persistent per-node state that must survive a re-solve.
        this.bufferEnergy=new Map();  // nodeId -> stored kJ
        this.fuelTanks=new Map();     // nodeId -> local fuel units
        this.shedNodes=new Set();     // nodeId currently load-shed

        // Last solved result (serialised to clients, read by Game).
        this.state=this.emptyState();

        // Topology is only rebuilt when something changes, not every frame.
        this.topologyDirty=true;
        this.topology=null;
    }

    emptyState() {
        return {
            nodes: {},
            powerNets: [],
            fuelNets: [],
            dataNets: [],
            totals: {supply: 0, demand: 0, buffer: 0, bufferCapacity: 0, shed: []}
        };
    }

    markDirty() {this.topologyDirty=true;}

    // ---------------------------------------------------------------- nodes

    // The single point where building instances are enumerated. Now reads
    // Game.structures, so multiple instances of a type each become their own
    // node with their own position, level and connection state.
    collectNodes() {
        const nodes=new Map();
        for (const s of this.game.structures.values()) {
            if (!s||s.level<=0) continue;
            const spec=BUILDING_NETWORK_SPEC[s.type];
            if (!spec) continue;
            const def=this.game.buildings[s.type];
            nodes.set(s.id, {
                id: s.id,
                key: s.type,
                name: def? def.name:s.type,
                level: s.level,
                x: s.x,
                y: s.y,
                spec
            });
        }
        return nodes;
    }

    endpointKey(x, y) {
        return `${Math.round(x/ENDPOINT_SNAP)}:${Math.round(y/ENDPOINT_SNAP)}`;
    }

    // Builds one UnionFind per network from the Base Bus plus laid cable.
    buildTopology() {
        const nodes=this.collectNodes();
        const uf={
            [NET_POWER]: new UnionFind(),
            [NET_FUEL]: new UnionFind(),
            [NET_DATA]: new UnionFind()
        };

        // Every node is its own component to begin with, keyed by position so
        // cable endpoints and buildings share one namespace.
        for (const node of nodes.values()) {
            const k=this.endpointKey(node.x, node.y);
            node.posKey=k;
            for (const net of NETWORKS) uf[net].add(k);
        }

        // --- Base Bus: buildings on the landing pad deck are implicitly wired
        // together on all three networks and need no cable (GDD 5.2).
        // EVERY landing pad projects a bus, not just the first one. This used to
        // read nodes.get('landing_pad'), which is only the home pad -- so a
        // second base founded anywhere else was permanently disconnected and
        // could never be powered no matter what the player built next to it.
        const pads=[...nodes.values()].filter(n => n.key==='landing_pad');
        const busMembers=[];
        for (const pad of pads) {
            for (const node of nodes.values()) {
                const dx=node.x-pad.x;
                const dy=node.y-pad.y;
                const onDeck=Math.abs(dy)<=this.baseBusElevationBand&&
                    Math.sqrt(dx*dx+dy*dy)<=this.baseBusRadius;
                if (!onDeck) continue;
                node.onBus=true;
                busMembers.push(node);
                for (const net of NETWORKS) uf[net].union(pad.posKey, node.posKey);
            }
        }

        // --- Cable segments. A run between two arbitrary points joins those
        // points on its own network only; chains of runs therefore link two
        // buildings through intermediate wall anchors.
        for (const seg of this.game.cableSystem.segments) {
            const net=normalizeCableType(seg.type);
            if (!net) continue;
            const a=this.endpointKey(seg.x1, seg.y1);
            const b=this.endpointKey(seg.x2, seg.y2);
            uf[net].union(a, b);
        }

        this.topology={nodes, uf, busMembers};
        this.topologyDirty=false;
        return this.topology;
    }

    getTopology() {
        if (this.topologyDirty||!this.topology) return this.buildTopology();
        return this.topology;
    }

    // Groups nodes into connected components for one network.
    componentsFor(net, topology) {
        const {nodes, uf}=topology;
        const groups=new Map(); // root -> [node]
        for (const node of nodes.values()) {
            if (!node.spec[net]) continue; // Building does not use this network.
            const root=uf[net].find(node.posKey);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(node);
        }
        return groups;
    }

    // ---------------------------------------------------------------- scaling

    levelValue(base, perLevel, level) {
        if (base===undefined||base===null) return 0;
        return base+(Math.max(1, level)-1)*(perLevel||0);
    }

    generationOf(node) {
        const p=node.spec.power;
        if (!p||!p.gen) return 0;
        let gen=this.levelValue(p.gen, p.genPerLevel, node.level);
        if (p.solar) gen*=this.solarFactor(node);
        // A fuel generator with a dry tank produces nothing. Without this it
        // generated its full 50 kW forever on no fuel at all, which made the
        // whole fuel network optional and remote bases free to power.
        if (node.spec.fuel?.role==='burn'&&(this.fuelTanks.get(node.id)||0)<=0) return 0;
        return gen;
    }

    // Solar output is full at the surface and falls linearly to zero by
    // solarZeroDepth below it (GDD 6.3).
    solarFactor(node) {
        const surfaceY=this.game.voxelMap.landingPadPosition?.y;
        if (surfaceY===undefined||surfaceY===null) return 1;
        const depth=node.y-surfaceY;
        if (depth<=0) return 1;
        if (depth>=this.solarZeroDepth) return 0;
        return 1-(depth/this.solarZeroDepth);
    }

    drawOf(node, isActive) {
        const p=node.spec.power;
        if (!p||p.idle===undefined) return 0;
        const base=isActive? p.active:p.idle;
        return this.levelValue(base, p.drawPerLevel, node.level);
    }

    bufferCapacityOf(node) {
        const p=node.spec.power;
        if (!p||!p.buffer) return 0;
        return this.levelValue(p.buffer, p.bufferPerLevel, node.level);
    }

    tankCapacityOf(node) {
        const f=node.spec.fuel;
        if (!f||!f.tank) return 0;
        return this.levelValue(f.tank, f.tankPerLevel, node.level);
    }

    antennaRangeOf(node) {
        const d=node.spec.data;
        if (!d) return 0;
        return this.levelValue(d.range, d.rangePerLevel, node.level);
    }

    // ---------------------------------------------------------------- solve

    solve(dt, activity) {
        const topology=this.getTopology();
        const {nodes}=topology;

        const status={};
        for (const node of nodes.values()) {
            status[node.id]={
                id: node.id,
                name: node.name,
                level: node.level,
                x: node.x,
                y: node.y,
                onBus: !!node.onBus,
                power: node.spec.power? 'unconnected':'na',
                fuel: node.spec.fuel? 'unconnected':'na',
                data: node.spec.data? 'unconnected':'na',
                draw: 0,
                gen: 0,
                active: !!activity[node.id]
            };
        }

        const powerNets=this.solvePower(topology, activity, status, dt);
        const fuelNets=this.solveFuel(topology, status, dt);
        const dataNets=this.solveData(topology, status);

        let supply=0, demand=0, buffer=0, bufferCapacity=0;
        for (const net of powerNets) {
            supply+=net.supply;
            demand+=net.demand;
            buffer+=net.buffer;
            bufferCapacity+=net.bufferCapacity;
        }

        this.state={
            nodes: status,
            powerNets,
            fuelNets,
            dataNets,
            totals: {
                supply,
                demand,
                buffer,
                bufferCapacity,
                shed: Array.from(this.shedNodes)
            }
        };
        return this.state;
    }

    // Drawing entries sorted lowest shed priority first. Types absent from
    // SHED_ORDER sort first (shed earliest); the self-powered Habitat is skipped
    // by the caller and so never appears.
    byShedPriority(drawing) {
        const rank=node => {
            const i=SHED_ORDER.indexOf(node.key);
            return i===-1? -1:i;
        };
        return drawing.slice().sort((a, b) => rank(a.node)-rank(b.node));
    }

    solvePower(topology, activity, status, dt) {
        const groups=this.componentsFor(NET_POWER, topology);
        const results=[];

        for (const [root, members] of groups) {
            let supply=0;
            const drawing=[];

            for (const node of members) {
                const gen=this.generationOf(node);
                supply+=gen;
                status[node.id].gen=gen;

                const draw=this.drawOf(node, !!activity[node.id]);
                if (draw>0) drawing.push({node, draw});
            }

            const bufferCapacity=members.reduce((sum, n) => sum+this.bufferCapacityOf(n), 0);
            let bufferEnergy=members.reduce((sum, n) => sum+(this.bufferEnergy.get(n.id)||0), 0);
            bufferEnergy=Math.min(bufferEnergy, bufferCapacity);

            // Self-powered buildings (the Habitat) are never shed and always run.
            for (const entry of drawing) {
                if (entry.node.spec.power.selfPowered) this.shedNodes.delete(entry.node.id);
            }

            let demand=drawing
                .filter(e => !this.shedNodes.has(e.node.id))
                .reduce((sum, e) => sum+e.draw, 0);

            let brownout=false;

            // No generator anywhere on this component: the buildings are not
            // browning out, they were never connected to anything. Reported
            // distinctly so the UI can show "not connected" rather than "shed".
            if (supply<=0) {
                for (const entry of drawing) {
                    const s=status[entry.node.id];
                    s.draw=entry.draw;
                    s.power=entry.node.spec.power.selfPowered? 'ok':'unconnected';
                    this.shedNodes.delete(entry.node.id);
                }
                for (const node of members) {
                    this.bufferEnergy.set(node.id, 0);
                }
                results.push({
                    id: `pwr_${root}`,
                    supply: 0,
                    demand: drawing.reduce((s, e) => s+e.draw, 0),
                    buffer: 0,
                    bufferCapacity,
                    brownout: false,
                    unconnected: true,
                    members: members.map(n => n.id),
                    shed: []
                });
                continue;
            }

            if (demand>supply) {
                // Drain the buffer to cover the deficit; shed only once it is empty.
                const deficit=demand-supply;
                const drawn=Math.min(bufferEnergy, deficit*dt);
                bufferEnergy-=drawn;
                brownout=true;

                if (bufferEnergy<=0) {
                    bufferEnergy=0;
                    // Walk instances lowest-priority-first. Matching is on the
                    // building TYPE, not the node id, so a base with three
                    // Placeable Lights sheds all three before the Crafting
                    // Station rather than only the one whose id happens to
                    // equal the type name.
                    for (const entry of this.byShedPriority(drawing)) {
                        if (demand<=supply) break;
                        if (this.shedNodes.has(entry.node.id)) continue;
                        if (entry.node.spec.power.selfPowered) continue;
                        this.shedNodes.add(entry.node.id);
                        demand-=entry.draw;
                    }
                }
            } else {
                bufferEnergy=Math.min(bufferCapacity, bufferEnergy+(supply-demand)*dt);

                // Restore shed buildings highest-priority-first, but only with a
                // healthy buffer and real headroom, so the grid cannot flicker.
                if (bufferCapacity>0&&bufferEnergy>=bufferCapacity*RESTORE_BUFFER_FRACTION) {
                    // Highest priority first: the Landing Pad comes back before
                    // the lights do.
                    const ordered=this.byShedPriority(drawing).reverse();
                    for (const entry of ordered) {
                        if (!this.shedNodes.has(entry.node.id)) continue;
                        if (demand+entry.draw<=supply) {
                            this.shedNodes.delete(entry.node.id);
                            demand+=entry.draw;
                        }
                    }
                }
            }

            // Write the buffer back, spread across the generators that hold it.
            for (const node of members) {
                const cap=this.bufferCapacityOf(node);
                const share=bufferCapacity>0? (cap/bufferCapacity)*bufferEnergy:0;
                this.bufferEnergy.set(node.id, share);
            }

            const hasSupply=supply>0;
            for (const entry of drawing) {
                const s=status[entry.node.id];
                s.draw=entry.draw;
                if (entry.node.spec.power.selfPowered) s.power='ok';
                else if (this.shedNodes.has(entry.node.id)) s.power='shed';
                else if (!hasSupply) s.power='starved';
                else if (brownout) s.power='brownout';
                else s.power='ok';
            }
            // Pure generators with no draw of their own are fine by definition.
            for (const node of members) {
                if (status[node.id].draw===0&&node.spec.power) {
                    status[node.id].power=hasSupply? 'ok':'starved';
                }
            }

            results.push({
                id: `pwr_${root}`,
                supply,
                demand,
                buffer: bufferEnergy,
                bufferCapacity,
                brownout,
                members: members.map(n => n.id),
                shed: members.filter(n => this.shedNodes.has(n.id)).map(n => n.id)
            });
        }

        // A shed record for a building that no longer exists would linger forever.
        for (const id of Array.from(this.shedNodes)) {
            if (!topology.nodes.has(id)) this.shedNodes.delete(id);
        }

        return results;
    }

    // Fuel moves from sources (refinery output, the base's stored fuel held by a
    // depot) into landing pad tanks and fuel generators on the same green network.
    solveFuel(topology, status, dt) {
        const groups=this.componentsFor(NET_FUEL, topology);
        const results=[];
        const base=this.game.baseResources;

        for (const [root, members] of groups) {
            const powered=id => {
                const s=status[id];
                return s&&(s.power==='ok'||s.power==='brownout');
            };

            const stores=members.filter(n => n.spec.fuel.role==='store'&&powered(n.id));
            const sources=members.filter(n => n.spec.fuel.role==='source'&&powered(n.id));
            const dispensers=members.filter(n => n.spec.fuel.role==='dispense');
            const burners=members.filter(n => n.spec.fuel.role==='burn');

            // The base's global fuel pool is reachable only through a powered
            // Fuel Depot, or directly from a powered Refinery if no depot exists.
            const hasPool=stores.length>0;
            const hasSource=hasPool||sources.length>0;

            let available=hasSource? base.fuel:0;

            // Top up dispenser (landing pad) and burner (generator) tanks.
            for (const node of [...dispensers, ...burners]) {
                const cap=this.tankCapacityOf(node);
                let tank=this.fuelTanks.get(node.id)||0;
                if (hasSource&&tank<cap&&available>0) {
                    const wanted=Math.min(cap-tank, this.fuelThroughput*dt, available);
                    tank+=wanted;
                    available-=wanted;
                    base.fuel=Math.max(0, base.fuel-wanted);
                }
                this.fuelTanks.set(node.id, tank);

                const s=status[node.id];
                if (tank>0) s.fuel='ok';
                else if (hasSource) s.fuel='starved';   // Connected, but the network is dry.
                else s.fuel='unconnected';
            }

            for (const node of stores) status[node.id].fuel=base.fuel>0? 'ok':'starved';

            // A refinery with nowhere to push fuel stalls (GDD 6.4). Output goes to
            // a depot's pool, or failing that into any dispenser tank with room --
            // so a base with only a landing pad still refines until the pad is full.
            const tankRoom=dispensers.some(n => (this.fuelTanks.get(n.id)||0)<this.tankCapacityOf(n));
            const canOutput=hasPool||tankRoom;
            for (const node of sources) {
                const s=status[node.id];
                s.fuel=canOutput? 'ok':'blocked';
                s.outputBlocked=!canOutput;
            }

            results.push({
                id: `fuel_${root}`,
                members: members.map(n => n.id),
                hasSource,
                pool: hasSource? base.fuel:0,
                tanks: Object.fromEntries(
                    [...dispensers, ...burners].map(n => [n.id, this.fuelTanks.get(n.id)||0])
                )
            });
        }

        // Tanks for buildings that were removed should not be resurrected later.
        for (const id of Array.from(this.fuelTanks.keys())) {
            if (!topology.nodes.has(id)) this.fuelTanks.delete(id);
        }

        return results;
    }

    // Each blue-cable component is one Data Net. Its coverage is the union of the
    // bubbles of its powered antennas.
    solveData(topology, status) {
        const groups=this.componentsFor(NET_DATA, topology);
        const results=[];

        for (const [root, members] of groups) {
            const coverage=[];
            for (const node of members) {
                const s=status[node.id];
                const isPowered=s.power==='ok'||s.power==='brownout';
                if (!isPowered) {
                    s.data='starved';
                    continue;
                }
                const range=this.antennaRangeOf(node);
                if (range>0) {
                    coverage.push({x: node.x, y: node.y, r: range, from: node.id});
                    s.data=members.length>1? 'ok':'isolated';
                }
            }
            if (coverage.length===0) continue;

            results.push({
                id: `data_${root}`,
                members: members.map(n => n.id),
                coverage
            });
        }

        return results;
    }

    // ---------------------------------------------------------------- queries

    isPowered(nodeId) {
        const s=this.state.nodes[nodeId];
        if (!s) return false;
        return s.power==='ok'||s.power==='brownout';
    }

    // Instance ids of a building type. The first instance of a type is named
    // after the type itself, so 'landing_pad' resolves whether it is used as a
    // type name or an instance id.
    nodeIdsOfType(type) {
        const ids=[];
        for (const [id, node] of Object.entries(this.state.nodes)) {
            if (node.key===type||id===type) ids.push(id);
        }
        return ids;
    }

    // Fuel a landing pad can actually dispense right now.
    padFuelAvailable(nodeId='landing_pad') {
        return this.fuelTanks.get(nodeId)||0;
    }

    // Buildings with a local tank a player can hand-fill from their ship.
    // This is the bootstrap for a remote base: its generator needs fuel, but
    // fuel only flows from a POWERED depot, which needs the generator running.
    // Flying fuel down in a ship is what breaks that circle (GDD 6.3).
    handFillableAt(x, y, range=90) {
        const topology=this.getTopology();
        const out=[];
        for (const node of topology.nodes.values()) {
            if (!node.spec.fuel?.tank) continue;
            if (Math.hypot(node.x-x, node.y-y)>range) continue;
            const cap=this.tankCapacityOf(node);
            const tank=this.fuelTanks.get(node.id)||0;
            if (tank>=cap) continue;
            out.push({id: node.id, name: node.name, tank, capacity: cap,
                dist: Math.hypot(node.x-x, node.y-y)});
        }
        return out.sort((a, b) => a.dist-b.dist);
    }

    // Pour `amount` into a building's tank; returns how much it actually took.
    fillTank(nodeId, amount) {
        const topology=this.getTopology();
        const node=topology.nodes.get(nodeId);
        if (!node||!node.spec.fuel?.tank) return 0;
        const cap=this.tankCapacityOf(node);
        const tank=this.fuelTanks.get(nodeId)||0;
        const taken=Math.max(0, Math.min(amount, cap-tank));
        this.fuelTanks.set(nodeId, tank+taken);
        return taken;
    }

    consumePadFuel(amount, nodeId='landing_pad') {
        const tank=this.fuelTanks.get(nodeId)||0;
        const used=Math.min(tank, amount);
        this.fuelTanks.set(nodeId, tank-used);
        return used;
    }

    // True when a refinery has somewhere to put the fuel it makes.
    refineryCanOutput(nodeId='fuel_refinery') {
        const s=this.state.nodes[nodeId];
        if (!s) return true;  // No refinery built -> baseline refining is unaffected.
        return !s.outputBlocked;
    }

    // Fuel across every landing pad tank, and drawing from the nearest one that
    // has any. With one pad this behaves exactly as before.
    totalPadFuel(type='landing_pad') {
        return this.nodeIdsOfType(type).reduce((sum, id) => sum+(this.fuelTanks.get(id)||0), 0);
    }

    // Total ore-processing throughput, in units/second, from every powered
    // refiner. The Habitat's built-in starter refinery is self-powered and so
    // always contributes; a Fuel Refinery only contributes while it has power.
    refiningRate() {
        const topology=this.getTopology();
        let rate=0;
        for (const node of topology.nodes.values()) {
            if (!node.spec.refine) continue;
            if (!this.isPowered(node.id)) continue;
            rate+=this.levelValue(node.spec.refine.rate, node.spec.refine.ratePerLevel, node.level);
        }
        return rate;
    }

    // Whether any powered refiner can currently turn Bitite into fuel.
    canRefineFuel() {
        const topology=this.getTopology();
        for (const node of topology.nodes.values()) {
            if (!node.spec.refine) continue;
            if (!this.isPowered(node.id)) continue;
            if (this.refineryCanOutput(node.id)) return true;
        }
        return false;
    }

    // Fills tanks flagged startsFull on the first solve, so a fresh game has the
    // fuel it needs to reach the first Bitite.
    seedStartingTanks() {
        const topology=this.getTopology();
        for (const node of topology.nodes.values()) {
            if (node.spec.fuel?.startsFull&&!this.fuelTanks.has(node.id)) {
                this.fuelTanks.set(node.id, this.tankCapacityOf(node));
            }
        }
    }

    // Which Data Net, if any, a world position currently sits inside.
    dataNetAt(x, y) {
        for (const net of this.state.dataNets) {
            for (const c of net.coverage) {
                const dx=x-c.x;
                const dy=y-c.y;
                if (dx*dx+dy*dy<=c.r*c.r) return net.id;
            }
        }
        return null;
    }

    // Total fuel burned by generators this tick, given how loaded they were.
    burnGeneratorFuel(dt) {
        let burned=0;
        for (const net of this.state.powerNets) {
            const load=net.supply>0? Math.min(1, net.demand/net.supply):0;
            for (const id of net.members) {
                const node=this.topology?.nodes.get(id);
                if (!node||node.spec.fuel?.role!=='burn') continue;
                const gen=this.generationOf(node);
                if (gen<=0) continue;
                const rate=node.spec.fuel.burnAtFullLoad*(gen/50); // scaled to output
                const want=rate*load*dt;
                const tank=this.fuelTanks.get(id)||0;
                const used=Math.min(tank, want);
                this.fuelTanks.set(id, tank-used);
                burned+=used;
            }
        }
        return burned;
    }

    serialize() {
        return {
            nodes: this.state.nodes,
            power: this.state.powerNets.map(n => ({
                id: n.id,
                supply: Math.round(n.supply*10)/10,
                demand: Math.round(n.demand*10)/10,
                buffer: Math.round(n.buffer),
                bufferCapacity: Math.round(n.bufferCapacity),
                brownout: n.brownout,
                shed: n.shed
            })),
            fuel: this.state.fuelNets.map(n => ({
                id: n.id,
                hasSource: n.hasSource,
                pool: Math.round(n.pool),
                tanks: n.tanks
            })),
            data: this.state.dataNets,
            totals: {
                supply: Math.round(this.state.totals.supply*10)/10,
                demand: Math.round(this.state.totals.demand*10)/10,
                buffer: Math.round(this.state.totals.buffer),
                bufferCapacity: Math.round(this.state.totals.bufferCapacity),
                shed: this.state.totals.shed
            }
        };
    }
}

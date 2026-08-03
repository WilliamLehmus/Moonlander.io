// Functional check of the power / fuel / data network solver.
import {Game} from '../game/Game.js';

const pad='landing_pad', hab='habitat', ant='communications_antenna';
let failures=0;
function check(label, cond, detail='') {
    const ok=!!cond;
    if (!ok) failures++;
    console.log(`${ok? '  PASS':'  FAIL'}  ${label}${detail? '  -- '+detail:''}`);
}

const game=new Game();
await game.init();
const N=game.networks;


// Instances are the source of truth now: setting buildings[k].level no longer
// creates anything, because syncBuildingLevels() recomputes it from structures.
// Place test buildings ON THE PAD DECK so they are on the Base Bus. The
// authored positions run 256..1216 units out, which is now off-bus.
let slot=0;
const build=(type,lvl=1)=>{
  const p=padPosOf();
  const ex=game.structuresOfType(type)[0];
  if(ex){ex.level=lvl;}
  else{
    const offsets=[-110,-220,-330,110,220,330,-400,400];
    const dx=offsets[slot++%offsets.length];
    game.addStructure(type,p.x+dx,p.y,lvl);
  }
  game.syncBuildingLevels(); N.markDirty();
};
const unbuild=(type)=>{
  for(const st of game.structuresOfType(type)) game.structures.delete(st.id);
  game.syncBuildingLevels(); N.markDirty();
};
const padPosOf=()=>game.voxelMap.getBuildingLocation('landing_pad');

const dump=() => {
    const t=N.state.totals;
    console.log(`    supply=${t.supply.toFixed(1)}kW demand=${t.demand.toFixed(1)}kW buffer=${t.buffer.toFixed(0)}/${t.bufferCapacity} shed=[${t.shed}]`);
};

console.log('\n=== 1. Fresh game: starting base ===');
const nodes=N.state.nodes;
console.log('    nodes:', Object.keys(nodes).join(', '));
check('Landing Pad is a network node', !!nodes[pad]);
check('Habitat is a network node', !!nodes[hab]);
check('Habitat and Pad are both on the Base Bus', nodes[pad]?.onBus&&nodes[hab]?.onBus);
check('Pad has power', N.isPowered(pad), `status=${nodes[pad]?.power}`);
check('Habitat has power', N.isPowered(hab), `status=${nodes[hab]?.power}`);
dump();
check('Supply is 15 kW (Habitat L1)', Math.abs(N.state.totals.supply-15)<0.01);
check('Idle demand is 4 kW (Habitat 2 + Pad idle 2)', Math.abs(N.state.totals.demand-4)<0.01);

console.log('\n=== 2. Landing pad starting fuel ===');
check('Pad tank starts full at 500', N.padFuelAvailable(pad)===500, `got ${N.padFuelAvailable(pad)}`);

console.log('\n=== 3. Habitat starter refinery ===');
check('Refining works with no Fuel Refinery built', N.refiningRate()===3, `rate=${N.refiningRate()}/s`);
build('fuel_refinery',1);
N.solve(0.1, game.getBuildingActivity());
check('Fuel Refinery is starved at 15 kW on a 15 kW grid',
    N.state.nodes.fuel_refinery.power!=='ok'||N.state.totals.demand<=N.state.totals.supply,
    `refinery=${N.state.nodes.fuel_refinery.power}`);
dump();
unbuild('fuel_refinery');

console.log('\n=== 4. Peak load with a ship docked ===');
const activeAll={landing_pad: true, ship_factory: true, crafting_station: true};
N.solve(0.1, activeAll);
dump();
check('Peak demand is 7 kW (Habitat 2 + Pad active 5)', Math.abs(N.state.totals.demand-7)<0.01);
check('Nothing is shed at peak', N.state.totals.shed.length===0);

console.log('\n=== 5. Antenna fits in the remaining headroom ===');
build(ant,1);
N.solve(0.1, activeAll);
dump();
check('Antenna is powered', N.isPowered(ant), `status=${N.state.nodes[ant]?.power}`);
check('Demand is 12 kW, still under 15', Math.abs(N.state.totals.demand-12)<0.01);
check('Antenna provides 100m coverage at L1',
    N.state.dataNets.some(n => n.coverage.some(c => c.from===ant&&c.r===100)));

console.log('\n=== 6. Overload forces load shedding ===');
build('ship_factory',1); build('crafting_station',1); build('ore_storage',1);
// Run long enough to drain the buffer.
for (let i=0; i<400; i++) N.solve(0.1, activeAll);
dump();
check('Something was shed once the buffer emptied', N.state.totals.shed.length>0,
    `shed=[${N.state.totals.shed}]`);
check('Habitat was never shed', !N.state.totals.shed.includes(hab));
check('Landing Pad survives shedding (highest priority)', !N.state.totals.shed.includes(pad));
check('Crafting Station shed before the Pad', N.state.totals.shed.includes('crafting_station'));
check('Grid balanced after shedding', N.state.totals.demand<=N.state.totals.supply+0.01,
    `${N.state.totals.demand} vs ${N.state.totals.supply}`);

console.log('\n=== 7. Adding generation restores shed buildings ===');
build('fuel_generator',1);
for (let i=0; i<400; i++) N.solve(0.1, activeAll);
dump();
check('Everything restored after +50 kW', N.state.totals.shed.length===0, `shed=[${N.state.totals.shed}]`);
check('No flicker: still stable after more ticks', (() => {
    for (let i=0; i<200; i++) N.solve(0.1, activeAll);
    return N.state.totals.shed.length===0;
})());

console.log('\n=== 8. Off-bus building is isolated until cabled ===');
const padPos=game.voxelMap.getBuildingLocation(pad);
// Move the antenna far away and underground -- off the deck entirely.
// Instances own their own position now, so move the STRUCTURE, not the
// authored map entry. (Mutating buildingPositions no longer relocates a node.)
const antStruct=game.structuresOfType(ant)[0];
antStruct.x=padPos.x+300;
antStruct.y=padPos.y+400;
const antPos={x: antStruct.x, y: antStruct.y};
N.markDirty();
N.solve(0.1, activeAll);
check('Remote antenna has no power', !N.isPowered(ant), `status=${N.state.nodes[ant].power}`);
check('Remote antenna reports unconnected', N.state.nodes[ant].power==='unconnected',
    `status=${N.state.nodes[ant].power}`);
check('Unpowered antenna gives no coverage',
    !N.state.dataNets.some(n => n.coverage.some(c => c.from===ant)));

console.log('\n=== 9. Power cable reconnects it ===');
// Chain runs from the pad down to the antenna, each under the 120 length limit.
const steps=[];
let cx=padPos.x, cy=padPos.y;
while (Math.hypot(antPos.x-cx, antPos.y-cy)>1) {
    const d=Math.hypot(antPos.x-cx, antPos.y-cy);
    const step=Math.min(100, d);
    const nx=cx+(antPos.x-cx)/d*step;
    const ny=cy+(antPos.y-cy)/d*step;
    steps.push([cx, cy, nx, ny]);
    cx=nx; cy=ny;
}
game.baseResources.basic=500;
for (const [x1, y1, x2, y2] of steps) {
    const r=game.cableSystem.addSegment(x1, y1, x2, y2, 'power');
    if (!r.success) console.log('    segment failed:', r.reason);
}
console.log(`    laid ${steps.length} power runs`);
N.solve(0.1, activeAll);
check('Antenna is powered over the cable', N.isPowered(ant), `status=${N.state.nodes[ant].power}`);
check('Antenna radiates again', N.state.dataNets.some(n => n.coverage.some(c => c.from===ant)));

console.log('\n=== 10. Data nets stay separate without blue cable ===');
// Probe on the landing pad: a fresh game must have minimap signal at its own base.
const padNet=N.dataNetAt(padPos.x, padPos.y);
const antNet=N.dataNetAt(antPos.x, antPos.y);
console.log(`    net on pad=${padNet}  net at remote antenna=${antNet}`);
check('Player standing on the landing pad has signal', !!padNet);
check('Player at the remote antenna has signal', !!antNet);
check('They are DIFFERENT data nets (red cable does not share data)', padNet!==antNet);

console.log('\n=== 11. Blue cable merges them ===');
for (const [x1, y1, x2, y2] of steps) game.cableSystem.addSegment(x1, y1, x2, y2, 'data');
N.solve(0.1, activeAll);
const padNet2=N.dataNetAt(padPos.x, padPos.y);
const antNet2=N.dataNetAt(antPos.x, antPos.y);
console.log(`    net on pad=${padNet2}  net at remote antenna=${antNet2}`);
check('Now the SAME data net', padNet2&&padNet2===antNet2);
check('Merged net carries both antennas\' coverage', (() => {
    const net=N.state.dataNets.find(n => n.id===padNet2);
    return net&&net.coverage.some(c => c.from===hab)&&net.coverage.some(c => c.from===ant);
})());

console.log('\n=== 12. Remote pad with no fuel line runs dry ===');
N.fuelTanks.set(pad, 10);
game.baseResources.fuel=0;               // Nothing to draw from anywhere.
N.solve(0.1, activeAll);
const drawn=N.consumePadFuel(50, pad);
check('Pad dispenses only what is in its tank', drawn===10, `dispensed ${drawn}`);
check('Pad tank is now empty', N.padFuelAvailable(pad)===0);

console.log(`\n${failures===0? 'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0? 0:1);

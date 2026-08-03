// Founding a working base away from home, end to end.
//
// This is the scenario the whole placement + network stack exists to support,
// and it was broken in two independent ways before this test existed:
//   - the Base Bus only formed around the node literally named 'landing_pad',
//     so every remote base was permanently disconnected;
//   - a Fuel Generator produced its full 50 kW on an empty tank, which made
//     remote bases free to power and the fuel network decorative.
import {Game} from '../game/Game.js';

let fails=0;
const ck=(l, c, d='')=>{if (!c) fails++; console.log(`${c? '  PASS':'  FAIL'}  ${l}${d? '  -- '+d:''}`);};

const g=new Game(); await g.init();
g.addPlayer('p1', 'Pioneer');

// Buildings are hauled now: crafted into a kit at a base, carried in the hold,
// and consumed on placement. These tests exercise placement rules, not the
// logistics, so auto-issue the kit rather than rewriting every call site.
const _rawPlace=g.placeBuilding.bind(g);
g.placeBuilding=(pid, type, x, y)=>{
    const pl=g.players.get(pid);
    if (pl&&g.buildings[type]&&g.findKit(pl, type)===-1) {
        pl.cargo.push({type: g.kitTypeFor(type), amount: 1});
    }
    return _rawPlace(pid, type, x, y);
};
const N=g.networks, vm=g.voxelMap;
const solve=()=>{N.markDirty(); N.solve(0.1, g.getBuildingActivity()); g.applyBuildingEffects();};
g.baseResources.basic=99999; g.baseResources.industrial=99999;

// Find an underground cave floor deep enough that solar is dead (>60m).
let site=null;
for (let gy=Math.floor((vm.getSurfaceY()+600)/vm.tileSize); gy<vm.height-40&&!site; gy+=9) {
    for (let gx=20; gx<vm.width-20; gx+=5) {
        const x=gx*vm.tileSize, y=gy*vm.tileSize;
        if (vm.isSolidAtWorld(x, y-16)||vm.isSolidAtWorld(x, y-8)||!vm.isSolidAtWorld(x, y+8)) continue;
        const r=g.placeBuilding('p1', 'landing_pad', x, y);
        if (r.success) {site={x, y, id: r.instanceId}; break;}
    }
}

console.log('\n=== Founding a remote underground base ===');
ck('Found a site and placed a Landing Pad there', !!site,
    site? `${site.id} at depth ${Math.round(vm.getDepthMeters(site.y))}m`:'no site this seed');
if (!site) {console.log('\nSKIPPED (no site)'); process.exit(0);}

const depth=vm.getDepthMeters(site.y);
ck('Site is below the solar cutoff', depth>60, `${Math.round(depth)}m`);

// Buildable ground around it.
const spots=[];
for (let a=0; a<360; a+=5) {
    for (let r=110; r<=g.buildRadius; r+=20) {
        const x=site.x+Math.cos(a*Math.PI/180)*r, y=site.y+Math.sin(a*Math.PI/180)*r;
        if (g.canPlaceBuilding('fuel_generator', x, y).ok) spots.push({x, y});
    }
}
ck('There is buildable ground around the new pad', spots.length>0, `${spots.length} spots`);
if (!spots.length) {console.log('\nSKIPPED'); process.exit(0);}

// Put the generator ON THE PAD DECK (within the Base Bus elevation band) so it
// wires up without cable. Spots are scanned by angle, so spots[0] can easily be
// steeply above or below the pad if the rock beside it is solid -- and that
// would correctly need a cable run, which is not what this test is about.
const deckSpot=spots.find(s => Math.abs(s.y-site.y)<=N.baseBusElevationBand)||spots[0];
const gen=g.placeBuilding('p1', 'fuel_generator', deckSpot.x, deckSpot.y);
ck('Fuel Generator placed', gen.success, JSON.stringify(gen));
ck('...on the pad deck, so no cable is needed',
    Math.abs(deckSpot.y-site.y)<=N.baseBusElevationBand,
    `dy=${Math.round(Math.abs(deckSpot.y-site.y))}`);
solve();

console.log('\n=== The remote base starts dark ===');
ck('Pad and generator share one network (Base Bus works for remote pads)',
    N.state.nodes[site.id]&&N.state.nodes[gen.instanceId]&&
    N.state.powerNets.some(p => p.members.includes(site.id)&&p.members.includes(gen.instanceId)));
ck('Generator makes NO power on an empty tank', (N.state.nodes[gen.instanceId]?.gen||0)===0,
    `${N.state.nodes[gen.instanceId]?.gen} kW`);
ck('Remote pad is unpowered', !N.isPowered(site.id), N.state.nodes[site.id]?.power);

console.log('\n=== Hand-filling bootstraps it (GDD 6.3) ===');
const p=g.players.get('p1');
p.x=deckSpot.x; p.y=deckSpot.y;
p.fuel=400;
p.inputs.transferFuel=true;
ck('Pilot standing at the generator sees it as a fill target',
    (g.networks.handFillableAt(p.x, p.y)[0]||{}).id===gen.instanceId);

for (let i=0; i<40; i++) g.updateHandFill(p, 0.1);
const tank=N.fuelTanks.get(gen.instanceId)||0;
ck('Fuel poured into the generator', tank>0, `tank=${tank.toFixed(0)}/100`);
ck('It came out of the ship', p.fuel<400, `ship fuel ${Math.round(p.fuel)}`);
ck('Tank does not overfill past capacity', tank<=100, `${tank.toFixed(0)}`);

solve();
console.log('\n=== The base comes alive ===');
ck('Generator now produces power', (N.state.nodes[gen.instanceId]?.gen||0)>0,
    `${N.state.nodes[gen.instanceId]?.gen} kW`);
ck('Remote Landing Pad is POWERED', N.isPowered(site.id), N.state.nodes[site.id]?.power);
ck('Home base is unaffected', N.isPowered('landing_pad'));
ck('Home and remote are separate power networks',
    !N.state.powerNets.some(p => p.members.includes('landing_pad')&&p.members.includes(site.id)));

console.log('\n=== Running dry turns it off again ===');
N.fuelTanks.set(gen.instanceId, 0);
solve();
ck('Empty tank cuts the power back off', !N.isPowered(site.id), N.state.nodes[site.id]?.power);


console.log('\n=== The remote pad works as a real base ===');
// Landing pads are placeable, so docking must recognise them. It used to test
// only the home pad's carved bounds, which left every player-built pad inert:
// no station menu, no kit crafting, no refuel, no repair.
N.fuelTanks.set(gen.instanceId, 100);
solve();
const padStruct=g.structures.get(site.id);
ck('Docking detects the remote pad', g.landingPadAt(padStruct.x, padStruct.y)===site.id,
    String(g.landingPadAt(padStruct.x, padStruct.y)));
ck('Home pad still detected', g.landingPadAt(
    g.structures.get('landing_pad').x, g.structures.get('landing_pad').y)==='landing_pad');
ck('Open ground is not a pad', !g.landingPadAt(padStruct.x+900, padStruct.y));

// Standing on it should give base services.
p.x=padStruct.x; p.y=padStruct.y;
p.onPad=true; p.padId=site.id;
g.baseResources.basic=1000;
const kit=g.craftBuildingKit('p1', 'ore_storage');
ck('Can craft kits at the remote base', kit.success, JSON.stringify(kit));

// Refuelling draws from THIS pad's tank, not the home pad's.
N.fuelTanks.set('landing_pad', 500);
N.fuelTanks.set(site.id, 40);
const took=N.consumePadFuel(30, site.id);
ck('Refuel draws from the remote pad tank', took===30, `${took}`);
ck('Home pad tank untouched', N.padFuelAvailable('landing_pad')===500,
    `${N.padFuelAvailable('landing_pad')}`);

console.log(`\n${fails===0? 'ALL CHECKS PASSED':fails+' FAILED'}`);
process.exit(fails===0? 0:1);

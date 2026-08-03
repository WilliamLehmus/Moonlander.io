import {Game} from '../game/Game.js';
let fails=0;
const ck=(l,c,d='')=>{if(!c)fails++;console.log(`${c?'  PASS':'  FAIL'}  ${l}${d?'  -- '+d:''}`);};

const g=new Game(); await g.init();
g.addPlayer('p1','Builder');
const N=g.networks;
const pad=g.voxelMap.getBuildingLocation('landing_pad');
const solve=()=>{N.markDirty();N.solve(0.1,g.getBuildingActivity());g.applyBuildingEffects();};

console.log('\n=== Starting base is unchanged ===');
ck('Exactly two starting structures', g.structures.size===2, [...g.structures.keys()].join(','));
ck('First instance keeps the bare type id', g.structures.has('landing_pad')&&g.structures.has('habitat'));
ck('Type mirror still reports level 1', g.buildings.habitat.level===1&&g.buildings.landing_pad.level===1);
ck('The two starting positions pass the terrain test',
   ['landing_pad','habitat'].every(id=>{const bp=g.voxelMap.getBuildingLocation(id);
     return !g.voxelMap.isSolidAtWorld(bp.x, bp.y-g.voxelMap.tileSize*2);}));

console.log('\n=== Placement validation ===');
g.baseResources.basic=1000; g.baseResources.industrial=1000;
ck('Rejects unknown type', !g.placeBuilding('p1','space_elevator',pad.x-150,pad.y).success);
ck('Rejects outside the build zone',
   g.placeBuilding('p1','ore_storage',pad.x+5000,pad.y).reason==='outside_build_zone');
ck('Rejects overlapping an existing building',
   g.placeBuilding('p1','ore_storage',pad.x,pad.y).reason==='too_close_to_building');
// Find a genuinely solid spot inside the build zone -- terrain is random per
// run, so assuming a fixed offset is rock makes this test flaky.
let buried=null;
for (let dy=40; dy<=350&&!buried; dy+=8) {
  for (const dx of [-120, 120, -200, 200, -60, 60]) {
    if (g.voxelMap.isSolidAtWorld(pad.x+dx, pad.y+dy-g.voxelMap.tileSize*2)) {buried={x: pad.x+dx, y: pad.y+dy}; break;}
  }
}
ck('Rejects placing buried in rock (in zone, no headroom)',
   buried? g.placeBuilding('p1','ore_storage',buried.x,buried.y).reason==='blocked_by_terrain':true,
   buried? '':'no solid spot in zone this seed');

// Terrain is random per run, so find a genuinely valid on-deck spot rather
// than assuming a fixed offset is clear.
const findSpot=(type)=>{
  for (const dx of [-150,150,-200,200,-250,250,-300,300,-350,350]) {
    for (let dy=-40; dy<=40; dy+=8) {
      if (g.canPlaceBuilding(type, pad.x+dx, pad.y+dy).ok) return {x:pad.x+dx, y:pad.y+dy};
    }
  }
  return null;
};
const spot1=findSpot('fuel_depot');
const r1=spot1? g.placeBuilding('p1','fuel_depot',spot1.x,spot1.y):{success:false,reason:'no spot'};
ck('Places a valid building', r1.success, JSON.stringify(r1));
ck('Charged materials', g.baseResources.basic===980, `basic=${g.baseResources.basic}`);

console.log('\n=== A second instance of the same type ===');
// In the build zone, but 120 units above the pad deck -- outside the +/-60 Base
// Bus elevation band, so it is placed but NOT automatically connected.
let spot2=null;
for (const dx of [60,-60,120,-120,180,-180]) {
  for (const dy of [-120,-140,-160,-100,-180]) {
    if (!spot2 && g.canPlaceBuilding('fuel_depot', pad.x+dx, pad.y+dy).ok) spot2={x:pad.x+dx,y:pad.y+dy};
  }
}
const r2=spot2? g.placeBuilding('p1','fuel_depot',spot2.x,spot2.y):{success:false,reason:'no spot'};
ck('Second depot allowed', r2.success, JSON.stringify(r2));
ck('Gets a distinct instance id', r2.instanceId==='fuel_depot#2', r2.instanceId);
solve();
ck('Both are network nodes', !!N.state.nodes['fuel_depot']&&!!N.state.nodes['fuel_depot#2']);

console.log('\n=== Capacity is gated on network connectivity ===');
const oneDepot=g.baseResources.maxFuel;
ck('Off-deck depot reads as unconnected', !N.isPowered('fuel_depot#2'), N.state.nodes['fuel_depot#2']?.power);
ck('Unconnected depot adds NO capacity', oneDepot===2000+7000, `maxFuel=${oneDepot}`);

// Run power cable from the pad up to it, in legal-length runs.
g.baseResources.basic=500;
const d2=g.structures.get('fuel_depot#2');
let cx=pad.x, cy=pad.y;
while (Math.hypot(d2.x-cx, d2.y-cy)>1) {
  const dist=Math.hypot(d2.x-cx, d2.y-cy), step=Math.min(100, dist);
  const nx=cx+(d2.x-cx)/dist*step, ny=cy+(d2.y-cy)/dist*step;
  g.cableSystem.addSegment(cx, cy, nx, ny, 'power');
  cx=nx; cy=ny;
}
solve();
ck('Cabled depot is now connected', N.isPowered('fuel_depot#2'), N.state.nodes['fuel_depot#2']?.power);
ck('Capacity SUMS once connected', g.baseResources.maxFuel>oneDepot,
   `${g.baseResources.maxFuel} vs ${oneDepot}`);

console.log('\n=== Upgrades target instances ===');
const lvlSum=()=>g.structures.get('fuel_depot').level+g.structures.get('fuel_depot#2').level;
const before=lvlSum();
g.upgradeBuilding('fuel_depot');
ck('Upgrading by type raises exactly one instance', lvlSum()===before+1, `${before} -> ${lvlSum()}`);
g.upgradeBuilding('fuel_depot#2');
ck('Upgrading by instance id works', g.structures.get('fuel_depot#2').level===2,
   `level=${g.structures.get('fuel_depot#2').level}`);
ck('Type mirror equals highest instance level', g.buildings.fuel_depot.level===2,
   `${g.buildings.fuel_depot.level}`);

console.log('\n=== Landing Pad anchors a brand new base ===');
// Walk down each column until open space sits directly above solid ground.
const vm=g.voxelMap;
// Search both directions -- the map is only ~3200 units wide, so searching
// rightward alone runs off the edge on plenty of seeds.
let site=null;
const offsets=[];
for (let d=900; d<3000; d+=80) {offsets.push(d, -d);}
for (const dx of offsets) {
  if (site) break;
  const x=pad.x+dx;
  if (x<64||x>=vm.width*vm.tileSize-64) continue;
  for (let gy=2; gy<vm.height-2; gy++) {
    const y=gy*vm.tileSize;
    if (!vm.isSolidAtWorld(x, y-vm.tileSize*2)&&!vm.isSolidAtWorld(x, y-vm.tileSize)&&vm.isSolidAtWorld(x, y+vm.tileSize)) {
      site={x, y}; break;
    }
  }
}
console.log(`    site found: ${site? `(${Math.round(site.x)}, ${Math.round(site.y)}), ${Math.round(Math.hypot(site.x-pad.x, site.y-pad.y))} from home`:'none'}`);
if (site) {
  const rp=g.placeBuilding('p1', 'landing_pad', site.x, site.y);
  ck('Landing Pad places outside any existing zone', rp.success, JSON.stringify(rp));
  ck('It anchors a second base', rp.instanceId==='landing_pad#2', rp.instanceId);
  // Ground height varies, so try a few spots near the new pad the way a player
  // would rather than assuming one fixed offset is flat.
  let rs={success: false};
  for (const dx of [150, -150, 200, -200, 120, -120]) {
    for (let dy=-40; dy<=40&&!rs.success; dy+=8) {
      const c=g.canPlaceBuilding('ore_storage', site.x+dx, site.y+dy);
      if (c.ok) rs=g.placeBuilding('p1', 'ore_storage', site.x+dx, site.y+dy);
    }
    if (rs.success) break;
  }
  ck('Buildings are now allowed near the new pad', rs.success, JSON.stringify(rs));

  // The payoff: the remote base is a separate power grid with no generator, so
  // it is dark until the player brings power to it.
  solve();
  const remotePower=N.state.nodes[rp.instanceId]?.power;
  ck('Remote base has its own (unpowered) grid', remotePower==='unconnected',
     `landing_pad#2 power=${remotePower}`);
  ck('Home base is unaffected', N.isPowered('landing_pad'));
} else {
  console.log('  SKIP  no open site found this seed');
}

console.log('\n=== Demolition ===');
const dep=g.structuresOfType('fuel_depot')[0];
const basicBefore=g.baseResources.basic;
const dr=g.demolishBuilding('p1', dep.id);
ck('Demolishes a placed building', dr.success, JSON.stringify(dr));
ck('Refunds materials', g.baseResources.basic>basicBefore,
   `${basicBefore} -> ${g.baseResources.basic}`);
ck('Refund is partial, not full', g.baseResources.basic-basicBefore<40,
   `recovered ${g.baseResources.basic-basicBefore} of 40 invested`);
ck('Structure is gone', !g.structures.has(dep.id));
solve();
ck('...and gone from the network too', !N.state.nodes[dep.id]);

ck('Refuses to demolish the Habitat',
   g.demolishBuilding('p1','habitat').reason==='cannot_demolish_habitat');
for (const s of g.structuresOfType('landing_pad').slice(1)) g.structures.delete(s.id);
g.syncBuildingLevels();
ck('Refuses to demolish the only Landing Pad',
   g.demolishBuilding('p1','landing_pad').reason==='last_landing_pad');
ck('Refuses to demolish something that does not exist',
   g.demolishBuilding('p1','fuel_depot#77').reason==='no_such_building');

console.log(`\n${fails===0? 'ALL CHECKS PASSED':fails+' FAILED'}`);
process.exit(fails===0? 0:1);

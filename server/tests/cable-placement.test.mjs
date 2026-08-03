import {Game} from '../game/Game.js';
let fails=0;
const ck=(l,c,d='')=>{if(!c)fails++;console.log(`${c?'  PASS':'  FAIL'}  ${l}${d?'  -- '+d:''}`);};

const g=new Game(); await g.init();
g.addPlayer('p1','Tester');
const p=g.players.get('p1');
const pad=g.voxelMap.getBuildingLocation('landing_pad');
const hab=g.voxelMap.getBuildingLocation('habitat');
const CS=g.cableSystem;
g.baseResources.basic=100;

// Teleport helper using the physics body.
const move=(x,y)=>{
  const t=new g.physics.ammo.btTransform();
  p.body.getMotionState().getWorldTransform(t);
  t.setOrigin(new g.physics.ammo.btVector3(x,y,0));
  p.body.setWorldTransform(t);
  p.body.getMotionState().setWorldTransform(t);
};

console.log('\n=== Placement flow with a real player ===');
move(pad.x+5000, pad.y);
ck('Start refused when player is far away',
   CS.startLine('p1', pad.x, pad.y, 'power').reason==='out_of_range');

move(pad.x, pad.y-20);
const s=CS.startLine('p1', pad.x, pad.y, 'power');
ck('Start accepted at the pad', s.success, JSON.stringify(s));
ck('Client vocabulary normalised to a network key', s.type==='power', `type=${s.type}`);

const before=g.baseResources.basic;
move(pad.x+80, pad.y-20);
const a1=CS.attachLine('p1', pad.x+80, pad.y-20, null);
ck('Anchor to rock mid-run succeeds', a1.success, JSON.stringify(a1));
ck('Charged exactly 1 Basic', before-g.baseResources.basic===1, `spent ${before-g.baseResources.basic}`);
ck('Run stays live after a rock anchor', CS.activeLines.has('p1'));

move(pad.x+5000, pad.y);
ck('Attach refused when player flew away',
   CS.attachLine('p1', hab.x, hab.y, 'habitat').reason==='out_of_range');

move(hab.x, hab.y-20);
// Walk the remaining distance in legal-length runs.
let cx=pad.x+80, cy=pad.y-20;
while (Math.hypot(hab.x-cx, hab.y-cy) > CS.MAX_LENGTH) {
  const d=Math.hypot(hab.x-cx, hab.y-cy);
  const nx=cx+(hab.x-cx)/d*100, ny=cy+(hab.y-cy)/d*100;
  move(nx, ny); CS.attachLine('p1', nx, ny, null); cx=nx; cy=ny;
}
move(hab.x, hab.y-20);
const fin=CS.attachLine('p1', hab.x, hab.y, 'habitat');
ck('Final attach to the Habitat succeeds', fin.success, JSON.stringify(fin));
ck('Attaching to a building ENDS the run', !CS.activeLines.has('p1'));
ck('Segments were recorded', CS.segments.length>0, `${CS.segments.length} runs`);
ck('All segments carry a normalised type',
   CS.segments.every(s=>['power','fuel','data'].includes(s.type)));

g.baseResources.basic=0;
move(pad.x, pad.y-20);
CS.startLine('p1', pad.x, pad.y, 'power');
move(pad.x+60, pad.y-20);
ck('Attach refused with no materials',
   CS.attachLine('p1', pad.x+60, pad.y-20, null).reason==='no_materials');

console.log(`\n${fails===0?'ALL CHECKS PASSED':fails+' FAILED'}`);
process.exit(fails===0?0:1);

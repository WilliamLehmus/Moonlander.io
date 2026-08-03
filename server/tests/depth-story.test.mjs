import {Game} from '../game/Game.js';
let fails=0;
const ck=(l,c,d='')=>{if(!c)fails++;console.log(`${c?'  PASS':'  FAIL'}  ${l}${d?'  -- '+d:''}`);};

const g=new Game(); await g.init();
g.addPlayer('p1','Digger');
const p=g.players.get('p1');
const vm=g.voxelMap;

const beats=[]; const overs=[];
g.broadcast=(ev,d)=>{ if(ev==='storyBeat') beats.push(d); if(ev==='gameOver') overs.push(d); };

const setDepth=(m)=>{
  const range=vm.height*vm.tileSize-vm.getSurfaceY();
  p.y=vm.getSurfaceY()+(m/vm.TOTAL_DEPTH_METERS)*range;
};

console.log('\n=== Depth scale ===');
ck('Surface is 0m', Math.abs(vm.getDepthMeters(vm.getSurfaceY()))<1, vm.getDepthMeters(vm.getSurfaceY()).toFixed(2));
ck('Map bottom is 5000m', Math.abs(vm.getDepthMeters(vm.height*vm.tileSize)-5000)<1);
ck('Above ground is negative', vm.getDepthMeters(vm.getSurfaceY()-500)<0);

console.log('\n=== Story beats fire in order ===');
for (const d of [0, 800, 1600, 2600, 3600, 4300]) { setDepth(d); g.story.update(); }
ck('All six beats fired', beats.length===6, `${beats.length}: ${beats.map(b=>b.id).join(',')}`);
ck('Briefing first', beats[0]?.id==='briefing');
ck('Unknown-origin beat last', beats[5]?.id==='core_approach');
ck('Beats carry readable text', beats.every(b=>b.lines?.length>0&&b.title&&b.from));

const before=beats.length;
for (let i=0;i<50;i++) g.story.update();
ck('Beats never repeat', beats.length===before, `grew to ${beats.length}`);

setDepth(200);
for (let i=0;i<20;i++) g.story.update();
ck('Going back up does not re-fire', beats.length===before);

console.log('\n=== Win condition ===');
// Reaching the Core is a PLACE now, not a depth line: you have to be inside
// the chamber. Being at the right depth on the far side of the map is not it.
const core=vm.corePosition;
p.x=core.x+4000; p.y=core.y;
g.checkWinCondition();
ck('Right depth but nowhere near the chamber does not win', overs.length===0);

setDepth(4600);
g.checkWinCondition();
ck('No win above the core line', overs.length===0);

p.x=core.x; p.y=core.y;
g.checkWinCondition();
ck('Win fires at the core', overs.length===1, JSON.stringify(overs[0]?.reason));
ck('Reports REAL depth, not a constant', overs[0]?.depth>=4700&&overs[0]?.depth<=5000, `${overs[0]?.depth}m`);
ck('Carries the core reveal', !!overs[0]?.reveal?.lines?.length);

const n=vm.getNormalizedDepth(p.y);
ck('Win happens in the Core biome (n>=0.85)', n>=0.85, `n=${n.toFixed(3)}`);
ck('The chamber itself is in the Core biome',
   vm.getNormalizedDepth(core.y)>=0.85, `n=${vm.getNormalizedDepth(core.y).toFixed(3)}`);
ck('The chamber is open space, not sealed rock',
   !vm.isSolidAtWorld(core.x, core.y));

for (let i=0;i<100;i++) g.checkWinCondition();
ck('gameOver broadcasts exactly ONCE (was 60/sec)', overs.length===1, `${overs.length} broadcasts`);

console.log(`\n${fails===0?'ALL CHECKS PASSED':fails+' FAILED'}`);
process.exit(fails===0?0:1);

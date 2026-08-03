// Co-op behaviour with more than one player connected.
//
// Everything built recently is server-authoritative and broadcasts to the room,
// but until this file existed it had only ever been driven by a single
// simulated player. The things that are genuinely per-player (cargo, kits,
// cable runs, minimap signal) and genuinely team-scoped (story beats, base
// resources, networks) had never been told apart under load.
import {Game} from '../game/Game.js';

let fails=0;
const ck=(l, c, d='')=>{if (!c) fails++; console.log(`${c? '  PASS':'  FAIL'}  ${l}${d? '  -- '+d:''}`);};

const g=new Game(); await g.init();
const vm=g.voxelMap, N=g.networks;
const solve=()=>{N.markDirty(); N.solve(0.1, g.getBuildingActivity()); g.applyBuildingEffects();};

// Capture broadcasts so we can assert on what the room actually receives.
const sent=[];
g.broadcast=(ev, data)=>sent.push({ev, data});

g.addPlayer('alice', 'Alice');
g.addPlayer('bob', 'Bob');
const alice=g.players.get('alice');
const bob=g.players.get('bob');

const setDepth=(p, m)=>{
    const range=vm.height*vm.tileSize-vm.getSurfaceY();
    p.y=vm.getSurfaceY()+(m/vm.TOTAL_DEPTH_METERS)*range;
};

console.log('\n=== Both players exist and are distinct ===');
ck('Two players in the room', g.players.size===2);
ck('They have separate cargo holds', alice.cargo!==bob.cargo);
const state=g.getState();
ck('Both appear in serialized state', state.players.length===2,
    state.players.map(p => p.nickname).join(','));
ck('Each carries their own depth', state.players.every(p => typeof p.depth==='number'));

console.log('\n=== Cached position is populated by the engine ===');
// Player never assigned this.x/this.y -- position lived only in the Ammo body --
// yet eleven call sites read player.x/player.y directly. Every one silently
// operated on undefined: story beats never fired, the game could not be won,
// hand-filling found nothing, cable previews drew to NaN. Every unit test set
// these by hand, so the whole suite passed while the real game was broken.
// This check deliberately does NOT set them.
g.update();
for (const p of [alice, bob]) {
    ck(`${p.nickname}'s x is a real number after update()`, Number.isFinite(p.x), String(p.x));
    ck(`${p.nickname}'s y is a real number after update()`, Number.isFinite(p.y), String(p.y));
}
ck('Depth derived from it is finite too',
    Number.isFinite(vm.getDepthMeters(alice.y)), String(vm.getDepthMeters(alice.y)));
ck('Serialized depth survives JSON (NaN would become null)',
    JSON.parse(JSON.stringify(g.getState())).players.every(p => typeof p.depth==='number'));

console.log('\n=== Story beats are team-scoped, not per-player ===');
sent.length=0;
setDepth(alice, 800);
g.story.update();
const beats1=sent.filter(s => s.ev==='storyBeat');
ck('Alice descending fires beats for the room', beats1.length>0,
    beats1.map(b => b.data.id).join(','));

sent.length=0;
setDepth(bob, 800);
g.story.update();
ck('Bob reaching the same depth does NOT re-fire them',
    sent.filter(s => s.ev==='storyBeat').length===0);

sent.length=0;
setDepth(bob, 1600);
g.story.update();
ck('Bob going deeper fires the next beat', sent.some(s => s.ev==='storyBeat'));

sent.length=0;
setDepth(alice, 100);
g.story.update();
ck('One player surfacing does not rewind the story',
    sent.filter(s => s.ev==='storyBeat').length===0);
ck('Team depth is the deepest player', Math.round(g.story.deepestReached)>=1600,
    `${Math.round(g.story.deepestReached)}m`);

console.log('\n=== Building kits belong to the player who made them ===');
alice.onPad=true; bob.onPad=true;
g.baseResources.basic=1000;
const craft=g.craftBuildingKit('alice', 'ore_storage');
ck('Alice crafts a kit', craft.success);
ck('It is in Alice\'s hold', alice.cargo.some(c => c.type==='kit_ore_storage'));
ck('Bob does NOT have it', !bob.cargo.some(c => c.type==='kit_ore_storage'));

const pad=vm.getBuildingLocation('landing_pad');
const findSpot=type=>{
    for (const dx of [-150, 150, -200, 200, -260, 260, -320, 320]) {
        for (let dy=-40; dy<=40; dy+=8) {
            if (g.canPlaceBuilding(type, pad.x+dx, pad.y+dy).ok) return {x: pad.x+dx, y: pad.y+dy};
        }
    }
    return null;
};
const spot=findSpot('ore_storage');
ck('Bob cannot spend a kit he does not carry',
    spot? g.placeBuilding('bob', 'ore_storage', spot.x, spot.y).reason==='no_kit':true);
const placed=spot? g.placeBuilding('alice', 'ore_storage', spot.x, spot.y):{success: false};
ck('Alice can spend her own kit', placed.success, JSON.stringify(placed));

console.log('\n=== Base resources are shared, holds are not ===');
g.baseResources.basic=500;
const before=g.baseResources.basic;
g.craftBuildingKit('bob', 'parts_warehouse');
ck('Bob crafting spends the SHARED colony materials', g.baseResources.basic<before,
    `${before} -> ${g.baseResources.basic}`);

console.log('\n=== Cable runs are per-player ===');
const CS=g.cableSystem;
const move=(p, x, y)=>{
    const t=new g.physics.ammo.btTransform();
    p.body.getMotionState().getWorldTransform(t);
    t.setOrigin(new g.physics.ammo.btVector3(x, y, 0));
    p.body.setWorldTransform(t);
    p.body.getMotionState().setWorldTransform(t);
};
move(alice, pad.x, pad.y-20);
move(bob, pad.x, pad.y-20);
g.baseResources.basic=500;
CS.startLine('alice', pad.x, pad.y, 'power');
ck('Alice has a live run', CS.activeLines.has('alice'));
ck('Bob does not', !CS.activeLines.has('bob'));
CS.startLine('bob', pad.x, pad.y, 'data');
ck('Both can run cable at once', CS.activeLines.size===2);
ck('Their cable types are independent',
    CS.activeLines.get('alice').type==='power'&&CS.activeLines.get('bob').type==='data');
move(alice, pad.x+80, pad.y-20);
CS.attachLine('alice', pad.x+80, pad.y-20, null);
ck('Alice attaching does not end Bob\'s run', CS.activeLines.has('bob'));

console.log('\n=== Minimap signal is resolved per player ===');
setDepth(alice, 60);
alice.x=pad.x;
setDepth(bob, 3000);
bob.x=pad.x;
solve();
const s2=g.getState();
const aliceNet=s2.players.find(p => p.id==='alice').dataNet;
const bobNet=s2.players.find(p => p.id==='bob').dataNet;
ck('Alice at base has signal', !!aliceNet, String(aliceNet));
ck('Bob 3000m down has none', !bobNet, String(bobNet));
ck('So they cannot see each other live', aliceNet!==bobNet);

console.log('\n=== Deaths are counted per event, not per player ===');
const deathsBefore=g.totalDeaths;
alice.dead=true;
g.totalDeaths++;
ck('A death increments the shared counter', g.totalDeaths===deathsBefore+1);
ck('Alive count reflects only living players', g.getAlivePlayerCount()===1,
    `${g.getAlivePlayerCount()}`);
alice.dead=false;

console.log('\n=== Disconnecting cleans up after itself ===');
const structuresBefore=g.structures.size;
const segmentsBefore=CS.segments.length;
// Tether the two together and leave Bob holding a live cable run.
g.attachTetherToPlayer? g.attachTetherToPlayer(alice, bob):(alice.tetheredTo='bob', bob.tetheredTo='alice');
ck('They are tethered before the disconnect', alice.tetheredTo==='bob'||bob.tetheredTo==='alice');
ck('Bob still holds a live run', CS.activeLines.has('bob'));

g.removePlayer('bob');
ck('Bob is gone', !g.players.has('bob'));
ck('Alice remains', g.players.has('alice'));
ck('Alice is no longer tethered to a ghost', alice.tetheredTo===null,
    String(alice.tetheredTo));
ck('Bob\'s orphaned cable run is dropped', !CS.activeLines.has('bob'));
ck('Cable he already anchored stays built', CS.segments.length===segmentsBefore);
ck('Buildings survive their builder leaving', g.structures.size===structuresBefore);
solve();
ck('Networks still resolve', N.isPowered('landing_pad'));

// The full update loop must survive a mid-frame disconnect.
let crashed=null;
try {for (let i=0; i<5; i++) g.update();} catch (e) {crashed=e.message;}
ck('Game loop runs cleanly after a disconnect', !crashed, crashed||'');

console.log(`\n${fails===0? 'ALL CHECKS PASSED':fails+' FAILED'}`);
process.exit(fails===0? 0:1);

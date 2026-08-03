// Two real socket.io clients against a real server process.
//
// Everything else in tests/ drives Game directly. This one goes through the
// wire: room creation, joining, the game loop broadcasting state, and the
// building/cable handlers -- the parts that only exist in index.js and had
// never been exercised with two connections at once.
//
// Run on its own (it boots a server on a spare port):
//   node tests/integration-2clients.mjs
import {spawn} from 'child_process';
import {createRequire} from 'module';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';

const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(join(here, '../../client/node_modules/'));
const {io}=require('socket.io-client');

const PORT=3097;
const URL=`http://localhost:${PORT}`;
let fails=0;
const ck=(l, c, d='')=>{if (!c) fails++; console.log(`${c? '  PASS':'  FAIL'}  ${l}${d? '  -- '+d:''}`);};
const wait=ms => new Promise(r => setTimeout(r, ms));

// Wait for a socket event, or resolve null on timeout.
const once=(sock, ev, ms=8000)=>new Promise(resolve => {
    const t=setTimeout(() => {sock.off(ev, h); resolve(null);}, ms);
    const h=data => {clearTimeout(t); sock.off(ev, h); resolve(data);};
    sock.on(ev, h);
});

console.log('Booting server on', PORT);
const server=spawn(process.execPath, [join(here, '../index.js')],
    {cwd: join(here, '..'), env: {...process.env, PORT: String(PORT)}});
let serverErr='';
server.stderr.on('data', d => serverErr+=d);

// Wait for it to listen.
await new Promise(resolve => {
    let buf='';
    const h=d => {buf+=d; if (buf.includes('Server running')) {server.stdout.off('data', h); resolve();}};
    server.stdout.on('data', h);
    setTimeout(resolve, 12000);
});

const cleanup=code => {try {server.kill();} catch {} process.exit(code);};

try {
    const alice=io(URL, {transports: ['websocket'], forceNew: true});
    const bob=io(URL, {transports: ['websocket'], forceNew: true});

    await Promise.all([once(alice, 'connect'), once(bob, 'connect')]);
    console.log('\n=== Connection ===');
    ck('Both clients connected', alice.connected&&bob.connected);

    console.log('\n=== Alice creates a room, Bob joins it ===');
    const created=await new Promise(r => alice.emit('createRoom', {nickname: 'Alice'}, r));
    ck('Room created', created&&created.success, JSON.stringify(created));
    const code=created?.roomCode||created?.code;
    ck('Got a room code', !!code, String(code));
    if (!code) throw new Error('no room code');

    const joined=await new Promise(r => bob.emit('joinRoom', {code, nickname: 'Bob'}, r));
    ck('Bob joined the same room', joined&&joined.success, JSON.stringify(joined));

    console.log('\n=== Both receive shared world state ===');
    // The loop broadcasts at 60Hz, so the very next frame either client sees may
    // have been queued before Bob was added. Let it settle, then sample.
    await wait(400);
    const [sa, sb]=await Promise.all([once(alice, 'gameState'), once(bob, 'gameState')]);
    ck('Alice receives gameState', !!sa);
    ck('Bob receives gameState', !!sb);
    ck('Both see two players', sa?.players?.length===2&&sb?.players?.length===2,
        `alice sees ${sa?.players?.length}, bob sees ${sb?.players?.length}`);
    ck('State carries the network payload', !!sa?.networks?.nodes,
        Object.keys(sa?.networks?.nodes||{}).join(','));
    ck('State carries placement rules', typeof sa?.buildRadius==='number', String(sa?.buildRadius));
    console.log('    player payload:', JSON.stringify((sa?.players||[]).map(p=>({id:p.id?.slice(0,6),nick:p.nickname,y:p.y,depth:p.depth,dataNet:p.dataNet}))));
    ck('Each player has their own depth', sa?.players?.every(p => typeof p.depth==='number'));

    console.log('\n=== A build by one player reaches the other ===');
    // Give the colony materials via the debug channel, then craft + place.
    alice.emit('debugCommand', {command: 'maxBuildings'});
    await wait(400);
    const afterBuild=await once(bob, 'gameState');
    const nodeCount=Object.keys(afterBuild?.networks?.nodes||{}).length;
    ck('Bob sees the buildings Alice created', nodeCount>2, `${nodeCount} nodes`);
    ck('Bob sees them as active buildings', (afterBuild?.activeBuildings||[]).length>2,
        `${(afterBuild?.activeBuildings||[]).length}`);

    console.log('\n=== Chat and presence ===');
    const leftPromise=once(alice, 'playerLeft', 5000);
    bob.disconnect();
    const left=await leftPromise;
    ck('Alice is told Bob left', !!left, JSON.stringify(left));

    await wait(500);
    const afterLeave=await once(alice, 'gameState');
    ck('Alice still receives state after Bob leaves', !!afterLeave);
    ck('Player list shrank to one', afterLeave?.players?.length===1,
        `${afterLeave?.players?.length}`);
    ck('The world survived the disconnect',
        Object.keys(afterLeave?.networks?.nodes||{}).length===nodeCount);

    alice.disconnect();
    await wait(300);
    ck('Server logged no crash', !/Error|TypeError|ReferenceError/.test(serverErr),
        serverErr.split('\n').filter(l => /Error/.test(l))[0]||'');
} catch (e) {
    fails++;
    console.log('  FAIL  harness threw --', e.message);
}

console.log(`\n${fails===0? 'ALL CHECKS PASSED':fails+' FAILED'}`);
cleanup(fails===0? 0:1);

// Runs every check harness and reports a single pass/fail.
//
//   node tests/run-all.mjs        (from the server/ directory)
//
// Each harness boots a real Game with real physics and real terrain, so they
// are slow (a few seconds each) but they exercise the actual systems rather
// than mocks. Terrain is randomly seeded per run, so a genuine pass means it
// held on that seed -- run it a few times when changing generation or placement.

import {spawn} from 'child_process';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {readdirSync} from 'fs';

const here=dirname(fileURLToPath(import.meta.url));
const files=readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();

let failed=0;

for (const file of files) {
    const label=file.replace('.test.mjs', '');
    const out=await new Promise(resolve => {
        const p=spawn(process.execPath, [join(here, file)], {cwd: join(here, '..')});
        let buf='';
        p.stdout.on('data', d => buf+=d);
        p.stderr.on('data', d => buf+=d);
        p.on('close', code => resolve({code, buf}));
    });

    const passes=(out.buf.match(/^\s+PASS/gm)||[]).length;
    const fails=(out.buf.match(/^\s+FAIL/gm)||[]).length;
    if (out.code!==0||fails>0) {
        failed++;
        console.log(`FAIL  ${label.padEnd(18)} ${passes} passed, ${fails} failed`);
        for (const line of out.buf.split('\n').filter(l => /^\s+FAIL/.test(l))) console.log(`        ${line.trim()}`);
    } else {
        console.log(`ok    ${label.padEnd(18)} ${passes} checks`);
    }
}

console.log(failed===0? '\nAll harnesses passed.':`\n${failed} harness(es) failed.`);
process.exit(failed===0? 0:1);

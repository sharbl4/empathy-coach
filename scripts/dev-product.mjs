import {spawnSync,spawn} from 'node:child_process';
if(!process.env.npm_execpath)throw new Error('Use npm run dev');
const build=spawnSync(process.execPath,['scripts/build-product.mjs','--typecheck'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status??1);
const processes=[spawn(process.execPath,['scripts/launch-product.mjs'],{stdio:'inherit'}),spawn(process.execPath,[process.env.npm_execpath,'run','dev','-w','@between/web'],{stdio:'inherit'})];
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of processes)child.kill('SIGTERM');}
for(const child of processes){child.on('error',stop);child.on('exit',code=>{if(!stopping)process.exitCode=code??1;stop();});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);

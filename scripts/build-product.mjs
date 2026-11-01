import {existsSync,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
if(!process.env.npm_execpath)throw new Error('Use root npm scripts');
function npm(args){const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
function node(file,args=[]){const result=spawnSync(process.execPath,[file,...args],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
npm(['run','build','-w','@between/contracts']);
const required=['apps/api/src/domain/facade.ts','apps/api/src/http/index.ts','apps/bot/src/index.ts'];
const missing=required.filter(file=>!existsSync(file));
if(missing.length){console.error(`BLOCKED B1/B2/C1 integration: ${missing.join(', ')}. No job skipped or stub substituted.`);process.exit(1);}
node('scripts/check-web-runtime.mjs',['--source-only']);
for(const folder of ['apps/api/dist','apps/bot/dist']){const target=resolve(folder),inside=relative(resolve('.'),target);if(inside.startsWith('..')||isAbsolute(inside))throw new Error('Unsafe output path');rmSync(target,{recursive:true,force:true});}
npm(['run','build','-w','@between/api']);npm(['run','build','-w','@between/bot']);
npm(['exec','--','tsc','-p','tsconfig.boundaries.json']);
if(process.argv.includes('--typecheck')){npm(['run','typecheck','-w','@between/api']);npm(['run','typecheck','-w','@between/bot']);npm(['run','typecheck','-w','@between/web']);}
else{node('scripts/build-web.mjs');node('scripts/check-web-runtime.mjs');}

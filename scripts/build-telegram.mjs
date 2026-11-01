import {existsSync,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
if(!process.env.npm_execpath)throw new Error('Run via root npm scripts');
function npm(args){const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
npm(['run','build','-w','@between/contracts']);
const missing=['apps/api/src/domain/facade.ts','apps/bot/src/main.ts'].filter(path=>!existsSync(path));
if(missing.length){console.error(`BLOCKED integration: missing ${missing.join(', ')}; implement issues #15/#16. No legacy runtime substituted.`);process.exit(1);}
for(const directory of ['apps/api/dist','apps/bot/dist']){
  const target=resolve(directory),within=relative(resolve('.'),target);
  if(within.startsWith('..')||isAbsolute(within))throw new Error('Build output outside workspace');
  rmSync(target,{recursive:true,force:true});
}
const typecheck=process.argv.includes('--typecheck');
npm(['run','build','-w','@between/api']);
if(typecheck)npm(['run','typecheck','-w','@between/api']);
const result=spawnSync(process.execPath,['scripts/check-domain-export.mjs'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
npm(['run',typecheck?'typecheck':'build','-w','@between/bot']);

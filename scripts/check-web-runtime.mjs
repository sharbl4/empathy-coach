import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
function files(root){return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(root,entry.name)):[join(root,entry.name)]);}
let failed=false;
for(const path of files('apps/web/src').filter(path=>/\.[jt]sx?$/.test(path))){
  if(/(?:from\s*|import\s*\()\s*['"]@supabase\//.test(readFileSync(path,'utf8'))){console.error(`BLOCKED legacy client Auth import: ${path}; C1/C2 must replace it with shared cookie-session API.`);failed=true;}
}
if(!process.argv.includes('--source-only')){
  if(!existsSync('apps/web/dist')){console.error('BLOCKED web build missing');failed=true;}
  else for(const path of files('apps/web/dist').filter(path=>path.endsWith('.js'))){if(/dev-fixture-token|supabase\.co|@supabase\/|createFixtureAuth|GIGACHAT_CREDENTIALS|EMAIL_CODE_SECRET|WEB_SESSION_SECRET/.test(readFileSync(path,'utf8'))){console.error('BLOCKED legacy/fixture/secret markers in browser artifacts; content suppressed');failed=true;}}
}
if(failed)process.exitCode=1;else console.log('OK browser source/artifacts: no legacy Auth or runtime fixture markers');

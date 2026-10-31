import {readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const api=readdirSync('apps/api/test').filter(file=>/^domain.*\.test\.ts$/.test(file)).map(file=>`apps/api/test/${file}`);
const bot=existsSync('apps/bot/test')?readdirSync('apps/bot/test').filter(file=>file.endsWith('.test.ts')).map(file=>`apps/bot/test/${file}`):[];
let safeDatabase=false;
try{
  const target=new URL(process.env.TEST_DATABASE_URL),runtime=new URL(process.env.DATABASE_URL);
  const host=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'loopback':url.hostname;
  safeDatabase=['postgres:','postgresql:'].includes(target.protocol)&&decodeURIComponent(target.pathname).toLowerCase().includes('test')&&`${host(target)}:${target.port||5432}${target.pathname}`!==`${host(runtime)}:${runtime.port||5432}${runtime.pathname}`;
}catch{/* no valid dedicated test DB */}
if(!api.length||!bot.length||process.env.NODE_ENV!=='test'||!safeDatabase){console.error('BLOCKED: new domain DB tests, bot tests, NODE_ENV=test and distinct TEST_DATABASE_URL with test in its DB name are mandatory; legacy HTTP/fixture tests are not substitutes.');process.exit(1);}
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=tap',...api,...bot],{encoding:'utf8'});
const output=result.stdout??'',tests=Number(/^# tests (\d+)$/m.exec(output)?.[1]??0),failed=Number(/^# fail (\d+)$/m.exec(output)?.[1]??1),skipped=Number(/^# skipped (\d+)$/m.exec(output)?.[1]??1);
console.log(`Domain/bot checks: tests=${tests}, failed=${failed}, skipped=${skipped}; raw output suppressed.`);
process.exit(result.status===0&&tests>0&&failed===0&&skipped===0?0:1);

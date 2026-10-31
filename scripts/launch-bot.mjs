import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
try{if(existsSync('.env'))loadEnvFile('.env');}catch{console.error('BLOCKED root env load; values suppressed');process.exit(1);}
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'){console.error('BLOCKED TLS bypass');process.exit(1);}
const entry=process.argv.includes('--dev')?'apps/bot/src/main.ts':'apps/bot/dist/main.js';
if(!existsSync(entry)){console.error('BLOCKED Telegram entry missing; complete #15/#16 and root build. No web/server fallback.');process.exit(1);}
const current=['NODE_ENV','DATABASE_URL','TELEGRAM_BOT_TOKEN','AI_PROVIDER','LOCAL_LLM_BASE_URL','LOCAL_LLM_MODEL','LOCAL_LLM_API_KEY','AI_TIMEOUT_MS','AI_MAX_CONCURRENCY','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','EMAIL_CODE_SECRET'];
const os=['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE','LANG','TZ'];
const env=Object.fromEntries([...current,...os].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const args=process.argv.includes('--dev')?['--watch','--import','tsx',entry]:[entry];
const child=spawn(process.execPath,args,{stdio:'inherit',env});
child.on('error',()=>{console.error('BLOCKED bot process launch; raw error suppressed');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGINT'?130:1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

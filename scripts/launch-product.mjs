import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
try{if(existsSync('.env'))loadEnvFile('.env');}catch{console.error('CONFIG_INVALID: root env load failed; no values shown');process.exit(1);}
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'){console.error('TLS bypass forbidden');process.exit(1);}
if(process.env.NODE_ENV==='production'&&Object.entries(process.env).some(([key,value])=>(/BYPASS|FIXTURE|TEST_ADAPTER|MOCK/.test(key)||key==='VITE_API_MODE')&&value&&!['0','false','http'].includes(value))){console.error('Production test/fixture/bypass flags forbidden');process.exit(1);}
const fields=['NODE_ENV','DATABASE_URL','TELEGRAM_BOT_TOKEN','AI_PROVIDER','LOCAL_LLM_BASE_URL','LOCAL_LLM_MODEL','LOCAL_LLM_API_KEY','AI_TIMEOUT_MS','AI_MAX_CONCURRENCY','AI_MAX_QUEUE_LENGTH','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','EMAIL_CODE_SECRET','WEB_ORIGIN','WEB_SESSION_SECRET','WEB_LINK_SECRET','PORT','TRUSTED_PROXY_IPS'];
const system=['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE','LANG','TZ'];
const env=Object.fromEntries([...fields,...system].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const child=spawn(process.execPath,['scripts/application.mjs'],{stdio:'inherit',env});
child.on('error',()=>{console.error('APP_LAUNCH_FAILED');process.exitCode=1;});child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGINT'?130:1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

// Connectivity only: no email sending, generation, migrations or secret output.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
const requireApi=createRequire(new URL('../apps/api/package.json',import.meta.url));
let failed=false;
function status(name,ok,detail){console.log(`${ok?'OK':'BLOCKED'} ${name}: ${detail}`);if(!ok)failed=true;}
const has=name=>Boolean(process.env[name]?.trim());
const listModels=process.argv.includes('--list-models');
async function check(name,required,fn){
  const missing=required.filter(k=>!has(k));
  if(missing.length){status(name,false,`missing ${missing.join(', ')}`);return;}
  try{await fn();}catch{status(name,false,'connection/configuration failed; response and credentials suppressed');}
}
await check('PostgreSQL',['DATABASE_URL'],async()=>{
  const url=new URL(process.env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw new Error();
  const {Pool}=requireApi('pg');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:3000});
  try{await pool.query('SELECT 1');status('PostgreSQL',true,'SELECT 1; migrations NOT checked');}finally{await pool.end();}
});
await check('Supabase Auth',['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'],async()=>{
  const url=new URL(process.env.SUPABASE_URL);
  if(url.protocol!=='https:')throw new Error();
  const response=await globalThis.fetch(new URL('/auth/v1/settings',url),{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY},signal:globalThis.AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok){status('Supabase Auth',false,`HTTP ${response.status}`);return;}
  const settings=await response.json();
  status('Supabase Auth',true,'settings endpoint reachable; email delivery/redirects NOT checked');
  status('Email/password',settings.external?.email===true,'email provider must be enabled');
  status('Signup',settings.disable_signup===false,'new signups must be enabled');
  status('Email confirmation',settings.mailer_autoconfirm===false,'confirmation must remain enabled');
});
for(const [browser,server] of [['VITE_SUPABASE_URL','SUPABASE_URL'],['VITE_SUPABASE_PUBLISHABLE_KEY','SUPABASE_PUBLISHABLE_KEY']])
  status(browser,has(browser)&&has(server)&&process.env[browser]===process.env[server],'must match server public configuration');
await check('GigaChat',['GIGACHAT_CREDENTIALS','GIGACHAT_SCOPE','GIGACHAT_BASE_URL',...(listModels?[]:['GIGACHAT_MODEL'])],async()=>{
  if(!['GIGACHAT_API_PERS','GIGACHAT_API_B2B','GIGACHAT_API_CORP'].includes(process.env.GIGACHAT_SCOPE))throw new Error();
  const base=new URL(process.env.GIGACHAT_BASE_URL);
  if(base.origin!=='https://api.giga.chat'||base.pathname.replace(/\/$/,'')!=='/v1')throw new Error();
  const response=await globalThis.fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth',{
    method:'POST',redirect:'error',signal:globalThis.AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json',RqUID:randomUUID(),Authorization:`Basic ${process.env.GIGACHAT_CREDENTIALS}`},
    body:new URLSearchParams({scope:process.env.GIGACHAT_SCOPE})
  });
  if(!response.ok){status('GigaChat OAuth',false,`HTTP ${response.status}`);return;}
  const token=await response.json();
  if(typeof token.access_token!=='string'||typeof token.expires_at!=='number')throw new Error();
  status('GigaChat OAuth',true,'access token received in memory only');
  const models=await globalThis.fetch(new URL('/v1/models',base),{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'error',signal:globalThis.AbortSignal.timeout(10000)});
  if(!models.ok){status('GigaChat models',false,`HTTP ${models.status}`);return;}
  const data=await models.json();
  if(listModels){
    if(!Array.isArray(data.data))throw new Error();
    const ids=data.data.map(m=>m.id).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9:._-]{1,100}$/.test(id));
    console.log(`Available model IDs: ${ids.join(', ')}`);
    status('GigaChat model discovery',ids.length>0,'discovery only; set GIGACHAT_MODEL and rerun the default check');return;
  }
  status('GigaChat model',Array.isArray(data.data)&&data.data.some(m=>m.id===process.env.GIGACHAT_MODEL),'configured model must be available; generation/budget NOT checked');
});
status('Live mode',process.env.AI_PROVIDER==='gigachat','AI_PROVIDER must be gigachat');
console.log('SMTP, real login, migrations and live analysis require the separate checkpoint.');
process.exitCode=failed?1:0;

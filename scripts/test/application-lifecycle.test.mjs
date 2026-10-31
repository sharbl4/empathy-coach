import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startApplication} from '../application.mjs';
const {AbortController}=globalThis;
const config={NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',TELEGRAM_BOT_TOKEN:'123456:test_token_not_used_for_network',AI_PROVIDER:'local',LOCAL_LLM_BASE_URL:'http://127.0.0.1:8080/v1',LOCAL_LLM_MODEL:'synthetic',SMTP_HOST:'smtp.invalid',SMTP_FROM:'noreply@example.invalid',EMAIL_CODE_SECRET:'a'.repeat(64),WEB_ORIGIN:'http://localhost:3000',WEB_SESSION_SECRET:'b'.repeat(64),WEB_LINK_SECRET:'c'.repeat(64)};
function adapters(events,fail){
  const abort=new AbortController(),leaseAbort=new AbortController();
  return {createTelegramTransport:()=>({identify:async()=>({botId:'123456',username:'test_coach_bot'}),start:async()=>{events.push('polling');},health:()=>({polling:true}),stop:async()=>{events.push('stop-polling');},finished:new Promise(()=>{})}),
    createDomain:async()=>({acquirePollerLease:async()=>{events.push('lease');return {signal:leaseAbort.signal,release:async()=>{events.push('release');}};},start:async()=>{events.push('workers');},stopAccepting:async()=>{events.push('stop-accepting');},close:async()=>{events.push('close-domain');},health:async()=>({database:true,pollerLease:true,workers:true,scheduler:true}),shutdownSignal:abort.signal}),
    createHttpAdapter:async()=>({listen:async()=>{events.push('http');if(fail)throw new Error('private error must be suppressed');},health:()=>({listening:true}),close:async()=>{events.push('close-http');}})};
}
test('partial startup closes HTTP, polling, domain and lease even after a failure',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';const events=[];
  try{await assert.rejects(startApplication(config,adapters(events,true)),/APP_START_FAILED:http/);for(const event of ['stop-polling','close-http','close-domain','release'])assert.ok(events.includes(event));assert.ok(!events.includes('polling'));}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('one lifecycle starts lease/workers/http/polling in order and closes once',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';const dir=mkdtempSync(join(tmpdir(),'between-app-')),events=[];
  try{const application=await startApplication(config,{...adapters(events,false),healthFile:join(dir,'health.json')});assert.deepEqual(events.slice(0,4),['lease','workers','http','polling']);await Promise.all([application.close(),application.close()]);assert.equal(events.filter(event=>event==='close-domain').length,1);}
  finally{rmdirSync(dir);if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('production refuses the explicit test factory seam before boot',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(startApplication({...config,NODE_ENV:'production'},adapters([],false)),/Test adapters forbidden/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('production rejects bypass and fixture modes before imports or networking',async()=>{
  for(const flags of [{AUTH_BYPASS:'1'},{VITE_API_MODE:'fixtures'},{TEST_ADAPTER:'true'}])await assert.rejects(startApplication({...config,NODE_ENV:'production',...flags}),/Production adapter flags forbidden/);
});

test('a stuck shutdown step does not prevent remaining resource close attempts',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';const dir=mkdtempSync(join(tmpdir(),'between-deadline-')),events=[];
  const factories=adapters(events,false),createDomain=factories.createDomain;
  factories.createDomain=async()=>({...await createDomain(),stopAccepting:()=>new Promise(()=>{})});
  try{const application=await startApplication(config,{...factories,closeTimeoutMs:20,healthFile:join(dir,'health.json')});await assert.rejects(application.close(),/Application close incomplete/);for(const action of ['stop-polling','close-http','close-domain','release'])assert.ok(events.includes(action));}
  finally{rmdirSync(dir);if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

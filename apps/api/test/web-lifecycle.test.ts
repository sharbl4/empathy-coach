import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProductFacade,PollerLease} from '@between/contracts/product';
import {createHttpAdapter} from '../src/http/index.js';
import {productHarness} from './product-harness.js';

test('shared application lifecycle owns one real PG domain and HTTP listener; close releases port and poller lease',async()=>{
  const h=await productHarness(),dir=await mkdtemp(join(tmpdir(),'between-real-lifecycle-'));
  const entry=new URL('../../../scripts/application.mjs',import.meta.url).href;
  const {startApplication}=await import(entry);
  let constructed=0,stopped=0,closed=false;
  const environment={NODE_ENV:'test',DATABASE_URL:h.options.databaseUrl,TELEGRAM_BOT_TOKEN:'99000009:synthetic_not_used_for_network',AI_PROVIDER:'local',LOCAL_LLM_BASE_URL:h.options.ai.baseUrl,LOCAL_LLM_MODEL:'explicit-test-model',SMTP_HOST:'smtp.invalid',SMTP_FROM:'test@example.invalid',EMAIL_CODE_SECRET:'1'.repeat(64),WEB_ORIGIN:h.options.web.origin,WEB_SESSION_SECRET:'2'.repeat(64),WEB_LINK_SECRET:'3'.repeat(64),PORT:'3011'};
  try{
    const app=await startApplication(environment,{healthFile:join(dir,'health.json'),
      createDomain:async()=>{constructed++;return h.domain;},
      createHttpAdapter:async(options:Parameters<typeof createHttpAdapter>[0])=>{assert.equal(options.domain,h.domain);return createHttpAdapter(options);},
      // Explicit network-free Telegram transport only; DB, workers and HTTP are real.
      createTelegramTransport:()=>({identify:async()=>({botId:'99000009',username:'synthetic_test_bot'}),start:async(domain:ProductFacade,lease:PollerLease)=>{assert.equal(domain,h.domain);assert.equal(lease.signal.aborted,false);},health:()=>({polling:true}),stop:async()=>{stopped++;},finished:new Promise(()=>{})})});
    assert.equal(constructed,1);assert.equal((await h.domain.health()).workers,true);assert.equal((await fetch('http://127.0.0.1:3011/api/health/ready')).status,200);
    await Promise.all([app.close(),app.close()]);closed=true;assert.equal(stopped,1);await assert.rejects(access(app.healthFile));await assert.rejects(fetch('http://127.0.0.1:3011/api/health/live'));
    // Another instance can take the exact lease after the shared process closes.
    const connection=await h.db.connect();try{assert.equal((await connection.query("SELECT pg_try_advisory_lock(hashtextextended('99000009',1206)) AS acquired")).rows[0].acquired,true);await connection.query("SELECT pg_advisory_unlock(hashtextextended('99000009',1206))");}finally{connection.release();}
  }finally{if(!closed)await h.domain.close();await h.close();await rmdir(dir);}
});

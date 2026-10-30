import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Storage } from '../src/repositories/storage.js';
import { Runs } from '../src/services/runs.js';
import { migrate } from '../src/db/migrate.js';
import { HttpError } from '../src/errors.js';
import { ModelError } from '../src/ai/provider.js';
import { Analysis, type OutputFor } from '@between/contracts';
import { situations, outputFixtures } from '@between/contracts/fixtures';
import { databaseSuiteLock } from './database.js';

const database=process.env.TEST_DATABASE_URL;
test('runs: ownership, duplicate/concurrent POST, caps, restart, failure and late output', {skip:!database&&'Set TEST_DATABASE_URL for real PostgreSQL integration'},async()=>{
  if(!database||!/test/.test(new URL(database).pathname)||database===process.env.DATABASE_URL||process.env.NODE_ENV!=='test')throw new Error('Unsafe database');
  const unlock=await databaseSuiteLock(database);
  const pool=new Pool({connectionString:database,max:8});await migrate(pool);
  const store=new Storage(pool),users=[randomUUID(),randomUUID()];
  let calls=0;
  let complete:((value:OutputFor<'analysis'>)=>void)|undefined;
  let failure:((error:Error)=>void)|undefined;
  const runs=new Runs(pool,{analyze:async()=>{calls++;return new Promise((resolve,reject)=>{complete=resolve;failure=reject;});}},2,1,5000);
  const output=Analysis.parse(outputFixtures.analysis);
  const wait=async(id:string,status:string)=>{
    for(let i=0;i<100;i++){const run=await runs.get(users[0],id);if(run.status===status)return run;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.fail(`Run did not become ${status}`);
  };
  try {
    await runs.start();
    const second=new Runs(pool,{analyze:async()=>output});await assert.rejects(second.start(),/one backend/);
    const session=await store.create(users[0],situations[0]);
    const other=await store.create(users[0],situations[0]);
    const key=randomUUID();
    const requests=await Promise.all([1,2,3].map(()=>runs.analyze(users[0],session.id,1,key)));
    assert.equal(new Set(requests.map(r=>r.runId)).size,1);assert.equal(calls,1);
    const id=requests[0].runId;
    await assert.rejects(runs.get(users[1],id),e=>e instanceof HttpError&&e.statusCode===404);
    await assert.rejects(runs.analyze(users[1],session.id,1,key),e=>e instanceof HttpError&&e.statusCode===404);
    await assert.rejects(runs.analyze(users[0],session.id,2,key),e=>e instanceof HttpError&&e.code==='IDEMPOTENCY_CONFLICT');
    await assert.rejects(runs.analyze(users[0],other.id,1,key),e=>e instanceof HttpError&&e.code==='IDEMPOTENCY_CONFLICT');
    await assert.rejects(runs.analyze(users[0],other.id,1,randomUUID()),e=>e instanceof HttpError&&e.statusCode===429);
    await assert.rejects(store.update(users[0],session.id,{...situations[0],expectedRevision:1}),e=>e instanceof HttpError&&e.code==='OPERATION_IN_PROGRESS');
    complete?.(output);await wait(id,'succeeded');
    assert.equal((await runs.analyze(users[0],session.id,1,key)).runId,id);assert.equal(calls,1);
    assert.equal((await pool.query('SELECT 1 FROM app.practice_events WHERE source_run_id=$1',[id])).rowCount,1);
    const failed=await runs.analyze(users[0],session.id,1,randomUUID());failure?.(new ModelError('MODEL_TIMEOUT'));
    assert.equal((await wait(failed.runId,'failed')).errorCode,'MODEL_TIMEOUT');
    const late=await runs.analyze(users[0],session.id,1,randomUUID());
    await store.clear(users[0]);complete?.(output);
    await assert.rejects(runs.get(users[0],late.runId),e=>e instanceof HttpError&&e.statusCode===404);
    await runs.close();assert.equal((await pool.query('SELECT 1 FROM app.practice_events WHERE user_id=$1',[users[0]])).rowCount,0);
    const next=await store.create(users[0],situations[0]);
    const interrupted=randomUUID();
    await pool.query(`INSERT INTO app.ai_runs(id,session_id,user_id,revision,kind,status,input,prompt_version,idempotency_key,payload_hash) VALUES($1,$2,$3,1,'analysis','pending',$4,'test',$5,'hash')`,[interrupted,next.id,users[0],situations[0],randomUUID()]);
    const restarted=new Runs(pool,{analyze:async()=>{assert.fail('Must not replay paid call');}});
    try {await restarted.start();assert.equal((await restarted.get(users[0],interrupted)).errorCode,'RUN_INTERRUPTED');}
    finally {await restarted.close();}
    const timeout=new Runs(pool,{analyze:async()=>new Promise(()=>{})},1,1,20);
    try {
      await timeout.start();const run=await timeout.analyze(users[0],next.id,1,randomUUID());
      for(let i=0;i<100;i++){
        const value=await timeout.get(users[0],run.runId);
        if(value.status==='failed'){assert.equal(value.errorCode,'MODEL_TIMEOUT');break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal((await timeout.get(users[0],run.runId)).status,'failed');
    }finally{await timeout.close();}
  }finally{
    await runs.close();
    await pool.query('DELETE FROM app.sessions WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM app.profiles WHERE id=ANY($1::uuid[])',[users]);await pool.end();await unlock();
  }
});

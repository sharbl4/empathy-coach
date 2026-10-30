import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { HttpError } from '../src/errors.js';
import { ApiError, Analysis } from '@between/contracts';
import { databaseSuiteLock } from './database.js';
import { outputFixtures } from '@between/contracts/fixtures';

const database=process.env.TEST_DATABASE_URL;
// Opt-in only: test DB name and a URL distinct from the deployed connection are mandatory.
function testPool() {
  if(!database) throw new Error('TEST_DATABASE_URL required');
  const name=new URL(database).pathname.slice(1);
  if(!/test/.test(name)||database===process.env.DATABASE_URL||process.env.NODE_ENV!=='test') throw new Error('Refusing unsafe database');
  return new Pool({connectionString:database});
}
test('production refuses injected Auth',async()=>{
  const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try {await assert.rejects(createApp({auth:{verify:async()=>randomUUID()}}),/test-only/);}
  finally {process.env.NODE_ENV=old;}
});
test('storage: migrations, two owners, revisions, cursor, persistence, cascade', {skip:!database&&'Set TEST_DATABASE_URL to run real PostgreSQL integration'},async()=>{
  const pool=testPool();
  const unlock=await databaseSuiteLock(database!);
  const owners=[randomUUID(),randomUUID()];
  const old=process.env.NODE_ENV;process.env.NODE_ENV='test';
  await migrate(pool);await migrate(pool);
  const app=await createApp({pool,provider:{analyze:async()=>Analysis.parse(outputFixtures.analysis)},auth:{verify:async token=>{
    if(token==='down')throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Auth недоступен');
    if(!owners.includes(token))throw new HttpError(401,'UNAUTHORIZED','Неверный токен');
    return token;
  }}});
  const input={title:'Проверка',situation:{message:'Давай завтра',relationship:'Коллега',context:'',goal:'clarify'},guess:{emotions:[],evidenceQuotes:['завтра'],unsure:true}};
  const request=async(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,owner=owners[0],payload?:unknown)=>{
    const response=await app.inject({method,url,headers:{authorization:`Bearer ${owner}`},payload});
    if(response.statusCode>=400)ApiError.parse(response.json());
    return response;
  };
  try {
    assert.equal((await app.inject('/api/me')).statusCode,401);
    assert.equal((await request('GET','/api/me','bad')).statusCode,401);
    assert.equal((await request('GET','/api/me','down')).statusCode,503);
    assert.equal((await request('GET','/api/me')).statusCode,200);
    assert.equal((await request('PATCH','/api/me',owners[0],{displayName:'Дима',onboardingCompleted:true})).json().displayName,'Дима');
    assert.equal((await request('POST','/api/sessions',owners[0],{...input,userId:owners[1]})).statusCode,400);
    const created=await request('POST','/api/sessions',owners[0],input);assert.equal(created.statusCode,201);
    const id=created.json().id;
    const key=randomUUID();
    const analyze=()=>app.inject({method:'POST',url:`/api/sessions/${id}/analyze`,headers:{authorization:`Bearer ${owners[0]}`,'idempotency-key':key},payload:{expectedRevision:1}});
    const accepted=await analyze();assert.equal(accepted.statusCode,202);const runId=accepted.json().runId;
    for(let i=0;i<100;i++){
      const run=await request('GET',`/api/runs/${runId}`);
      assert.equal(run.statusCode,200);
      if(run.json().status==='succeeded')break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal((await request('GET',`/api/runs/${runId}`)).json().status,'succeeded');
    assert.equal((await request('GET',`/api/runs/${runId}`,owners[1])).statusCode,404);
    assert.equal((await analyze()).json().runId,runId);
    assert.equal((await request('GET',`/api/sessions/${id}`)).json().runs.length,1);
    for(const method of ['GET','PATCH','DELETE'] as const)assert.equal((await request(method,`/api/sessions/${id}`,owners[1],method==='PATCH'?{...input,expectedRevision:1}:undefined)).statusCode,404);
    const updates=await Promise.all([1,2].map(i=>request('PATCH',`/api/sessions/${id}`,owners[0],{...input,title:`Новое ${i}`,expectedRevision:1})));
    assert.deepEqual(updates.map(r=>r.statusCode).sort(),[200,409]);
    assert.equal((await request('GET',`/api/sessions/${id}`)).json().revision,2);
    assert.equal((await request('GET',`/api/sessions/${id}`)).json().runs.length,0);
    assert.equal((await request('GET',`/api/runs/${runId}`)).statusCode,409);
    const fresh=new Pool({connectionString:database});
    try{assert.equal((await fresh.query('SELECT revision FROM app.sessions WHERE id=$1',[id])).rows[0].revision,2);}finally{await fresh.end();}
    await request('POST','/api/sessions',owners[0],input);
    const page=(await request('GET','/api/sessions?limit=1')).json();assert.equal(page.items.length,1);assert.ok(page.nextCursor);
    const next=(await request('GET',`/api/sessions?limit=1&cursor=${page.nextCursor}`)).json();assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,page.items[0].id);
    assert.equal((await request('GET',`/api/sessions?limit=1&cursor=${page.nextCursor}`,owners[1])).json().items.length,0);
    assert.equal((await request('GET','/api/sessions?cursor=garbage')).statusCode,400);
    assert.equal((await request('GET','/api/sessions?q=%25')).json().items.length,0);
    const run=randomUUID();
    await pool.query(`INSERT INTO app.ai_runs(id,session_id,user_id,revision,kind,status,input,prompt_version,idempotency_key,payload_hash) VALUES($1,$2,$3,2,'analysis','pending','{}','test',$4,'hash')`,[run,id,owners[0],randomUUID()]);
    assert.equal((await request('DELETE',`/api/sessions/${id}`)).statusCode,409);
    assert.equal((await request('PATCH',`/api/sessions/${id}`,owners[0],{...input,expectedRevision:2})).statusCode,409);
    await assert.rejects(pool.query(`INSERT INTO app.ai_runs(id,session_id,user_id,revision,kind,status,input,prompt_version,idempotency_key,payload_hash) VALUES($1,$2,$3,2,'analysis','pending','{}','test',$4,'hash')`,[randomUUID(),id,owners[1],randomUUID()]));
    assert.equal((await request('DELETE','/api/me/data',owners[0],{confirmation:'DELETE_MY_LEARNING_DATA'})).statusCode,204);
    assert.equal((await pool.query('SELECT 1 FROM app.ai_runs WHERE id=$1',[run])).rowCount,0);
    assert.equal((await request('GET','/api/sessions')).json().items.length,0);
    assert.equal((await request('GET','/api/me')).json().displayName,'Дима');
  } finally {
    await pool.query('DELETE FROM app.sessions WHERE user_id=ANY($1::uuid[])',[owners]);
    await pool.query('DELETE FROM app.profiles WHERE id=ANY($1::uuid[])',[owners]);
    await app.close();await unlock();process.env.NODE_ENV=old;
  }
});

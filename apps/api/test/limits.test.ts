import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Analysis,type OutputFor} from '@between/contracts';
import {situations,outputFixtures} from '@between/contracts/fixtures';
import {Storage} from '../src/repositories/storage.js';
import {Runs} from '../src/services/runs.js';
import {migrate} from '../src/db/migrate.js';
import {HttpError} from '../src/errors.js';
import {databaseSuiteLock} from './database.js';

const url=process.env.TEST_DATABASE_URL;
test('executing permits survive bulk deletion, cancellation and deadline across owners',{skip:!url&&'Requires separate PostgreSQL test DB'},async()=>{
  if(!url||!/test/.test(new URL(url).pathname)||url===process.env.DATABASE_URL||process.env.NODE_ENV!=='test')throw new Error('Unsafe DB');
  const unlock=await databaseSuiteLock(url),pool=new Pool({connectionString:url});
  const owners=[randomUUID(),randomUUID()],store=new Storage(pool);
  const output=Analysis.parse(outputFixtures.analysis);
  try {
    await migrate(pool);
    for(const [cap,timeout] of [[1,5000],[2,5000],[1,30]]){
      const calls:Array<{resolve:(value:OutputFor<'analysis'>)=>void;signal:AbortSignal}>=[];
      const runs=new Runs(pool,{analyze:async(_input,signal)=>new Promise(resolve=>calls.push({resolve,signal}))},cap,1,timeout);
      await runs.start();
      try {
        const first=await store.create(owners[0],situations[0]);
        const accepted=await runs.analyze(owners[0],first.id,1,randomUUID());
        if(timeout===30){
          for(let i=0;i<100;i++){if((await runs.get(owners[0],accepted.runId)).status==='failed')break;await new Promise(resolve=>setTimeout(resolve,10));}
          assert.equal((await runs.get(owners[0],accepted.runId)).errorCode,'MODEL_TIMEOUT');
        }
        await store.clear(owners[0],ids=>runs.cancelDeleted(ids));
        assert.equal(calls[0].signal.aborted,true);
        const next=await store.create(owners[0],situations[0]);
        await assert.rejects(runs.analyze(owners[0],next.id,1,randomUUID()),e=>e instanceof HttpError&&e.statusCode===429);
        assert.equal(calls.length,1);
        const other=await store.create(owners[1],situations[0]);
        if(cap===1)await assert.rejects(runs.analyze(owners[1],other.id,1,randomUUID()),e=>e instanceof HttpError&&e.statusCode===429);
        else {await runs.analyze(owners[1],other.id,1,randomUUID());assert.equal(calls.length,2);}
        calls[0].resolve(output);await new Promise(resolve=>setImmediate(resolve));
        await runs.analyze(owners[0],next.id,1,randomUUID());assert.equal(calls.length,cap===1?2:3);
        for(const call of calls)call.resolve(output);
      }finally{
        for(const call of calls)call.resolve(output);
        await runs.close();
        for(const owner of owners)await store.clear(owner);
      }
    }
  }finally{
    await pool.query('DELETE FROM app.profiles WHERE id=ANY($1::uuid[])',[owners]);await pool.end();await unlock();
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {InjectOptions} from 'fastify';
import {api,outputs,Run,RunAccepted,SessionDetail,Progress,ApiError,type Run as RunDto} from '@between/contracts';
import {situations,outputFixtures} from '@between/contracts/fixtures';
import {createApp} from '../src/app.js';
import {migrate} from '../src/db/migrate.js';
import {type AiProvider,ModelError} from '../src/ai/provider.js';
import {Storage} from '../src/repositories/storage.js';
import {databaseSuiteLock} from './database.js';

const database=process.env.TEST_DATABASE_URL;
const options={skip:!database&&'Requires separate PostgreSQL test DB'};
type Kind=RunDto['kind'];
async function harness(){
  if(!database||!/test/.test(new URL(database).pathname)||database===process.env.DATABASE_URL||process.env.NODE_ENV!=='test')throw new Error('Unsafe DB');
  const unlock=await databaseSuiteLock(database);let pool=new Pool({connectionString:database});await migrate(pool);
  const owners:string[]=[randomUUID(),randomUUID()];
  const calls:Array<{kind:Kind;context:unknown}>=[];
  const fail=new Set<Kind>(),invalid=new Set<Kind>();
  let defer:Kind|undefined,release:((value:unknown)=>void)|undefined;
  async function answer(kind:Kind,context:unknown):Promise<unknown>{
    calls.push({kind,context:structuredClone(context)});
    if(fail.delete(kind))throw new ModelError('MODEL_UNAVAILABLE');
    if(invalid.delete(kind))return {};
    if(defer===kind)return new Promise(resolve=>{release=resolve;});
    return outputFixtures[kind];
  }
  const provider:AiProvider={
    analyze:async input=>outputs.analysis.parse(await answer('analysis',input)),
    replyFeedback:async input=>outputs.reply_feedback.parse(await answer('reply_feedback',input)),
    replyExamples:async input=>outputs.reply_examples.parse(await answer('reply_examples',input)),
    exercise:async input=>outputs.exercise.parse(await answer('exercise',input)),
    exerciseFeedback:async input=>outputs.exercise_feedback.parse(await answer('exercise_feedback',input)),
    roleplayStart:async input=>outputs.roleplay_start.parse(await answer('roleplay_start',input)),
    roleplayTurn:async input=>input.turnCount===3?outputs.roleplay_feedback.parse(await answer('roleplay_feedback',input)):outputs.roleplay_turn.parse(await answer('roleplay_turn',input)),
    roleplayFinish:async input=>outputs.roleplay_feedback.parse(await answer('roleplay_feedback',input))
  };
  let app=await createApp({pool,provider,auth:{verify:async token=>token}});
  const call=async(method:'GET'|'POST'|'PATCH'|'DELETE',path:string,payload?:InjectOptions['payload'],owner=owners[0],key?:string)=>{
    const response=await app.inject({method,url:path,headers:{authorization:`Bearer ${owner}`,...(key?{'idempotency-key':key}:{})},payload});
    if(response.statusCode>=400)ApiError.parse(response.json());return response;
  };
  const post=async(path:string,body:Record<string,unknown>={},key=randomUUID(),owner=owners[0])=>{
    const response=await call('POST',path,{expectedRevision:1,...body},owner,key);
    assert.equal(response.statusCode,202,`AI operation ${path} expected 202`);return RunAccepted.parse(response.json());
  };
  const wait=async(id:string,status:'succeeded'|'failed'='succeeded',owner=owners[0])=>{
    for(let i=0;i<300;i++){
      const response=await call('GET',`/api/runs/${id}`,undefined,owner);assert.equal(response.statusCode,200);
      const run=Run.parse(response.json());if(run.status!=='pending'){assert.equal(run.status,status);return run;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }throw new Error('Run did not settle');
  };
  const session=async(owner=owners[0])=>{
    const response=await call('POST','/api/sessions',situations[0],owner);assert.equal(response.statusCode,201);return api.createSession.response.parse(response.json());
  };
  const analyze=async(id:string,owner=owners[0])=>wait((await post(`/api/sessions/${id}/analyze`,{},randomUUID(),owner)).runId,'succeeded',owner);
  const detail=async(id:string)=>SessionDetail.parse((await call('GET',`/api/sessions/${id}`)).json());
  const progress=async()=>Progress.parse((await call('GET','/api/progress')).json());
  return {pool,app,owners,calls,fail,invalid,call,post,wait,session,analyze,detail,progress,
    restart:async()=>{await app.close();pool=new Pool({connectionString:database});app=await createApp({pool,provider,auth:{verify:async token=>token}});await app.ready();},
    defer:(kind:Kind)=>{defer=kind;},release:()=>{release?.(outputFixtures[defer!]);defer=undefined;},
    close:async()=>{
      release?.(outputFixtures[defer??'analysis']);
      await app.close();
      const cleanup=new Pool({connectionString:database});
      try{await cleanup.query('DELETE FROM app.sessions WHERE user_id=ANY($1::uuid[])',[owners]);await cleanup.query('DELETE FROM app.profiles WHERE id=ANY($1::uuid[])',[owners]);}
      finally{await cleanup.end();await unlock();}
    }
  };
}

test('learning HTTP flow: replies, exercise, three turns, early finish, persistence and progress',options,async()=>{
  const h=await harness();
  try {
    assert.equal((await h.progress()).analyzedSessions,0);
    const session=await h.session(),base=`/api/sessions/${session.id}`;
    assert.equal((await h.call('POST',`${base}/exercise`,{expectedRevision:1},h.owners[0],randomUUID())).statusCode,409);
    await h.analyze(session.id);
    assert.equal((await h.call('GET','/api/me')).json().capabilities.roleplay,true);
    assert.equal((await h.call('POST',`${base}/reply-feedback`,{expectedRevision:1,draft:'Во сколько?',analysis:{}},h.owners[0],randomUUID())).statusCode,400);
    const reply=await h.wait((await h.post(`${base}/reply-feedback`,{draft:'Во сколько?'})).runId);
    assert.equal(reply.kind,'reply_feedback');
    const examples=await h.wait((await h.post(`${base}/reply-examples`)).runId);
    assert.equal(examples.kind,'reply_examples');if(examples.status==='succeeded'&&examples.kind==='reply_examples')assert.equal(new Set(examples.output.map(x=>x.goal)).size,4);
    assert.equal((await h.detail(session.id)).situation.goal,'clarify');
    const exercise=await h.wait((await h.post(`${base}/exercise`)).runId);
    const other=await h.session();
    assert.equal((await h.call('POST',`/api/sessions/${other.id}/exercise-feedback`,{expectedRevision:1,exerciseRunId:exercise.id,answer:'Когда?'},h.owners[0],randomUUID())).statusCode,404);
    assert.equal((await h.call('POST',`${base}/exercise-feedback`,{expectedRevision:1,exerciseRunId:reply.id,answer:'Когда?'},h.owners[0],randomUUID())).statusCode,400);
    const feedbackBody={exerciseRunId:exercise.id,answer:'Когда тебе удобно?'},feedbackKey=randomUUID();
    const feedback=await h.post(`${base}/exercise-feedback`,feedbackBody,feedbackKey);await h.wait(feedback.runId);
    assert.equal((await h.post(`${base}/exercise-feedback`,feedbackBody,feedbackKey)).runId,feedback.runId);
    await h.wait((await h.post(`${base}/exercise-feedback`,feedbackBody)).runId);
    assert.equal((await h.progress()).completedExercises,1);
    const role=await h.post(`${base}/roleplays`);assert.ok(role.resourceId);await h.wait(role.runId);
    const rolePath=`/api/roleplays/${role.resourceId}`;
    assert.equal((await h.call('POST',`${rolePath}/finish`,{expectedRevision:1},h.owners[0],randomUUID())).statusCode,409);
    assert.equal((await h.call('POST',`${rolePath}/turns`,{expectedRevision:1,content:'Когда?',messages:[]},h.owners[0],randomUUID())).statusCode,400);
    const turnKey=randomUUID();
    const duplicates=await Promise.all([h.post(`${rolePath}/turns`,{content:'Во сколько?'},turnKey),h.post(`${rolePath}/turns`,{content:'Во сколько?'},turnKey)]);
    assert.equal(duplicates[0].runId,duplicates[1].runId);await h.wait(duplicates[0].runId);
    await h.wait((await h.post(`${rolePath}/turns`,{content:'В семь мне подходит.'})).runId);
    const thirdKey=randomUUID(),third=await h.post(`${rolePath}/turns`,{content:'Договорились, до завтра.'},thirdKey);
    const finished=await h.wait(third.runId);assert.ok(finished.status==='succeeded'&&finished.kind==='roleplay_turn'&&finished.output.kind==='feedback');
    const saved=(await h.detail(session.id)).roleplays.find(x=>x.id===role.resourceId)!;
    assert.equal(saved.status,'completed');assert.equal(saved.turnCount,3);assert.equal(saved.messages.filter(x=>x.role==='user').length,3);assert.equal(saved.messages.length,6);assert.ok(saved.feedback);
    assert.equal((await h.post(`${rolePath}/turns`,{content:'Договорились, до завтра.'},thirdKey)).runId,third.runId);
    assert.equal((await h.call('POST',`${rolePath}/turns`,{expectedRevision:1,content:'Четвёртый'},h.owners[0],randomUUID())).statusCode,409);
    const early=await h.post(`${base}/roleplays`);await h.wait(early.runId);
    await h.wait((await h.post(`/api/roleplays/${early.resourceId}/turns`,{content:'Хорошо, во сколько?'})).runId);
    await h.wait((await h.post(`/api/roleplays/${early.resourceId}/finish`)).runId);
    const stats=await h.progress();assert.equal(stats.analyzedSessions,1);assert.equal(stats.completedExercises,1);assert.equal(stats.completedRoleplays,2);assert.equal(stats.latestTip,outputFixtures.roleplay_feedback.nextPractice);
    const fresh=new Pool({connectionString:database});
    try{assert.equal((await new Storage(fresh).detail(h.owners[0],session.id)).roleplays.filter(x=>x.status==='completed').length,2);}finally{await fresh.end();}
    assert.equal((await h.call('GET','/api/progress',undefined,h.owners[1])).json().completedRoleplays,0);
    assert.equal((await h.call('DELETE',base)).statusCode,204);
    const cleared=await h.progress();assert.equal(cleared.analyzedSessions+cleared.completedExercises+cleared.completedRoleplays,0);assert.equal(cleared.latestTip,null);
  }finally{await h.close();}
});

test('roleplay retries preserve the saved turn, finish and start; stale retry and races are rejected',options,async()=>{
  const h=await harness();
  try {
    const session=await h.session(),base=`/api/sessions/${session.id}`;await h.analyze(session.id);
    h.fail.add('roleplay_start');const start=await h.post(`${base}/roleplays`);await h.wait(start.runId,'failed');
    const retryStart=await h.post(`/api/runs/${start.runId}/retry`);await h.wait(retryStart.runId);
    assert.equal(retryStart.resourceId,start.resourceId);
    const path=`/api/roleplays/${start.resourceId}`;
    h.fail.add('roleplay_turn');const turn=await h.post(`${path}/turns`,{content:'Во сколько?'});await h.wait(turn.runId,'failed');
    assert.equal((await h.detail(session.id)).roleplays[0].messages.filter(x=>x.role==='user').length,1);
    assert.equal((await h.call('POST',`${path}/turns`,{expectedRevision:1,content:'Новая реплика'},h.owners[0],randomUUID())).statusCode,409);
    const key=randomUUID(),retry=await h.post(`/api/runs/${turn.runId}/retry`,{},key);await h.wait(retry.runId);
    assert.equal((await h.post(`/api/runs/${turn.runId}/retry`,{},key)).runId,retry.runId);
    assert.equal((await h.detail(session.id)).roleplays[0].turnCount,1);
    assert.equal((await h.detail(session.id)).roleplays[0].messages.filter(x=>x.role==='user').length,1);
    assert.equal((await h.call('POST',`/api/runs/${turn.runId}/retry`,{expectedRevision:1},h.owners[0],randomUUID())).statusCode,409);
    assert.equal((await h.call('POST',`/api/runs/${turn.runId}/retry`,{expectedRevision:1},h.owners[1],randomUUID())).statusCode,404);
    h.defer('roleplay_turn');const pending=await h.post(`${path}/turns`,{content:'Спасибо, договорились.'});
    assert.equal((await h.call('POST',`${path}/finish`,{expectedRevision:1},h.owners[0],randomUUID())).statusCode,409);
    assert.equal((await h.call('POST',`${path}/turns`,{expectedRevision:1,content:'Дубль'},h.owners[0],randomUUID())).statusCode,409);
    h.release();await h.wait(pending.runId);
    h.fail.add('roleplay_feedback');const finish=await h.post(`${path}/finish`);await h.wait(finish.runId,'failed');
    const retriedFinish=await h.post(`/api/runs/${finish.runId}/retry`);await h.wait(retriedFinish.runId);
    const role=(await h.detail(session.id)).roleplays[0];assert.equal(role.status,'completed');assert.equal(role.turnCount,2);assert.equal(role.messages.filter(x=>x.role==='user').length,2);
    assert.equal((await h.progress()).completedRoleplays,1);
  }finally{await h.close();}
});

test('learning references are owner/revision scoped and cancelled work cannot restore deleted progress',options,async()=>{
  const h=await harness();
  try {
    const session=await h.session(),base=`/api/sessions/${session.id}`;await h.analyze(session.id);
    const exercise=await h.post(`${base}/exercise`);await h.wait(exercise.runId);
    const foreign=await h.session(h.owners[1]);await h.analyze(foreign.id,h.owners[1]);
    assert.equal((await h.call('POST',`/api/sessions/${foreign.id}/exercise-feedback`,{expectedRevision:1,exerciseRunId:exercise.runId,answer:'Попытка'},h.owners[1],randomUUID())).statusCode,404);
    const role=await h.post(`${base}/roleplays`);await h.wait(role.runId);
    assert.equal((await h.call('POST',`/api/roleplays/${role.resourceId}/turns`,{expectedRevision:1,content:'Попытка'},h.owners[1],randomUUID())).statusCode,404);
    await h.call('PATCH',base,{...situations[0],title:'Новая версия',expectedRevision:1});
    assert.equal((await h.call('POST',`/api/roleplays/${role.resourceId}/turns`,{expectedRevision:2,content:'Попытка'},h.owners[0],randomUUID())).statusCode,409);
    assert.equal((await h.call('POST',`${base}/exercise-feedback`,{expectedRevision:2,exerciseRunId:exercise.runId,answer:'Попытка'},h.owners[0],randomUUID())).statusCode,409);
    const fresh=await h.session();await h.analyze(fresh.id);h.defer('exercise');
    await h.post(`/api/sessions/${fresh.id}/exercise`);
    assert.equal((await h.call('DELETE','/api/me/data',{confirmation:'DELETE_MY_LEARNING_DATA'})).statusCode,204);
    h.release();await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal((await h.call('GET','/api/sessions')).json().items.length,0);
    const stats=await h.progress();assert.equal(stats.analyzedSessions+stats.completedExercises+stats.completedRoleplays,0);
    assert.equal((await h.call('GET','/api/progress',undefined,h.owners[1])).json().analyzedSessions,1);
  }finally{await h.close();}
});

test('failed third turn survives restart and retry produces one final result without a fourth user turn',options,async()=>{
  const h=await harness();
  try {
    const session=await h.session();await h.analyze(session.id);
    const start=await h.post(`/api/sessions/${session.id}/roleplays`);await h.wait(start.runId);
    const path=`/api/roleplays/${start.resourceId}`;
    await h.wait((await h.post(`${path}/turns`,{content:'Уточню время.'})).runId);
    await h.wait((await h.post(`${path}/turns`,{content:'Мне подходит.'})).runId);
    h.fail.add('roleplay_feedback');const third=await h.post(`${path}/turns`,{content:'Спасибо, договорились.'});await h.wait(third.runId,'failed');
    const calls=h.calls.length;
    await h.restart();assert.equal(h.calls.length,calls);
    const before=(await h.detail(session.id)).roleplays[0];assert.equal(before.status,'active');assert.equal(before.turnCount,3);assert.equal(before.messages.filter(x=>x.role==='user').length,3);
    assert.equal((await h.call('POST',`${path}/turns`,{expectedRevision:1,content:'Лишний ход'},h.owners[0],randomUUID())).statusCode,409);
    const key=randomUUID(),retry=await h.post(`/api/runs/${third.runId}/retry`,{},key);await h.wait(retry.runId);
    assert.equal((await h.post(`/api/runs/${third.runId}/retry`,{},key)).runId,retry.runId);
    const final=(await h.detail(session.id)).roleplays[0];assert.equal(final.status,'completed');assert.equal(final.messages.filter(x=>x.role==='user').length,3);
    assert.equal(final.messages.length,6);assert.equal((await h.progress()).completedRoleplays,1);
  }finally{await h.close();}
});

test('early finish can summarize a saved first answer after failed generation without replaying that turn',options,async()=>{
  const h=await harness();
  try {
    const session=await h.session();await h.analyze(session.id);
    const start=await h.post(`/api/sessions/${session.id}/roleplays`);await h.wait(start.runId);
    const path=`/api/roleplays/${start.resourceId}`;
    h.fail.add('roleplay_turn');const failed=await h.post(`${path}/turns`,{content:'Я хочу закончить после этого ответа.'});await h.wait(failed.runId,'failed');
    await h.wait((await h.post(`${path}/finish`)).runId);
    const role=(await h.detail(session.id)).roleplays[0];assert.equal(role.turnCount,1);assert.equal(role.status,'completed');assert.equal(role.messages.filter(x=>x.role==='user').length,1);
    assert.equal((await h.call('POST',`/api/runs/${failed.runId}/retry`,{expectedRevision:1},h.owners[0],randomUUID())).statusCode,409);
  }finally{await h.close();}
});

test('interrupted roleplay turn is not replayed at startup and can retry its persisted snapshot',options,async()=>{
  const h=await harness();
  try {
    const session=await h.session();await h.analyze(session.id);
    const start=await h.post(`/api/sessions/${session.id}/roleplays`);await h.wait(start.runId);
    h.defer('roleplay_turn');const turn=await h.post(`/api/roleplays/${start.resourceId}/turns`,{content:'Сохранённый ответ.'});
    const calls=h.calls.length;await h.restart();assert.equal(h.calls.length,calls);
    assert.equal((await h.wait(turn.runId,'failed')).errorCode,'RUN_INTERRUPTED');
    h.release();await new Promise(resolve=>setImmediate(resolve));
    const retry=await h.post(`/api/runs/${turn.runId}/retry`);await h.wait(retry.runId);
    const role=(await h.detail(session.id)).roleplays[0];assert.equal(role.turnCount,1);assert.equal(role.messages.filter(x=>x.role==='user').length,1);
    assert.equal(role.messages.length,3);
  }finally{await h.close();}
});

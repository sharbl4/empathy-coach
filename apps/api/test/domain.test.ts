import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {Pool} from 'pg';
import {SessionInput,type UserContext,type DomainOptions,type DomainFacade} from '@between/contracts/domain';
import {Analysis} from '@between/contracts';
import {situations,outputFixtures} from '@between/contracts/fixtures';
import {createDomainForTest,createDomain} from '../src/domain/facade.js';
import {digest} from '../src/domain/core.js';
import {maskAll,maskText} from '../src/domain/privacy.js';
import {migrate} from '../src/db/migrate.js';
import {databaseSuiteLock} from './database.js';
import type {AiProvider} from '../src/ai/provider.js';

function databaseUrl(){
  const url=process.env.TEST_DATABASE_URL;if(process.env.NODE_ENV!=='test'||!url||!/test/i.test(new URL(url).pathname)||url===process.env.DATABASE_URL)throw new Error('Dedicated TEST_DATABASE_URL and NODE_ENV=test are required');return url;
}
async function harness(provider?:AiProvider){
  const url=databaseUrl(),unlock=await databaseSuiteLock(url),db=new Pool({connectionString:url});await migrate(db);
  let clock=Date.now(),mailFails=false,modelCalls=0,nextUpdate=100;
  const mail:Array<{email:string;code:string}>=[],accounts:string[]=[];
  const options:DomainOptions={databaseUrl:url,botId:String(randomInt(10000000,90000000)),emailCodeSecret:'ab'.repeat(32),ai:{provider:'local',baseUrl:'http://127.0.0.1:18080/v1',model:'test-local',timeoutMs:2000,maxConcurrency:1},smtp:{host:'smtp.example.invalid',port:587,from:'sender@example.invalid'}};
  const dependencies={now:()=>clock,mail:{sendCode:async(email:string,code:string)=>{if(mailFails)throw new Error('Synthetic SMTP failure');mail.push({email,code});}},provider:provider??{analyze:async()=>{modelCalls++;return Analysis.parse(outputFixtures.analysis);}}};
  let domain=await createDomainForTest(options,dependencies);
  const resolve=async(telegram=String(randomInt(10000000,90000000)),update=String(nextUpdate++))=>{
    const identity={telegramUserId:telegram,privateChatId:telegram,updateId:update};const ctx=await domain.resolveUser(identity);accounts.push(ctx.accountId);return {ctx,identity};
  };
  const verified=async(telegram?:string,email='person@example.invalid')=>{
    const {ctx,identity}=await resolve(telegram);await domain.acceptConsent(ctx,{policyVersion:'telegram-1',accepted:true},randomUUID());
    const challenge=await domain.requestEmailCode(ctx,{email},randomUUID());await domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code:mail.at(-1)!.code},randomUUID());return {ctx,identity};
  };
  return {get domain(){return domain;},db,options,mail,resolve,verified,
    calls:()=>modelCalls,advance:(ms:number)=>{clock+=ms;},mailFails:(value:boolean)=>{mailFails=value;},
    restart:async()=>{await domain.close();domain=await createDomainForTest(options,dependencies);},
    confirmAnalysisForTest:async(ctx:UserContext,session:Awaited<ReturnType<DomainFacade['createSession']>>)=>{
      const context=SessionInput.parse({title:session.title,situation:session.situation,guess:session.guess});
      await db.query(`INSERT INTO app.ai_confirmations(user_id,session_id,revision,kind,context_hmac,expires_at) VALUES($1,$2,$3,'analysis',$4,$5) ON CONFLICT(user_id,session_id,revision,kind) DO UPDATE SET context_hmac=EXCLUDED.context_hmac,expires_at=EXCLUDED.expires_at`,[ctx.accountId,session.id,session.revision,digest(options.emailCodeSecret,'confirmed-task',{kind:'analysis',context}),new Date(clock+600000)]);
    },
    wait:async(ctx:UserContext,id:string)=>{
      for(let i=0;i<300;i++){const run=await domain.run(ctx,id);if(run.status!=='pending')return run;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Run did not settle');
    },
    close:async()=>{
      await domain.close();await db.query('DELETE FROM app.sessions WHERE user_id=ANY($1::uuid[])',[accounts]);await db.query('DELETE FROM app.profiles WHERE id=ANY($1::uuid[])',[accounts]);await db.query('DELETE FROM app.telegram_inbox WHERE bot_id=$1',[options.botId]);await db.query('DELETE FROM app.telegram_cursors WHERE bot_id=$1',[options.botId]);await db.end();await unlock();
    }
  };
}

test('domain accounts, issued contexts, consent/email gates and transactional mutation idempotency',async()=>{
  const h=await harness();
  try{
    const first=await h.resolve(),again=await h.resolve(first.identity.telegramUserId);assert.equal(first.ctx.accountId,again.ctx.accountId);
    assert.ok(Object.isFrozen(first.ctx));
    await assert.rejects(h.domain.account({...first.ctx} as UserContext),{code:'UNAUTHORIZED'});
    await assert.rejects(h.domain.resolveUser({...first.identity,privateChatId:'999'}),{code:'VALIDATION_ERROR'});
    await assert.rejects(h.domain.sessions(first.ctx,{limit:10}),{code:'CONSENT_REQUIRED'});
    await h.domain.acceptConsent(first.ctx,{policyVersion:'telegram-1',accepted:true},randomUUID());
    await assert.rejects(h.domain.sessions(first.ctx,{limit:10}),{code:'EMAIL_NOT_VERIFIED'});
    const requestKey=randomUUID(),challenge=await h.domain.requestEmailCode(first.ctx,{email:'person@example.invalid'},requestKey);
    assert.equal((await h.domain.requestEmailCode(first.ctx,{email:'person@example.invalid'},requestKey)).challengeId,challenge.challengeId);assert.equal(h.mail.length,1);
    const code=h.mail[0].code;
    const stored=(await h.db.query('SELECT * FROM app.email_challenges WHERE id=$1',[challenge.challengeId])).rows[0];assert.ok(stored.code_hmac!==code&&stored.code_hmac.length===64);assert.equal(stored.attempts,0);
    const verified=await h.domain.verifyEmailCode(first.ctx,{challengeId:challenge.challengeId,code},randomUUID());assert.equal(verified.emailVerified,true);
    const other=await h.verified(undefined,'person@example.invalid');assert.notEqual(other.ctx.accountId,first.ctx.accountId);
    const input=situations[0],key=randomUUID();
    const duplicates=await Promise.all([h.domain.createSession(first.ctx,input,key),h.domain.createSession(first.ctx,input,key)]);assert.equal(duplicates[0].id,duplicates[1].id);
    await assert.rejects(h.domain.createSession(first.ctx,{...input,title:'Different'},key),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(h.domain.session(other.ctx,duplicates[0].id),{code:'NOT_FOUND'});
    const updates=await Promise.allSettled([1,2].map(i=>h.domain.updateSession(first.ctx,duplicates[0].id,{...input,title:`Change ${i}`,expectedRevision:1},randomUUID())));assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await h.domain.session(first.ctx,duplicates[0].id)).revision,2);
    await h.domain.revokeConsent(first.ctx,randomUUID());await assert.rejects(h.domain.session(first.ctx,duplicates[0].id),{code:'CONSENT_REQUIRED'});
    await h.domain.deleteData(first.ctx,{confirmation:'DELETE_MY_LEARNING_DATA'},randomUUID());assert.equal((await h.domain.account(first.ctx)).id,first.ctx.accountId);
    await h.domain.acceptConsent(first.ctx,{policyVersion:'telegram-1',accepted:true},randomUUID());
    await assert.rejects(h.domain.createSession(first.ctx,input,key),{code:'NOT_FOUND'});
    assert.equal((await h.domain.sessions(first.ctx,{limit:10})).items.length,0);
    await h.domain.claimUpdate(first.ctx,first.identity.updateId);
    await h.domain.deleteAccount(first.ctx,{confirmation:'DELETE_MY_ACCOUNT'},randomUUID());await assert.rejects(h.domain.account(first.ctx),{code:'UNAUTHORIZED'});
    await assert.rejects(h.domain.resolveUser(first.identity),{code:'NOT_FOUND'});
    assert.equal((await h.domain.account(other.ctx)).id,other.ctx.accountId);
  }finally{await h.close();}
});

test('email expiry, five attempts, reissue, concurrent redemption and honest SMTP failure',async()=>{
  const h=await harness();
  try{
    const {ctx}=await h.resolve();await h.domain.acceptConsent(ctx,{policyVersion:'telegram-1',accepted:true},randomUUID());
    let challenge=await h.domain.requestEmailCode(ctx,{email:'first@example.invalid'},randomUUID());let code=h.mail.at(-1)!.code;
    const wrong=code==='000000'?'000001':'000000',wrongKey=randomUUID();
    await assert.rejects(h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code:wrong},wrongKey),{code:'CODE_INVALID'});
    await assert.rejects(h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code:wrong},wrongKey),{code:'CODE_INVALID'});
    assert.equal((await h.db.query('SELECT attempts FROM app.email_challenges WHERE id=$1',[challenge.challengeId])).rows[0].attempts,1);
    for(let i=0;i<4;i++)await assert.rejects(h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code:wrong},randomUUID()),{code:'CODE_INVALID'});
    await assert.rejects(h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code},randomUUID()),{code:'CODE_INVALID'});
    await assert.rejects(h.domain.requestEmailCode(ctx,{email:'next@example.invalid'},randomUUID()),{code:'RATE_LIMITED'});
    h.advance(61000);challenge=await h.domain.requestEmailCode(ctx,{email:'next@example.invalid'},randomUUID());code=h.mail.at(-1)!.code;
    h.advance(600001);await assert.rejects(h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code},randomUUID()),{code:'CODE_EXPIRED'});
    challenge=await h.domain.requestEmailCode(ctx,{email:'next@example.invalid'},randomUUID());code=h.mail.at(-1)!.code;
    const race=await Promise.allSettled([h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code},randomUUID()),h.domain.verifyEmailCode(ctx,{challengeId:challenge.challengeId,code},randomUUID())]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
    h.advance(61000);h.mailFails(true);const failKey=randomUUID(),sent=h.mail.length;
    await assert.rejects(h.domain.requestEmailCode(ctx,{email:'changed@example.invalid'},failKey),{code:'DEPENDENCY_UNAVAILABLE'});
    await assert.rejects(h.domain.requestEmailCode(ctx,{email:'changed@example.invalid'},failKey),{code:'DEPENDENCY_UNAVAILABLE'});assert.equal(h.mail.length,sent);
    assert.equal((await h.domain.account(ctx)).emailVerified,true);
    const failed=(await h.db.query("SELECT code_hmac FROM app.email_challenges WHERE user_id=$1 AND state='failed'",[ctx.accountId])).rows[0];assert.equal(failed.code_hmac,'');
  }finally{await h.close();}
});

test('durable inbox, FSM revision/TTL and poller ownership survive restart',async()=>{
  const h=await harness();
  try{
    const first=await h.verified();const ctx=await h.domain.resolveUser({...first.identity,updateId:'10'});first.ctx=ctx;const receipt=await h.domain.claimUpdate(first.ctx,'10');
    assert.equal((await h.domain.claimUpdate(first.ctx,'10')).intentKey,receipt.intentKey);
    const nextCtx=(await h.resolve(first.identity.telegramUserId,'11')).ctx;
    await assert.rejects(h.domain.claimUpdate(nextCtx,'11'),{code:'OPERATION_IN_PROGRESS'});
    await h.domain.acknowledgeUpdate('40');assert.equal((await h.domain.updateCursor()).nextOffset,'10');
    const state=await h.domain.dialogue(first.ctx);
    const update={expectedRevision:state.revision,stage:'message' as const,draft:{message:'Тестовый черновик'},sessionId:null,roleplayId:null};
    const key=randomUUID(),saved=await h.domain.updateDialogue(first.ctx,update,key);assert.equal((await h.domain.updateDialogue(first.ctx,update,key)).revision,saved.revision);
    await assert.rejects(h.domain.updateDialogue(first.ctx,update,randomUUID()),{code:'REVISION_CONFLICT'});
    await assert.rejects(createDomainForTest(h.options,{mail:{sendCode:async()=>{}},provider:{analyze:async()=>Analysis.parse(outputFixtures.analysis)}}),{code:'OPERATION_IN_PROGRESS'});
    assert.equal((await h.domain.health()).pollerLease,true);
    const old=first.ctx;await h.restart();assert.equal((await h.domain.updateCursor()).nextOffset,'10');await assert.rejects(h.domain.account(old),{code:'UNAUTHORIZED'});
    const again=await h.resolve(first.identity.telegramUserId,'10');assert.equal((await h.domain.claimUpdate(again.ctx,'10')).intentKey,receipt.intentKey);assert.equal((await h.domain.dialogue(again.ctx)).draft.message,'Тестовый черновик');
    await h.domain.acknowledgeUpdate('10');assert.equal((await h.domain.updateCursor()).nextOffset,'11');
    const later=(await h.resolve(first.identity.telegramUserId,'11')).ctx;await h.domain.claimUpdate(later,'11');await h.domain.acknowledgeUpdate('11');assert.equal((await h.domain.updateCursor()).nextOffset,'41');
    h.advance(3600001);assert.equal(Object.keys((await h.domain.dialogue(again.ctx)).draft).length,0);
  }finally{await h.close();}
});

test('privacy is deterministic across fields and model stays closed until an exact confirmed snapshot exists',async()=>{
  const h=await harness();
  try{
    const {ctx}=await h.verified();
    const raw={...situations[0],situation:{...situations[0].situation,message:'Пиши person@example.org, звони +7 (999) 123-45-67',relationship:'person@example.org',context:'Контакт +7 (999) 123-45-67'},guess:{emotions:[],evidenceQuotes:[],unsure:true}};
    const session=await h.domain.createSession(ctx,raw,randomUUID());
    assert.ok(!JSON.stringify(session).includes('person@example.org'));assert.ok(!JSON.stringify(session).includes('999'));assert.equal(maskText(maskText(raw.situation.message)),maskText(raw.situation.message));assert.ok(!JSON.stringify(maskAll({draft:raw.situation.message})).includes('999'));
    await assert.rejects(h.domain.analyze(ctx,session.id,{expectedRevision:1},randomUUID()),{code:'OPERATION_IN_PROGRESS'});assert.equal(h.calls(),0);
    const clean=await h.domain.createSession(ctx,situations[0],randomUUID());await h.confirmAnalysisForTest(ctx,clean);
    const accepted=await h.domain.analyze(ctx,clean.id,{expectedRevision:1},randomUUID()),run=await h.wait(ctx,accepted.runId);assert.equal(run.status,'succeeded');assert.equal(h.calls(),1);
    const deliveries=await h.domain.claimDeliveries(10);assert.equal(deliveries.length,1);assert.equal(deliveries[0].context.accountId,ctx.accountId);assert.equal(deliveries[0].run.id,run.id);
    await h.domain.failDelivery(deliveries[0].context,deliveries[0].id,{code:'DELIVERY_FAILED'});await h.domain.failDelivery(deliveries[0].context,deliveries[0].id,{code:'DELIVERY_FAILED'});
    assert.equal((await h.db.query('SELECT ordinary_failures FROM app.run_deliveries WHERE id=$1',[deliveries[0].id])).rows[0].ordinary_failures,1);
    h.advance(3000);const retryDelivery=await h.domain.claimDeliveries(10);assert.equal(retryDelivery.length,1);await h.domain.completeDelivery(retryDelivery[0].context,retryDelivery[0].id);assert.equal(h.calls(),1);
    await h.domain.updateSession(ctx,clean.id,{...situations[0],title:'Changed',expectedRevision:1},randomUUID());
    await assert.rejects(h.domain.analyze(ctx,clean.id,{expectedRevision:2},randomUUID()),{code:'OPERATION_IN_PROGRESS'});assert.equal(h.calls(),1);
  }finally{await h.close();}
});

test('production rejects test injection and library entry exposes only a factory',async()=>{
  const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(createDomainForTest({} as DomainOptions,{}),/rejected/);}finally{process.env.NODE_ENV=old;}
  assert.equal(typeof createDomain,'function');
});

test('one GPU execution, bounded queue, deletion cancellation and restart do not duplicate generation',async()=>{
  let running=0,peak=0,calls=0,obeyAbort=false;
  const releases:Array<()=>void>=[];
  const h=await harness({analyze:async(_input,signal)=>new Promise((resolve,reject)=>{
    running++;calls++;peak=Math.max(peak,running);let settled=false;
    const finish=()=>{if(settled)return;settled=true;running--;resolve(Analysis.parse(outputFixtures.analysis));};releases.push(finish);
    if(obeyAbort)signal.addEventListener('abort',()=>{if(settled)return;settled=true;running--;reject(new Error('Synthetic cancellation'));},{once:true});
  })});
  const until=async(predicate:()=>boolean)=>{for(let i=0;i<300&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate());};
  try{
    const a=await h.verified(),b=await h.verified(),c=await h.verified();
    const sessions=[];for(const ctx of [a.ctx,b.ctx,c.ctx]){const session=await h.domain.createSession(ctx,situations[0],randomUUID());await h.confirmAnalysisForTest(ctx,session);sessions.push(session);}
    const first=await h.domain.analyze(a.ctx,sessions[0].id,{expectedRevision:1},randomUUID());await until(()=>calls===1);
    const second=await h.domain.analyze(b.ctx,sessions[1].id,{expectedRevision:1},randomUUID());
    const third=await h.domain.analyze(c.ctx,sessions[2].id,{expectedRevision:1},randomUUID());
    await h.domain.deleteData(a.ctx,{confirmation:'DELETE_MY_LEARNING_DATA'},randomUUID());
    const next=await h.domain.createSession(a.ctx,situations[0],randomUUID());await h.confirmAnalysisForTest(a.ctx,next);
    await assert.rejects(h.domain.analyze(a.ctx,next.id,{expectedRevision:1},randomUUID()),{code:'RATE_LIMITED'});
    await new Promise(resolve=>setTimeout(resolve,150));assert.equal(calls,1);assert.equal(peak,1);
    obeyAbort=true;releases[0]();await until(()=>calls===2);
    await assert.rejects(h.domain.run(a.ctx,first.runId),{code:'NOT_FOUND'});
    await h.restart();const newB=await h.resolve(b.identity.telegramUserId),newC=await h.resolve(c.identity.telegramUserId);
    assert.equal((await h.domain.run(newB.ctx,second.runId)).errorCode,'RUN_INTERRUPTED');
    await until(()=>calls===3);assert.equal(peak,1);releases[2]();assert.equal((await h.wait(newC.ctx,third.runId)).status,'succeeded');assert.equal(calls,3);
    const delivery=await h.domain.claimDeliveries(10);assert.equal(delivery.length,2);
    for(const item of delivery)await h.domain.completeDelivery(item.context,item.id);
    await h.restart();assert.equal((await h.domain.claimDeliveries(10)).length,0);assert.equal(calls,3);
  }finally{for(const release of releases)release();await h.close();}
});

test('queue admission has an enforced waiting cap instead of an unbounded in-memory backlog',async()=>{
  const old=process.env.AI_QUEUE_LIMIT;process.env.AI_QUEUE_LIMIT='2';
  let calls=0;const releases:Array<()=>void>=[];
  const h=await harness({analyze:async()=>new Promise(resolve=>{calls++;releases.push(()=>resolve(Analysis.parse(outputFixtures.analysis)));})});
  try{
    for(let i=0;i<4;i++){
      const {ctx}=await h.verified(undefined,`person-${i}@example.invalid`),session=await h.domain.createSession(ctx,situations[0],randomUUID());await h.confirmAnalysisForTest(ctx,session);
      if(i===3)await assert.rejects(h.domain.analyze(ctx,session.id,{expectedRevision:1},randomUUID()),{code:'RATE_LIMITED'});
      else {await h.domain.analyze(ctx,session.id,{expectedRevision:1},randomUUID());if(i===0)for(let n=0;n<100&&calls===0;n++)await new Promise(resolve=>setTimeout(resolve,10));}
    }
    assert.equal(calls,1);assert.equal((await h.db.query("SELECT count(*)::int AS count FROM app.run_jobs WHERE state='queued'")).rows[0].count,2);
  }finally{for(const release of releases)release();await h.close();if(old===undefined)delete process.env.AI_QUEUE_LIMIT;else process.env.AI_QUEUE_LIMIT=old;}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError} from '@between/contracts/product';
import {analysisFixture} from '@between/contracts/product-fixtures';
import {productHarness,syntheticInput,uid} from './product-harness.js';

const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;

for(const scope of ['session','account'] as const)test(`deletion during generation: ${scope} cannot receive late output, completion event or delivery`,async()=>{
  let release:()=>void=()=>{},entered:()=>void=()=>{},calls=0;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const h=await productHarness({generate:async snapshot=>{
    calls++;if(calls===1){entered();await gate;}
    const field=snapshot.fields.find(f=>f.label==='session.message')!;
    return {...analysisFixture,interpretations:analysisFixture.interpretations.map((v,i)=>({...v,evidence:i?[]:[{fieldId:field.id,quote:field.value}]}))};
  }});
  try{
    await h.start();const a=await h.verified(),b=await h.verified(),s=await h.domain.createSession(a.ctx,syntheticInput,uid());
    const first=await h.launch(a.ctx,{kind:'analysis',sessionId:s.id,expectedRevision:s.revision});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([started,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Synthetic generation did not start')),3000);})]);}finally{clearTimeout(timer);}
    const other=await h.domain.createSession(b.ctx,syntheticInput,uid()),queued=await h.launch(b.ctx,{kind:'analysis',sessionId:other.id,expectedRevision:other.revision});
    if(scope==='session')await h.domain.deleteSession(a.ctx,{id:s.id,expectedRevision:s.revision},uid());
    else await h.domain.deleteAccount(a.ctx,{confirmation:'DELETE_MY_ACCOUNT'},uid());
    await assert.rejects(h.domain.run(a.ctx,{id:first.runId}),code(scope==='session'?'NOT_FOUND':'UNAUTHORIZED'));
    assert.equal(calls,1,'deletion does not admit a second physical generation before the first settles');
    release();assert.equal((await h.wait(b.ctx,queued.runId)).status,'succeeded');assert.equal(calls,2);
    for(const [table,column] of [['product_runs','id'],['product_deliveries','run_id'],['product_events','resource_id']] as const){
      assert.equal((await h.db.query(`SELECT count(*)::int AS n FROM app.${table} WHERE ${column}=$1`,[first.runId])).rows[0].n,0);
    }
    assert.equal((await h.domain.session(b.ctx,{id:other.id})).id,other.id);
    if(scope==='session')assert.equal((await h.domain.sessions(a.ctx,{limit:20})).items.length,0);
  }finally{release();await h.close();}
});

test('roleplay: every difficulty persists and early feedback completes only after a confirmed user turn',async()=>{
  const h=await productHarness();try{
    await h.start();const {ctx}=await h.verified(),s=await h.domain.createSession(ctx,syntheticInput,uid());
    const analysis=await h.launch(ctx,{kind:'analysis',sessionId:s.id,expectedRevision:s.revision});assert.equal((await h.wait(ctx,analysis.runId)).status,'succeeded');
    for(const difficulty of ['calm','hurt','irritated'] as const){
      const started=await h.launch(ctx,{kind:'roleplay_start',sessionId:s.id,expectedRevision:s.revision,difficulty});assert.equal((await h.wait(ctx,started.runId)).status,'succeeded');assert.ok(started.resourceId);
      let role=await h.domain.roleplay(ctx,{id:started.resourceId});assert.equal(role.difficulty,difficulty);
      await assert.rejects(h.domain.createPreview(ctx,{kind:'roleplay_feedback',roleplayId:role.id,expectedRevision:role.revision},uid()),code('VALIDATION_ERROR'));
      const turn=await h.launch(ctx,{kind:'roleplay_turn',roleplayId:role.id,expectedRevision:role.revision,content:'What time works for you?'});assert.equal((await h.wait(ctx,turn.runId)).status,'succeeded');role=await h.domain.roleplay(ctx,{id:role.id});
      const finish=await h.launch(ctx,{kind:'roleplay_feedback',roleplayId:role.id,expectedRevision:role.revision});assert.equal((await h.wait(ctx,finish.runId)).status,'succeeded');
      role=await h.domain.roleplay(ctx,{id:role.id});assert.equal(role.status,'completed');assert.equal(role.turnCount,1);assert.ok(role.feedback);
    }
  }finally{await h.close();}
});

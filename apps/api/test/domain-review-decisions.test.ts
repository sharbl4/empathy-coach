import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError} from '@between/contracts/product';
import {productHarness,syntheticInput,uid} from './product-harness.js';
const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;

test('2.2.1 menu and restart preserve partial assessment; only confirmed reset discards it',async()=>{
  const h=await productHarness();try{
    await h.start();const {ctx,identity}=await h.verified(),form=await h.domain.assessment(ctx,{kind:'baseline'}),d=await h.domain.dialogue(ctx,{});
    const navigation={kind:'assessment' as const,assessmentId:form.id,contentVersion:form.contentVersion,assessmentKind:form.kind,answers:[{questionId:form.tasks[0].id,choiceId:form.tasks[0].choices[0].id}]};
    const partial=await h.domain.updateDialogue(ctx,{expectedRevision:d.revision,step:'assessment',draft:{},navigation,sessionId:null,previewId:null,roleplayId:null},uid());
    const menu=await h.domain.updateDialogue(ctx,{expectedRevision:partial.revision,step:'menu',draft:{},navigation,sessionId:null,previewId:null,roleplayId:null},uid());
    await assert.rejects(h.domain.updateDialogue(ctx,{expectedRevision:menu.revision,step:'menu',draft:{},navigation:{kind:'none'},sessionId:null,previewId:null,roleplayId:null},uid()),code('REVISION_CONFLICT'));
    await h.restart();const restored=await h.domain.resolveUser(identity),saved=await h.domain.dialogue(restored,{});assert.equal(saved.step,'menu');assert.deepEqual(saved.navigation,navigation);
    await assert.rejects(h.domain.resetDialogue(restored,{expectedRevision:saved.revision},uid()),code('REVISION_CONFLICT'));
    assert.deepEqual((await h.domain.dialogue(restored,{})).navigation,navigation);
    const blank=await h.domain.resetDialogue(restored,{expectedRevision:saved.revision,confirmation:'DISCARD_UNFINISHED_ASSESSMENT'},uid());assert.equal(blank.navigation.kind,'none');
  }finally{await h.close();}
});

test('2.2.1 owned vote is read through every run projection after restart; completion is domain-only and unique',async()=>{
  const h=await productHarness();try{
    await h.start();const {ctx,identity}=await h.verified(),{ctx:other}=await h.verified(),s=await h.domain.createSession(ctx,syntheticInput,uid());
    const pending=await h.launch(ctx,{kind:'analysis',sessionId:s.id,expectedRevision:s.revision});assert.equal((await h.wait(ctx,pending.runId)).status,'succeeded');
    assert.equal((await h.domain.run(ctx,{id:pending.runId})).myRating,null);
    await h.domain.rateRun(ctx,{runId:pending.runId,value:'useful'},uid());await h.restart();const restored=await h.domain.resolveUser(identity);
    assert.equal((await h.domain.run(restored,{id:pending.runId})).myRating,'useful');assert.equal((await h.domain.runs(restored,{sessionId:s.id,limit:20})).items[0].myRating,'useful');assert.equal((await h.domain.session(restored,{id:s.id})).runs.items[0].myRating,'useful');
    await h.domain.rateRun(restored,{runId:pending.runId,value:'not_useful'},uid());assert.equal((await h.domain.run(restored,{id:pending.runId})).myRating,'not_useful');await assert.rejects(h.domain.run(other,{id:pending.runId}),code('UNAUTHORIZED'));
    await assert.rejects(h.domain.recordStage(restored,{name:'run_completed',resourceId:pending.runId} as never,uid()),code('VALIDATION_ERROR'));
    const events=await h.db.query("SELECT count(*)::int AS n FROM app.product_events WHERE user_id=$1 AND name='run_completed' AND resource_id=$2",[restored.accountId,pending.runId]);assert.equal(events.rows[0].n,1);
  }finally{await h.close();}
});

test('2.2.1 invalid model result persists failure and never records run_completed',async()=>{
  const h=await productHarness({generate:async()=>({})});try{await h.start();const {ctx}=await h.verified(),s=await h.domain.createSession(ctx,syntheticInput,uid()),pending=await h.launch(ctx,{kind:'analysis',sessionId:s.id,expectedRevision:s.revision}),run=await h.wait(ctx,pending.runId);assert.equal(run.status,'failed');assert.equal(run.errorCode,'MODEL_INVALID_OUTPUT');assert.equal((await h.db.query("SELECT count(*)::int AS n FROM app.product_events WHERE user_id=$1 AND name='run_completed' AND resource_id=$2",[ctx.accountId,pending.runId])).rows[0].n,0);}finally{await h.close();}
});

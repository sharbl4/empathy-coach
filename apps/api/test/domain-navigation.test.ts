import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError} from '@between/contracts/product';
import {productHarness,syntheticInput,uid} from './product-harness.js';
const code=(value:string)=>(error:unknown)=>error instanceof DomainError&&error.code===value;
test('2.2 canonical navigation survives restart; reads do not extend idle TTL and mutations cannot exceed 24h',async()=>{
  const h=await productHarness();try{await h.start();const user=await h.verified();let ctx=user.ctx;const saved=await h.domain.createSession(ctx,syntheticInput,uid());let d=await h.domain.dialogue(ctx,{});const created=Date.parse(d.createdAt),turnId=uid();
    const patch={step:'compose' as const,draft:{mode:'thread' as const,turns:[{id:turnId,speaker:'self' as const,text:'Synthetic unfinished text'}]},navigation:{kind:'thread_turn' as const,speaker:'other' as const,turnId:null},sessionId:null,previewId:null,roleplayId:null};d=await h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch},uid());const idle=d.expiresAt;
    h.advance(10000);assert.equal((await h.domain.dialogue(ctx,{})).expiresAt,idle);await h.restart();ctx=await h.domain.resolveUser(user.identity);const recovered=await h.domain.dialogue(ctx,{});assert.deepEqual(recovered.navigation,patch.navigation);assert.equal(recovered.draft.turns?.[0].id,turnId);
    for(let index=1;index<=26;index++){h.clock(created+index*55*60000);d=await h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch},uid());assert.ok(Date.parse(d.expiresAt)<=created+86400000);}
    h.clock(created+86400000);const expired=await h.domain.dialogue(ctx,{});assert.ok(expired.revision>d.revision);assert.deepEqual(expired.navigation,{kind:'none'});assert.deepEqual(expired.draft,{});assert.equal((await h.domain.session(ctx,{id:saved.id})).id,saved.id);
    const cache=(await h.db.query("SELECT count(*)::int n FROM app.domain_intents WHERE user_id=$1 AND operation='v2.updateDialogue' AND result IS NOT NULL",[ctx.accountId])).rows[0].n;assert.equal(cache,0);
    await assert.rejects(h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch},uid()),code('REVISION_CONFLICT'));
  }finally{await h.close();}
});
test('2.2 shown snapshot is authoritative across web and Telegram; fetching a new preview cannot approve it',async()=>{
  const h=await productHarness();try{await h.start();const {ctx}=await h.verified(),session=await h.domain.createSession(ctx,syntheticInput,uid()),p=await h.domain.createPreview(ctx,{kind:'analysis',sessionId:session.id,expectedRevision:1},uid());
    await assert.rejects(h.domain.confirmPreview(ctx,{id:p.id,expectedRevision:p.revision,snapshotHash:p.snapshotHash},uid()),code('PREVIEW_STALE'));await h.show(ctx,p);
    const link=await h.domain.issueWebLink(ctx,uid()),browser=await h.domain.openBrowser();await h.domain.authorizeWebMutation(browser.context,{origin:h.options.web.origin,csrfToken:browser.publicSession.csrfToken});const web=await h.domain.redeemWebLink(browser.context,{token:new URL(link.webUrl).hash.slice(7),confirmed:true},uid());assert.equal(web.context.transport,'web');assert.equal((await h.domain.dialogue(web.context,{})).navigation.kind,'preview');
    const message=p.fields.find(f=>f.label==='session.message')!,edited=await h.domain.editPreview(web.context,{id:p.id,expectedRevision:p.revision,edits:[{fieldId:message.id,value:'Next week?'}]},uid());const fetched=await h.domain.preview(ctx,{id:p.id});assert.equal(fetched.snapshotHash,edited.snapshotHash);
    await assert.rejects(h.domain.confirmPreview(ctx,{id:fetched.id,expectedRevision:fetched.revision,snapshotHash:fetched.snapshotHash},uid()),code('PREVIEW_STALE'));
    await h.show(web.context,edited);await h.domain.confirmPreview(web.context,{id:edited.id,expectedRevision:edited.revision,snapshotHash:edited.snapshotHash},uid());const accepted=await h.domain.startRun(web.context,{previewId:edited.id,previewRevision:edited.revision,snapshotHash:edited.snapshotHash,expectedSessionRevision:1},uid());assert.equal((await h.domain.dialogue(ctx,{})).pendingRunId,accepted.runId);assert.equal((await h.wait(ctx,accepted.runId)).status,'succeeded');
  }finally{await h.close();}
});
test('2.2 ordered partial assessment answers are durable and submit compares and clears the same dialogue atomically',async()=>{
  const h=await productHarness();try{await h.start();const user=await h.verified(),other=await h.verified();let ctx=user.ctx;const form=await h.domain.assessment(ctx,{kind:'baseline'});let d=await h.domain.dialogue(ctx,{});const navigation={kind:'assessment' as const,assessmentId:form.id,contentVersion:form.contentVersion,assessmentKind:form.kind,answers:[{questionId:form.tasks[0].id,choiceId:'specific'}]};
    const patch={step:'assessment' as const,draft:{},navigation,sessionId:null,previewId:null,roleplayId:null};await assert.rejects(h.domain.updateDialogue(other.ctx,{expectedRevision:1,...patch},uid()),code('NOT_FOUND'));
    await assert.rejects(h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch,navigation:{...navigation,answers:[{questionId:form.tasks[1].id,choiceId:'specific'}]}},uid()),code('VALIDATION_ERROR'));
    d=await h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch},uid());await h.restart();ctx=await h.domain.resolveUser(user.identity);assert.deepEqual((await h.domain.dialogue(ctx,{})).navigation,navigation);
    const answers=form.tasks.map(t=>({questionId:t.id,choiceId:'specific'}));d=await h.domain.updateDialogue(ctx,{expectedRevision:d.revision,...patch,navigation:{...navigation,answers}},uid());
    const intent=uid(),input={id:form.id,contentVersion:form.contentVersion,expectedDialogueRevision:d.revision,answers};const [a,b]=await Promise.all([h.domain.submitAssessment(ctx,input,intent),h.domain.submitAssessment(ctx,input,intent)]);assert.equal(a.id,b.id);assert.ok(a.scores.every(s=>s.score===2));const after=await h.domain.dialogue(ctx,{});assert.equal(after.navigation.kind,'none');assert.ok(after.revision>d.revision);await assert.rejects(h.domain.submitAssessment(ctx,input,uid()),code('REVISION_CONFLICT'));assert.equal((await h.domain.assessmentResults(ctx,{limit:20})).items.length,1);
  }finally{await h.close();}
});
test('2.2 support region is explicit, revision-protected and kept by data deletion; unknown never assumes RU',async()=>{
  const h=await productHarness();try{await h.start();const {ctx}=await h.verified(),other=await h.verified();const initial=await h.domain.supportRegion(ctx,{});assert.deepEqual(initial,{revision:1,countryCode:null,region:null});let info=await h.domain.support(ctx,{});assert.equal(info.availability,'region_required');assert.deepEqual(info.contacts,[]);
    const setting=await h.domain.updateSupportRegion(ctx,{expectedRevision:1,countryCode:'US',region:'California'},uid());info=await h.domain.support(ctx,{});assert.equal(info.countryCode,'US');assert.equal(info.availability,'unavailable');assert.deepEqual(info.contacts,[]);assert.equal((await h.domain.supportRegion(other.ctx,{})).countryCode,null);await assert.rejects(h.domain.updateSupportRegion(ctx,{expectedRevision:1,countryCode:'RU',region:null},uid()),code('REVISION_CONFLICT'));
    await h.domain.deleteData(ctx,{confirmation:'DELETE_MY_LEARNING_DATA'},uid());assert.deepEqual(await h.domain.supportRegion(ctx,{}),setting);await h.domain.updateSupportRegion(ctx,{expectedRevision:setting.revision,countryCode:null,region:null},uid());assert.equal((await h.domain.support(ctx,{})).availability,'region_required');
  }finally{await h.close();}
});

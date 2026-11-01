import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productHarness,syntheticInput,uid} from './product-harness.js';
import {ModelFailure} from '../src/domain/product/model.js';
import {Flows,type Turn} from '../../bot/dist/flows.js';
import {TelegramApi} from '../../bot/dist/telegram.js';

test('final: menu is read-only for unfinished practice; canonical state survives domain restart and another user stays isolated',async()=>{
  const h=await productHarness();try{await h.start();const a=await h.verified(),b=await h.verified();
    let d=await h.domain.dialogue(a.ctx,{});d=await h.domain.updateDialogue(a.ctx,{expectedRevision:d.revision,step:'compose',draft:{mode:'understand',message:'Tomorrow?'},navigation:{kind:'none'},sessionId:null,previewId:null,roleplayId:null},uid());
    let sent='';const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async(_url,init)=>{sent=String(init.body);return {json:async()=>({ok:true,result:{message_id:1}})};});
    const t:Turn={tg,ctx:a.ctx,chat:a.identity.privateChatId,account:await h.domain.account(a.ctx,{}),dlg:d,intent:uid(),seq:0};
    await new Flows(h.domain).menu(t);assert.match(sent,/Продолжить практику/);assert.deepEqual(await h.domain.dialogue(a.ctx,{}),d);
    await h.restart();const again=await h.domain.resolveUser({...a.identity,updateId:'777001'});assert.deepEqual(await h.domain.dialogue(again,{}),d);assert.notDeepEqual(await h.domain.dialogue(await h.domain.resolveUser({...b.identity,updateId:'777002'}),{}),d);assert.equal(h.calls(),0);
  }finally{await h.close();}
});

test('final: isolated unavailable model fails honestly; history/cards/account survive and read never regenerates',async()=>{
  let modelCalls=0;const h=await productHarness({generate:async()=>{modelCalls++;throw new ModelFailure('MODEL_UNAVAILABLE');}});try{await h.start();const {ctx}=await h.verified();
    const examples=await h.domain.examples(ctx,{limit:20});assert.equal(examples.items.length,8);assert.equal(h.calls(),0);
    const session=await h.domain.createSession(ctx,syntheticInput,uid());const accepted=await h.launch(ctx,{kind:'analysis',sessionId:session.id,expectedRevision:session.revision});
    const run=await h.wait(ctx,accepted.runId);assert.equal(run.status,'failed');if(run.status==='failed')assert.equal(run.errorCode,'MODEL_UNAVAILABLE');
    const calls=modelCalls;for(let i=0;i<3;i++){await h.domain.run(ctx,{id:run.id});await h.domain.sessions(ctx,{limit:20});await h.domain.cards(ctx,{limit:20});await h.domain.account(ctx,{});}assert.equal(modelCalls,calls);assert.equal(calls,1);
    assert.equal((await h.db.query("SELECT count(*)::int n FROM app.product_events WHERE user_id=$1 AND name='run_completed'",[ctx.accountId])).rows[0].n,0);
  }finally{await h.close();}
});


test('final: bot second role turn and early finish use role revision, not parent session revision',async()=>{
  const h=await productHarness();try{await h.start();const a=await h.verified();await h.domain.updateAccount(a.ctx,{onboardingCompleted:true},uid());
    const session=await h.domain.createSession(a.ctx,syntheticInput,uid());const first=await h.launch(a.ctx,{kind:'analysis',sessionId:session.id,expectedRevision:session.revision});await h.wait(a.ctx,first.runId);
    const started=await h.launch(a.ctx,{kind:'roleplay_start',sessionId:session.id,expectedRevision:session.revision,difficulty:'hurt'});await h.wait(a.ctx,started.runId);if(!started.resourceId)throw new Error('No synthetic role');
    let role=await h.domain.roleplay(a.ctx,{id:started.resourceId});const turn=await h.launch(a.ctx,{kind:'roleplay_turn',roleplayId:role.id,expectedRevision:role.revision,content:'When?'});await h.wait(a.ctx,turn.runId);role=await h.domain.roleplay(a.ctx,{id:role.id});assert.notEqual(role.revision,session.revision);
    const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async()=>({json:async()=>({ok:true,result:{message_id:1}})}));
    const context=async()=>{const d=await h.domain.dialogue(a.ctx,{});const dlg=await h.domain.updateDialogue(a.ctx,{expectedRevision:d.revision,step:'roleplay',draft:{},navigation:{kind:'none'},sessionId:session.id,previewId:null,roleplayId:role.id},uid());return {tg,ctx:a.ctx,chat:a.identity.privateChatId,account:await h.domain.account(a.ctx,{}),dlg,intent:uid(),seq:0} satisfies Turn;};
    const flows=new Flows(h.domain),t=await context();await flows.text(t,'What time tomorrow?');assert.equal(t.dlg.step,'preview');assert.ok(t.dlg.previewId);assert.equal((await h.domain.preview(a.ctx,{id:t.dlg.previewId!})).kind,'roleplay_turn');
    const finish=await context();await flows.callback(finish,{op:'fin',version:finish.dlg.revision,arg:''});assert.equal(finish.dlg.step,'preview');assert.equal((await h.domain.preview(a.ctx,{id:finish.dlg.previewId!})).kind,'roleplay_feedback');
  }finally{await h.close();}
});

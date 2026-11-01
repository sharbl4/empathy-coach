import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError,type ProductFacade} from '@between/contracts/product';
import {productHarness,syntheticInput,uid} from './product-harness.js';
import {Poller,PollerStalled,MAX_UNRECORDED} from '../../bot/dist/runtime.js';
import {encode} from '../../bot/dist/callbacks.js';
import {Flows} from '../../bot/dist/flows.js';
import {TelegramApi} from '../../bot/dist/telegram.js';

for(const permanent of [false,true])test(`inbox acceptance: retained batch resolves ${permanent?'terminal':'transient'} failure without Telegram redelivery or a second poller`,async()=>{
  const h=await productHarness();const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{await h.start();const {ctx,identity}=await h.verified();await h.domain.updateAccount(ctx,{onboardingCompleted:true},uid());
    const first=String(BigInt(identity.updateId)+100n),second=String(BigInt(first)+1n),principal=Number(identity.telegramUserId);
    let reads=0,fetches=0,failures=0;const intents=new Set<string>();
    const facade=new Proxy(h.domain,{get(target,key){
      if(key==='account')return async(...args:Parameters<ProductFacade['account']>)=>{reads++;if(permanent||reads<=2)throw new DomainError({code:'DEPENDENCY_UNAVAILABLE',requestId:'synthetic-inbox-failure'});return target.account(...args);};
      if(key==='claimUpdate')return async(...args:Parameters<ProductFacade['claimUpdate']>)=>{const receipt=await target.claimUpdate(...args);if(args[1]===first)intents.add(receipt.intentKey);return receipt;};
      if(key==='recordUpdateFailure')return async(...args:Parameters<ProductFacade['recordUpdateFailure']>)=>{failures++;const receipt=await target.recordUpdateFailure(...args);h.advance(3000);return receipt;};
      return Reflect.get(target,key);
    }});
    const update=(id:string,text:string)=>({update_id:Number(id),message:{message_id:1,date:0,chat:{id:principal,type:'private'},from:{id:principal,is_bot:false,first_name:'Synthetic'},text}});
    const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async(url)=>{
      if(url.endsWith('/getUpdates')){fetches++;if(fetches===1)return {json:async()=>({ok:true,result:[update(first,'/history'),update(second,'/menu')]})};controller.abort();return {json:async()=>({ok:true,result:[]})};}
      return {json:async()=>({ok:true,result:{message_id:1,date:0,chat:{id:principal,type:'private'}}})};
    });
    timer=setTimeout(()=>controller.abort(),10000);await new Poller(tg,facade,new Flows(facade),{timeoutSeconds:0,backoffMs:1}).run(controller.signal);
    const rows=(await h.db.query('SELECT update_id::text,status,attempts FROM app.telegram_inbox WHERE user_id=$1 ORDER BY update_id',[ctx.accountId])).rows;
    assert.equal(rows.find(row=>row.update_id===first)?.status,permanent?'failed':'completed');
    assert.equal(rows.find(row=>row.update_id===first)?.attempts,3);
    assert.equal(rows.find(row=>row.update_id===second)?.status,permanent?'failed':'completed');
    assert.equal(intents.size,1);assert.equal(fetches,2);assert.equal(h.calls(),0);assert.equal(failures,permanent?6:2);
    assert.equal((await h.db.query("SELECT count(*)::int n FROM app.telegram_inbox WHERE user_id=$1 AND status IN ('processing','retry_wait')",[ctx.accountId])).rows[0].n,0);
  }finally{clearTimeout(timer);controller.abort();await h.close();}
});


test('inbox acceptance: lost response after run admission retains intent and never repeats generation',async()=>{
  const h=await productHarness();const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{await h.start();const {ctx,identity}=await h.verified();await h.domain.updateAccount(ctx,{onboardingCompleted:true},uid());
    const session=await h.domain.createSession(ctx,syntheticInput,uid()),preview=await h.domain.createPreview(ctx,{kind:'analysis',sessionId:session.id,expectedRevision:session.revision},uid());const shown=await h.show(ctx,preview);
    const id=String(BigInt(identity.updateId)+100n),principal=Number(identity.telegramUserId);let lost=false,fetches=0;
    const facade=new Proxy(h.domain,{get(target,key){if(key==='recordUpdateFailure')return async(...args:Parameters<ProductFacade['recordUpdateFailure']>)=>{const r=await target.recordUpdateFailure(...args);h.advance(3000);return r;};return Reflect.get(target,key);}});
    const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async(url)=>{
      if(url.endsWith('/getUpdates')){fetches++;if(fetches===1)return {json:async()=>({ok:true,result:[{update_id:Number(id),callback_query:{id:'synthetic-callback',from:{id:principal,is_bot:false,first_name:'Synthetic'},message:{message_id:1,date:0,chat:{id:principal,type:'private'}},data:encode('send',shown.revision)}}]})};controller.abort();return {json:async()=>({ok:true,result:[]})};}
      if(url.endsWith('/sendMessage')&&!lost&&(await h.db.query('SELECT count(*)::int n FROM app.product_runs WHERE user_id=$1',[ctx.accountId])).rows[0].n===1){lost=true;throw new Error('Synthetic lost transport response');}
      return {json:async()=>({ok:true,result:{message_id:1,date:0,chat:{id:principal,type:'private'}}})};
    });
    timer=setTimeout(()=>controller.abort(),10000);await new Poller(tg,facade,new Flows(facade),{timeoutSeconds:0,backoffMs:1}).run(controller.signal);
    const runs=(await h.db.query('SELECT id FROM app.product_runs WHERE user_id=$1',[ctx.accountId])).rows;assert.equal(runs.length,1);assert.equal((await h.wait(ctx,runs[0].id)).status,'succeeded');assert.equal(h.calls(),1);assert.equal(lost,true);
    const receipt=(await h.db.query('SELECT status,attempts FROM app.telegram_inbox WHERE user_id=$1 AND update_id=$2',[ctx.accountId,id])).rows[0];assert.equal(receipt.status,'completed');assert.equal(receipt.attempts,2);assert.equal(fetches,2);
  }finally{clearTimeout(timer);controller.abort();await h.close();}
});

test('inbox acceptance: retaining a batch preserves fatal max5 and never acks unrecordable claims',async()=>{
  const h=await productHarness();try{await h.start();const {ctx,identity}=await h.verified();const principal=Number(identity.telegramUserId),id=String(BigInt(identity.updateId)+100n);let claims=0,acks=0,fetches=0;
    const facade=new Proxy(h.domain,{get(target,key){if(key==='claimUpdate')return async()=>{claims++;throw new DomainError({code:'DEPENDENCY_UNAVAILABLE',requestId:'synthetic-claim-outage'});};if(key==='acknowledgeUpdate')return async()=>{acks++;};return Reflect.get(target,key);}});
    const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async(url)=>{if(url.endsWith('/getUpdates')){fetches++;return {json:async()=>({ok:true,result:[{update_id:Number(id),message:{message_id:1,date:0,chat:{id:principal,type:'private'},from:{id:principal,is_bot:false,first_name:'Synthetic'},text:'/menu'}}]})};}return {json:async()=>({ok:true,result:true})};});
    await assert.rejects(new Poller(tg,facade,new Flows(facade),{timeoutSeconds:0,backoffMs:1}).run(new AbortController().signal),PollerStalled);
    assert.equal(claims,MAX_UNRECORDED);assert.equal(acks,0);assert.equal(fetches,1);assert.equal(h.calls(),0);assert.equal((await h.db.query('SELECT count(*)::int n FROM app.telegram_inbox WHERE user_id=$1',[ctx.accountId])).rows[0].n,0);
  }finally{await h.close();}
});

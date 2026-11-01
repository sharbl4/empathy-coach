import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productHarness,uid} from './product-harness.js';
import {Poller} from '../../bot/dist/runtime.js';
import {Flows} from '../../bot/dist/flows.js';
import {TelegramApi,type TgUpdate} from '../../bot/dist/telegram.js';

async function scenario(){
 const h=await productHarness();await h.start();const a=await h.verified();await h.domain.updateAccount(a.ctx,{onboardingCompleted:true},uid());
 const principal=Number(a.identity.telegramUserId);let next=Number(a.identity.updateId)+100;const shown:Array<{buttons:Array<{text:string;data:string}>}>=[];
 const tg=new TelegramApi('123456:TEST_ONLY_aaaaaaaaaaaaaaaaaaaaaaaa',async(_url,init)=>{const body=JSON.parse(init.body);if(body.reply_markup)shown.push({buttons:body.reply_markup.inline_keyboard.flat().map((b:{text:string;callback_data:string})=>({text:b.text,data:b.callback_data}))});return {json:async()=>({ok:true,result:{message_id:1,date:0,chat:{id:principal,type:'private'}}})};});
 const poller=new Poller(tg,h.domain,new Flows(h.domain),{timeoutSeconds:0,backoffMs:1});
 const sender={id:principal,is_bot:false,first_name:'Synthetic'};
 const message=async(text:string)=>{const update:TgUpdate={update_id:next++,message:{message_id:1,date:0,from:sender,chat:{id:principal,type:'private'},text}};assert.equal((await poller.handle(update)).done,true);};
 const click=async(label:string)=>{const button=shown.at(-1)?.buttons.find(b=>b.text===label);assert.ok(button,'Expected synthetic UI control');assert.equal((await poller.handle({update_id:next++,callback_query:{id:'synthetic-'+next,from:sender,message:{message_id:1,date:0,chat:{id:principal,type:'private'}},data:button.data}})).done,true);};
 return {h,a,message,click,completeFields:async()=>{await message('Коллега');await click('Коллеги');await click('Пропустить');await click('Уточнить');}};
}

test('bot preview acceptance: menu after first field resumes through real domain to shown fitting preview and one run',async()=>{
 const s=await scenario();try{await s.message('/menu');await s.click('Понять сообщение');await s.message('Ок, давай обсудим завтра');await s.message('/menu');await s.click('Продолжить практику');await s.completeFields();await s.click('Не понимаю');
  const d=await s.h.domain.dialogue(s.a.ctx,{});assert.equal(d.step,'preview');assert.ok(d.previewId);const p=await s.h.domain.preview(s.a.ctx,{id:d.previewId!});assert.equal(p.budget.fit,'fits');assert.equal(s.h.calls(),0);
  await s.click('Отправить в модель');const runs=(await s.h.db.query('SELECT id FROM app.product_runs WHERE user_id=$1',[s.a.ctx.accountId])).rows;assert.equal(runs.length,1);assert.equal((await s.h.wait(s.a.ctx,runs[0].id)).status,'succeeded');assert.equal(s.h.calls(),1);
 }finally{await s.h.close();}
});

test('bot preview acceptance: menu/continue preserves the partial hypothesis and its quotes before preview',async()=>{
 const s=await scenario();try{await s.message('/menu');await s.click('Понять сообщение');await s.message('Ок, давай обсудим завтра');await s.completeFields();await s.message('усталость');await s.message('завтра');
  const before=await s.h.domain.dialogue(s.a.ctx,{});assert.equal(before.draft.guess?.quotes.length,1);await s.message('/menu');await s.click('Продолжить практику');const after=await s.h.domain.dialogue(s.a.ctx,{});assert.deepEqual(after.draft.guess,before.draft.guess);
  await s.click('Готово');const d=await s.h.domain.dialogue(s.a.ctx,{});assert.equal(d.step,'preview');assert.ok(d.sessionId);const session=await s.h.domain.session(s.a.ctx,{id:d.sessionId!});assert.ok('guess' in session.input);if('guess' in session.input)assert.deepEqual(session.input.guess,before.draft.guess);assert.equal(s.h.calls(),0);
 }finally{await s.h.close();}
});

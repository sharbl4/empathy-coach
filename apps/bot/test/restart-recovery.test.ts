// Contract 2.2: unfinished steps live in the domain dialogue navigation and survive a transport restart.
// History position/search are view state: after a restart history opens from page 1 (agreed).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harness} from './harness.js';

test('2.2.1 menu keeps test answers; continue accepts the next answer; discard asks for confirmation',async()=>{
  const h=new Harness();await h.register();await h.message('/menu');await h.click('Ещё →');await h.click('Тест до/после');await h.click('Входной тест');await h.click('1');
  await h.message('/menu');assert.ok(h.last().buttons.some(b=>b.text==='Продолжить тест'));
  const restarted=new Harness(h.domain);await restarted.callback(h.button('Продолжить тест'));assert.match(restarted.lastText(),/Задание 2 из 3/);await restarted.click('2');assert.match(restarted.lastText(),/Задание 3 из 3/);
  await restarted.message('/menu');await restarted.click('Сбросить тест');assert.ok(restarted.last().buttons.some(b=>b.text==='Да, сбросить тест'));await restarted.click('Нет, продолжить');assert.match(restarted.lastText(),/Задание 3 из 3/);
  await restarted.message('/menu');await restarted.click('Сбросить тест');await restarted.click('Да, сбросить тест');assert.match(restarted.lastText(),/Ответы теста сброшены/);
});

test('2.2.1 thread edit survives restart; reorder keeps stable turn IDs',async()=>{
  const h=new Harness();await h.register();await h.message('/menu');await h.click('Ветка переписки');await h.message('Сестра');await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');await h.click('+ Реплика собеседника');await h.message('Первая');await h.click('+ Моя реплика');await h.message('Вторая');
  await h.click('Изменить 1');const restarted=new Harness(h.domain);await restarted.message('Исправлена');assert.match(restarted.lastText(),/Исправлена/);
  await restarted.click('↓ 1');assert.match(restarted.lastText(),/1\. Я: Вторая/);assert.match(restarted.lastText(),/2\. Собеседник: Исправлена/);
  await restarted.click('↑ 2');assert.match(restarted.lastText(),/1\. Собеседник: Исправлена/);
});

async function toPreview(h:Harness,message='Ок. Позвони: +7 999 123-45-67') {
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message(message);await h.message('Друг');
  await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');await h.click('Не понимаю');
}

test('preview field edit survives restart: the chosen field is still being edited',async()=>{
  const h=new Harness();await h.register();await toPreview(h);
  await h.click('Изменить');await h.click(/^1\. Сообщение/);
  const restarted=new Harness(h.domain);
  await restarted.message('Ок, пиши на me@example.com');
  assert.match(restarted.lastText(),/\[почта скрыта\]/);
  assert.equal([...h.domain.previews.values()][0]!.preview.revision,2);
});

test('thread: the chosen speaker of the next turn survives restart',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ветка переписки');
  await h.message('Сестра');await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');
  await h.click('+ Реплика собеседника');
  const restarted=new Harness(h.domain);
  await restarted.message('Ты где?');
  assert.match(restarted.lastText(),/1\. Собеседник: Ты где\?/);
});

test('card attempt survives restart: the answer goes to the same card and content version',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Карточки');await h.click(/Уточнение/);await h.click('Попробовать');
  const restarted=new Harness(h.domain);
  await restarted.message('Когда тебе удобно?');
  assert.match(restarted.lastText(),/Моя попытка/);
  const p=[...h.domain.previews.values()].at(-1)!;assert.equal(p.source.kind,'card_feedback');
});

test('reminder field being edited survives restart',async()=>{
  const h=new Harness();await h.register();
  await h.message('/account');await h.click('Напоминания');await h.click('Время');
  const restarted=new Harness(h.domain);
  await restarted.message('08:30');
  assert.match(restarted.lastText(),/Время: 08:30/);
});

test('assessment: each answer is saved; the series continues after restart and is submitted with the dialogue revision',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Тест до/после');await h.click('Входной тест');
  await h.click('1');
  const restarted=new Harness(h.domain);
  await restarted.message('что дальше?');
  assert.match(restarted.messages().at(-2)!.text!,/сохранено ответов 1 из 3/);
  assert.match(restarted.lastText(),/Задание 2 из 3/);
  await restarted.click('2');await restarted.click('1');
  assert.match(restarted.lastText(),/Результат входного теста/);
});

test('history reopens from page 1 after restart (agreed transient view state)',async()=>{
  const h=new Harness();await h.register();
  for(let i=0;i<6;i++){await toPreview(h,`Ситуация ${i}`);}
  await h.message('/history');await h.click('Дальше →');
  const restarted=new Harness(h.domain);
  await restarted.callback(h.button('Дальше →'));
  assert.match(restarted.lastText(),/страница (1|2)/);
});

test('shown preview is protected: a newer version from the web is shown again, the old button approves nothing',async()=>{
  const h=new Harness();await h.register();await toPreview(h);
  const p=[...h.domain.previews.values()][0]!.preview;
  // The web edited the preview after the bot showed it; the bot dialogue revision did not change.
  p.revision=2;p.snapshotHash='d'.repeat(64);p.fields[0]!.value='изменено на сайте';
  await h.click('Отправить в модель');
  assert.ok(h.messages().some(m=>/Предпросмотр изменился/.test(m.text??'')));
  assert.match(h.lastText(),/изменено на сайте/);
  assert.equal(h.domain.runs.size,0);assert.equal(p.confirmedAt,null);
  await h.click('Отправить в модель');
  assert.equal(h.domain.runs.size,1,'the newly shown version can be confirmed');
});

test('send is offered only when the budget fits; unknown and too large cannot generate',async()=>{
  const h=new Harness();await h.register();await toPreview(h);
  const p=[...h.domain.previews.values()][0]!.preview;
  const send=h.button('Отправить в модель');
  p.budget={...p.budget,fit:'unknown'};
  await h.callback(send);
  assert.match(h.lastText(),/не удалось проверить/);assert.equal(h.domain.runs.size,0);
});

test('support region: no numbers without a chosen country; choice and clearing are stored by the domain',async()=>{
  const h=new Harness();await h.register();await toPreview(h,'Я убью тебя, если расскажешь');
  assert.deepEqual(h.domain.supportCalls.at(-1),{});
  assert.match(h.lastText(),/выбери страну/);assert.doesNotMatch(h.lastText(),/\b150\b/);
  assert.ok(!h.last().buttons.some(b=>b.text==='Отправить в модель'));
  await h.click('Казахстан');
  assert.equal(h.domain.region.countryCode,'KZ');
  const restarted=new Harness(h.domain);
  await toPreview(restarted,'Я убью тебя, если расскажешь');
  assert.match(restarted.lastText(),/Тестовая линия поддержки: 150/);
  await restarted.message('/account');await restarted.click('Регион помощи');await restarted.click('Не указывать');
  assert.equal(h.domain.region.countryCode,null);
  await restarted.message('/account');await restarted.click('Регион помощи');await restarted.click('Другая страна');
  const again=new Harness(h.domain);await again.message('de');
  assert.equal(h.domain.region.countryCode,'DE');
});

test('OPERATION_IN_PROGRESS for the same intent is not acknowledged as success',async()=>{
  const h=new Harness();await h.register();await toPreview(h);
  const send=h.button('Отправить в модель');
  const original=h.domain.startRun.bind(h.domain);let first=true;
  h.domain.startRun=async(...args:Parameters<typeof original>)=>{if(first){first=false;const {DomainError}=await import('@between/contracts/product');throw new DomainError({code:'OPERATION_IN_PROGRESS',requestId:'t'});}return original(...args);};
  assert.equal((await h.callback(send,{updateId:4242})).done,false);
  assert.equal(h.domain.receipts.get('4242')!.status,'retry_wait');
  h.domain.clockSkewMs=5000;
  assert.equal((await h.callback(send,{updateId:4242})).done,true);
  assert.equal(h.domain.runs.size,1);
});

test('crash after each committed step: the same update replays with the same keys, no duplicate session or preview',async()=>{
  for(const failing of ['createPreview','confirmPreview','startRun']){
    const h=new Harness();await h.register();
    await h.message('/menu');await h.click('Понять сообщение');
    await h.message('Ок.');await h.message('Друг');await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');
    const unsure=h.button('Не понимаю');
    if(failing==='createPreview'){h.domain.transient.set('createPreview',1);assert.equal((await h.callback(unsure,{updateId:5000})).done,false);h.domain.clockSkewMs=5000;await h.callback(unsure,{updateId:5000});}
    else await h.callback(unsure);
    assert.equal(h.domain.store.size,1,`${failing}: one session`);
    assert.equal(h.domain.previews.size,1,`${failing}: one preview`);
    if(failing==='createPreview')continue;
    const send=h.button('Отправить в модель');
    h.domain.transient.set(failing,1);
    assert.equal((await h.callback(send,{updateId:6000})).done,false);
    h.domain.clockSkewMs=5000;
    assert.equal((await h.callback(send,{updateId:6000})).done,true);
    assert.equal(h.domain.runs.size,1,`${failing}: one run`);
  }
});

test('poller stops (fatal) when no durable outcome can be recorded, without acknowledging',async()=>{
  const h=new Harness();await h.register();
  const {TelegramApi}=await import('../src/telegram.js');const {Poller,MAX_UNRECORDED}=await import('../src/runtime.js');
  h.domain.transient.set('claimUpdate',100);
  let n=50000;
  const tg=new TelegramApi('123456:TEST_ONLY_TOKEN_aaaaaaaaaaaaaaaaaaaaa',async url=>({json:async()=>url.endsWith('/getUpdates')?{ok:true,result:[{update_id:n++,message:{message_id:1,date:0,chat:{id:42,type:'private'},from:{id:42,is_bot:false,first_name:'T'},text:'/menu'}}]}:{ok:true,result:true}}),async()=>{});
  await assert.rejects(new Poller(tg,h.domain.asFacade(),h.flows,{timeoutSeconds:0,backoffMs:1}).run(new AbortController().signal),/durable/);
  assert.ok(n-50000<=MAX_UNRECORDED+1);
  assert.ok(![...h.domain.receipts.keys()].some(k=>Number(k)>=50000),'nothing acknowledged');
});

test('unfinished test is not destroyed by another scenario: the user is asked to continue or reset explicitly',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Тест до/после');await h.click('Входной тест');await h.click('1');
  await h.message('/menu');await h.click('Понять сообщение');
  assert.match(h.lastText(),/незавершённый тест/);
  assert.ok(h.last().buttons.some(b=>b.text==='Продолжить тест'));
  assert.equal(h.domain.dialogues.get(h.account().id)!.navigation.kind,'assessment','answers kept');
  // An example that goes straight to a preview must not create a session first.
  await h.message('/menu');await h.click('Попробовать на примере');await h.click(/«Ок\.»/);
  assert.match(h.lastText(),/незавершённый тест/);assert.equal(h.domain.store.size,0);
  await h.click('Сбросить тест');await h.click('Да, сбросить тест');
  await h.message('/menu');await h.click('Понять сообщение');assert.match(h.lastText(),/Пришли сообщение/);
});

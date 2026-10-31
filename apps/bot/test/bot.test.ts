import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CALLBACK_LIMIT,decode,encode,intentKey} from '../src/callbacks.js';
import {classify} from '../src/identity.js';
import {createTelegramTransport} from '../src/index.js';
import {Poller,logError} from '../src/runtime.js';
import {TelegramApi,TelegramError,TelegramUnavailable} from '../src/telegram.js';
import {chunk,TELEGRAM_LIMIT} from '../src/text.js';
import {Harness,TOKEN} from './harness.js';

const UUID='123e4567-e89b-42d3-a456-426614174000';

/** «Понять сообщение» up to the domain preview. */
async function understandToPreview(h:Harness,message='Ок. Позвони: +7 999 123-45-67',user=42) {
  await h.message('/menu',{user});await h.click('Понять сообщение',user);
  await h.message(message,{user});await h.message('Друг',{user});
  await h.click('Близкие',user);await h.click('Пропустить',user);await h.click('Уточнить',user);
  await h.message('обида, усталость',{user});await h.message('Ок.',{user});await h.click('Готово',user);
}
async function analysed(h:Harness) {
  await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
}
const confirmAndComplete=async(h:Harness)=>{await h.click('Отправить в модель');h.domain.complete(h.domain.pending()!.id);await h.deliver();};

test('callbacks fit 64 bytes, junk is rejected, content ids pass, intent keys are stable UUIDs',()=>{
  const data=encode('hy',123456,UUID);
  assert.ok(Buffer.byteLength(data)<=CALLBACK_LIMIT);
  assert.deepEqual(decode(data),{op:'hy',version:123456,arg:UUID});
  assert.deepEqual(decode(encode('co',null,'clarify-1')),{op:'co',version:null,arg:'clarify-1'});
  for(const bad of [undefined,'','x','a|b|c|d','h o|-|','ho|-|привет','ho|-|'+'a'.repeat(70)])assert.equal(decode(bad),null);
  assert.equal(intentKey(UUID,'analyze',0),intentKey(UUID,'analyze',0));
  assert.match(intentKey('x'),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('chunk keeps text below the Telegram limit without losing words',()=>{
  const text=Array.from({length:900},(_,i)=>`Фраза ${i} <b>&amp;</b> *_[]`).join(' ')+'\n\n'+'я'.repeat(5000);
  const parts=chunk(text);assert.ok(parts.length>2);
  for(const p of parts)assert.ok(p.length<TELEGRAM_LIMIT);
  assert.equal(parts.join(' ').replace(/\s+/g,''),text.replace(/\s+/g,''));
});

test('identity: only matching private chat; groups, channels, bots, unsafe ids and inline callbacks are rejected',()=>{
  const from={id:42,is_bot:false,first_name:'T'};
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:42,type:'private'},from,text:'hi'}}).kind,'private');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:43,type:'private'},from,text:'hi'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:-1,type:'supergroup'},from,text:'/start'}}).kind,'group_command');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:-1,type:'channel'},text:'post'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:42,type:'private'},from:{...from,is_bot:true},text:'x'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:2**60,type:'private'},from:{...from,id:2**60},text:'x'}}).kind,'ignored');
  assert.equal(classify({update_id:1,callback_query:{id:'c',from,inline_message_id:'i',data:'m|-|u'}}).kind,'callback_rejected');
  const ok=classify({update_id:7,callback_query:{id:'c',from,message:{message_id:1,date:0,chat:{id:42,type:'private'}},data:'m|-|u'}});
  assert.deepEqual(ok.kind==='private'&&ok.identity,{telegramUserId:'42',privateChatId:'42',updateId:'7'});
});

test('inline callback with from.id but no chat calls no domain method except acknowledge',async()=>{
  const h=new Harness();await h.callback(encode('m',null,'u'),{chat:null});
  assert.deepEqual(h.domain.calls,['acknowledgeUpdate']);assert.equal(h.domain.accounts.size,0);
});

test('groups: hint on commands only, nothing stored, offset advances',async()=>{
  const h=new Harness();
  await h.message('Привет всем',{chat:{id:-100,type:'supergroup'}});assert.equal(h.messages().length,0);
  await h.message('/start',{chat:{id:-100,type:'supergroup'}});assert.match(h.lastText(),/только в личном чате/);
  assert.deepEqual([...new Set(h.domain.calls)],['acknowledgeUpdate']);assert.equal(h.domain.accounts.size,0);assert.ok(h.domain.offset>0);
});

test('registration: greeting, consent web-telegram-2, gated menu, wrong code, verified, onboarding',async()=>{
  const h=new Harness();
  await h.message('/start');
  assert.ok(h.messages().some(m=>m.text?.includes('Несколько возможных трактовок. Мысли не читаем.')));
  assert.ok(!h.messages().some(m=>/парол.*введи/i.test(m.text??'')));
  await h.message('/history');assert.match(h.lastText(),/Перед началом/);
  await h.click('Принимаю, продолжить');assert.equal(h.account().consentVersion,'web-telegram-2');
  await h.message('not-an-email');assert.match(h.lastText(),/не похоже на адрес/);
  await h.message('me@example.com');assert.match(h.lastText(),/Код отправлен на me\*\*\*@example\.com/);assert.match(h.lastText(),/Осталось попыток: 5/);
  await h.message(h.domain.lastCode==='000000'?'111111':'000000');assert.match(h.lastText(),/Код не подошёл\.[\s\S]*Осталось попыток: 4/);
  await h.message(h.domain.lastCode);
  assert.ok(h.messages().some(m=>m.text==='Почта подтверждена.'));assert.match(h.lastText(),/Главное меню/);
  assert.ok(h.account().onboardingCompletedAt);
});

test('menu is paged and lists every product area without «скоро»',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');
  const first=h.last().buttons.map(b=>b.text);
  for(const label of ['Понять сообщение','Сказать прямо','До отправки','Ветка переписки','Попробовать на примере','История','Прогресс'])assert.ok(first.includes(label),label);
  assert.ok(h.last().buttons.length<=9);
  await h.click('Ещё →');
  const second=h.last().buttons.map(b=>b.text);
  for(const label of ['Практика дня','Карточки','Навыки','Тест до/после','Открыть веб','Аккаунт и настройки'])assert.ok(second.includes(label),label);
  assert.ok(!h.messages().some(m=>/скоро/i.test(m.text??'')));
});

test('understand: composer steps → domain-masked preview → no generation before confirm → analysis with basis and comparison',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('Ок. Позвони: +7 999 123-45-67');await h.message('Друг');
  await h.click('Назад');assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('Друг');await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');
  await h.message('обида, усталость');
  await h.message('Перезвони');assert.match(h.lastText(),/Такой цитаты нет/);
  await h.message('Ок.');await h.click('Готово');
  assert.match(h.lastText(),/Так текст уйдёт в модель/);
  assert.match(h.lastText(),/\[телефон скрыт\]/);assert.doesNotMatch(h.lastText(),/999 123/);
  assert.match(h.lastText(),/скрыто телефонов\/почт: 1/);assert.match(h.lastText(),/не гарантия анонимности/);
  assert.equal(h.domain.runs.size,0,'no run before confirmation');
  const s=[...h.domain.store.values()][0]!;
  assert.deepEqual(s.input,{relationship:'Друг',context:'',contextType:'close',goal:'clarify',title:'Ок. Позвони: +7 999 123-45-67',mode:'understand',message:'Ок. Позвони: +7 999 123-45-67',guess:{emotions:['обида','усталость'],quotes:['Ок.'],unsure:false}});
  await h.click('Отправить в модель');
  assert.match(h.lastText(),/Запрос принят\. Место в очереди: 1/);
  const preview=[...h.domain.previews.values()][0]!.preview;assert.ok(preview.confirmedAt);
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  const out=h.lastText();
  assert.match(out,/Основания: есть текстовые основания/);assert.match(out,/Основания: данных недостаточно/);
  assert.match(out,/«Ок\.» — Сообщение/);assert.match(out,/Где совпало/);assert.match(out,/не означает «правильно»/);assert.doesNotMatch(out,/%/);
  for(const label of ['Как уточнить?','Полезно','Не полезно','Написать ответ','Упражнение','Потренировать разговор','В меню'])assert.ok(h.last().buttons.some(b=>b.text===label),label);
  const calls=h.domain.modelCalls;await h.click('Как уточнить?');
  assert.match(h.lastText(),/Во сколько удобно\?/);assert.equal(h.domain.modelCalls,calls,'saved question, no generation');
  await h.click('Полезно');await h.click('Полезно');await h.click('Не полезно');
  assert.equal(h.domain.votes.size,1);assert.equal([...h.domain.votes.values()][0],'not_useful');
});

test('preview edit: new revision, old send button is stale, confirmation covers the edited snapshot',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  const oldSend=h.button('Отправить в модель');
  await h.click('Изменить');await h.click(/^1\. Сообщение/);
  await h.message('Ок, пиши на me@example.com');
  assert.match(h.lastText(),/\[почта скрыта\]/);
  await h.callback(oldSend);assert.match(h.lastText(),/Этот шаг уже завершён/);assert.equal(h.domain.runs.size,0);
  await h.click('Отправить в модель');
  const p=[...h.domain.previews.values()][0]!.preview;assert.equal(p.revision,2);assert.ok(p.confirmedAt);
  assert.equal(h.domain.runs.size,1);
});

test('duplicates: redelivered update and double click create one preview confirmation and one run',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  const send=h.button('Отправить в модель');
  await h.callback(send,{updateId:7777});await h.callback(send,{updateId:7777});await h.callback(send);
  assert.equal(h.domain.runs.size,1);assert.equal(h.domain.store.size,1);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
});

test('known temporary failure: durable retry_wait with the same intent, one run, user told once, no ack until done',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  const send=h.button('Отправить в модель');
  h.domain.transient.set('startRun',1);
  const first=await h.callback(send,{updateId:8888});
  assert.equal(first.done,false);
  assert.equal(h.domain.receipts.get('8888')!.status,'retry_wait');
  assert.match(h.lastText(),/Временная ошибка сервера/);
  assert.equal((await h.callback(send,{updateId:8888})).done,false,'not due yet: not processed again');
  h.domain.clockSkewMs=5000;
  assert.equal((await h.callback(send,{updateId:8888})).done,true);
  assert.equal(h.domain.runs.size,1);assert.equal(h.domain.receipts.get('8888')!.status,'completed');
  assert.equal(h.messages().filter(m=>/Временная ошибка сервера/.test(m.text??'')).length,1);
});

test('retry budget is 3 attempts in the DB; then failed stays failed after ack, user told honestly',async()=>{
  const h=new Harness();await h.register();
  h.domain.transient.set('dialogue',3);
  for(let i=0;i<2;i++){assert.equal((await h.message('/menu',{updateId:9001})).done,false);h.domain.clockSkewMs+=5000;}
  assert.equal((await h.message('/menu',{updateId:9001})).done,true);
  const r=h.domain.receipts.get('9001')!;assert.equal(r.status,'failed');assert.equal(r.attempts,3);
  assert.match(h.lastText(),/Не получилось выполнить это действие/);
  // A restarted transport claims the same update: still failed, only acknowledged, never re-processed as success.
  const restarted=new Harness(h.domain);assert.equal((await restarted.message('/menu',{updateId:9001})).done,true);
  assert.equal(h.domain.receipts.get('9001')!.status,'failed');assert.equal(restarted.messages().length,0);
});

test('unknown error is terminal at once (INTERNAL_ERROR, no retry, no private detail to the user)',async()=>{
  const h=new Harness();await h.register();
  h.domain.unknown.set('dialogue',1);
  assert.equal((await h.message('/menu',{updateId:9100})).done,true);
  const r=h.domain.receipts.get('9100')!;
  assert.equal(r.status,'failed');assert.equal(r.attempts,1);assert.equal(r.failure?.code,'INTERNAL_ERROR');
  assert.ok(!h.messages().some(m=>/unexpected bug|private detail/.test(m.text??'')));
});

test('email: state survives a restart without process memory; resend uses the current challenge; honest failed delivery',async()=>{
  const h=new Harness();
  await h.message('/start');await h.click('Принимаю, продолжить');await h.message('me@example.com');
  const restarted=new Harness(h.domain);
  await restarted.message('/start');
  assert.match(restarted.lastText(),/Код отправлен на me\*\*\*@example\.com/);
  h.domain.clockSkewMs=61000;
  const before=h.domain.lastCode;
  await restarted.click('Отправить код ещё раз');
  assert.notEqual(h.domain.lastCode,before,'new code issued');assert.ok(!restarted.messages().some(m=>/Напиши адрес/.test(m.text??'')),'address not asked again');
  await restarted.message(before);assert.match(restarted.lastText(),/Этот код уже заменён|Код не подошёл/);
  h.domain.deliveryFailsFor.add('me@example.com');
  await restarted.message('/start');assert.match(restarted.lastText(),/не отправилось/);assert.doesNotMatch(restarted.lastText(),/Код отправлен/);
  h.domain.deliveryFailsFor.clear();
  await restarted.message(h.domain.lastCode);
  assert.ok(restarted.messages().some(m=>m.text==='Почта подтверждена.'));
});

test('email resend before cooldown shows the server cooldown instead of claiming a new code',async()=>{
  const h=new Harness();
  await h.message('/start');await h.click('Принимаю, продолжить');await h.message('me@example.com');
  const code=h.domain.lastCode;
  await h.click('Отправить код ещё раз');
  assert.match(h.lastText(),/Новый код пока отправить нельзя/);assert.match(h.lastText(),/через \d+ с/);
  assert.equal(h.domain.lastCode,code);
});

test('ownership: forged callbacks with another account ids reveal nothing',async()=>{
  const h=new Harness();await h.register(1);await h.register(2);
  await understandToPreview(h,'Секрет первого',1);await h.click('Отправить в модель',1);
  const sid=[...h.domain.store.keys()][0]!,runId=h.domain.pending()!.id;
  for(const [op,arg] of [['ho',sid],['ha',sid],['hd',sid],['rw',sid],['xs',sid],['rp',sid],['cl',runId],['rt',runId],['xa',runId],['up',runId],['pw0',runId]] as const)await h.callback(encode(op,null,arg),{user:2});
  const toUser2=h.messages().filter(m=>m.chat_id==='2').map(m=>m.text).join('\n');
  assert.doesNotMatch(toUser2,/Секрет первого/);assert.match(h.lastText(),/нет или она удалена/);
  assert.equal(h.domain.store.size,1);assert.equal(h.domain.votes.size,0);
});

test('limits keep the draft; special characters as plain text; non-text; /cancel',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('х'.repeat(6001));assert.match(h.lastText(),/6001 символов, можно до 6000/);
  const special='<script>alert(1)</script> & *bold* _x_ [a](b)';
  await h.message(special);assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('я'.repeat(201));assert.match(h.lastText(),/до 200/);
  assert.equal(h.domain.dialogues.get(h.account().id)!.draft.message,special);
  await h.push(h.update({message:{message_id:2,date:0,chat:{id:42,type:'private'},from:{id:42,is_bot:false,first_name:'Т'}}}));
  assert.match(h.lastText(),/только текст/);
  assert.ok(h.sent.every(s=>!('parse_mode' in s.body)));
  await h.message('/cancel');assert.match(h.lastText(),/черновик удалён/);
  assert.equal(h.domain.dialogues.get(h.account().id)!.step,'menu');
});

test('restart: a new transport instance continues the saved step from the database',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');await h.message('До рестарта');
  const restarted=new Harness(h.domain);await restarted.message('Коллега');
  assert.match(restarted.lastText(),/К какой сфере/);
  assert.equal(h.domain.dialogues.get(h.account().id)!.draft.message,'До рестарта');
});

test('model failure: clear message, history works, explicit retry, delivery never generates',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  h.domain.failRun(h.domain.pending()!.id,'MODEL_UNAVAILABLE');await h.deliver();
  assert.match(h.lastText(),/Модель сейчас недоступна/);
  await h.message('/history');assert.match(h.lastText(),/История · страница 1/);
  await h.click('Повторить');assert.match(h.lastText(),/Запрос принят/);
  assert.equal(h.domain.runs.size,2);await h.deliver();await h.deliver();
  assert.equal(h.domain.runs.size,2);assert.equal(h.domain.modelCalls,0);
});

test('reply: own draft first, preview, heatmap with tone words and details, examples on demand',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Написать ответ');assert.match(h.lastText(),/Сначала свой вариант/);
  await h.message('Ты опять пропал. Во сколько?');
  assert.match(h.lastText(),/Мой черновик:\nТы опять пропал/);assert.equal(h.domain.pending(),undefined);
  await confirmAndComplete(h);
  assert.match(h.lastText(),/1\. 🟠 стоит пересмотреть\n«Ты оп»/);assert.match(h.lastText(),/Сильные стороны черновика/);
  await h.click('1: Почему? / Мягче');assert.match(h.lastText(),/Вариант мягче: «Давно тебя не слышно\.»/);
  await h.click('Другой черновик');await h.click('Нужен пример');
  assert.match(h.lastText(),/Так текст уйдёт в модель/);await confirmAndComplete(h);
  assert.match(h.lastText(),/Поддержать:[\s\S]*Уточнить:[\s\S]*Помириться:[\s\S]*Обозначить границу:/);
});

test('exercise: task → attempt → preview → feedback',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Упражнение');await confirmAndComplete(h);
  assert.match(h.lastText(),/Упражнение \(30–60 секунд\) · навык: Уточнение/);
  await h.message('Во сколько тебе удобно?');assert.match(h.lastText(),/Моя попытка/);
  await confirmAndComplete(h);assert.match(h.lastText(),/Что улучшить/);
});

test('roleplay: difficulty choice, counter, finish only after first answer, final feedback',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Потренировать разговор');
  for(const l of ['Спокойный','Обиженный','Раздражённый'])assert.ok(h.last().buttons.some(b=>b.text===l));
  await h.click('Раздражённый');await confirmAndComplete(h);
  assert.equal([...h.domain.roles.values()][0]!.role.difficulty,'irritated');
  assert.match(h.lastText(),/Твой ответ 1 из 3/);assert.ok(!h.last().buttons.some(b=>b.text.startsWith('Завершить')));
  await h.message('Извини, давай обсудим.');await confirmAndComplete(h);
  assert.match(h.lastText(),/Твой ответ 2 из 3/);
  await h.click('Завершить (1/3)');await confirmAndComplete(h);
  assert.match(h.lastText(),/Итог тренировки/);
});

test('say direct and before send work without the other person message',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Сказать прямо');
  await h.message('Ну я не знаю, может, как-нибудь потом');await h.click('Пропустить');
  await h.message('Друг');await h.click('Близкие');await h.click('Пропустить');await h.click('Обозначить границу');
  assert.match(h.lastText(),/Мой текст:\nНу я не знаю/);
  assert.equal([...h.domain.store.values()][0]!.input.mode,'say_direct');
  await confirmAndComplete(h);assert.match(h.lastText(),/Варианты прямее/);assert.match(h.lastText(),/Что сохранено: Отказ/);
  await h.message('/menu');await h.click('До отправки');
  await h.message('Ты всегда опаздываешь!');await h.message('Коллега');await h.click('Коллеги');await h.click('Пропустить');await h.click('Помириться');
  const s=[...h.domain.store.values()].at(-1)!;assert.equal(s.input.mode,'before_send');assert.ok(!('message' in s.input));
  await confirmAndComplete(h);assert.match(h.lastText(),/Фразы \(это возможное восприятие/);
});

test('thread: ordered self/other turns with delete, guess, preview',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ветка переписки');
  await h.message('Сестра');await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');
  await h.message('без роли');assert.match(h.lastText(),/Сначала выбери, чья это реплика/);
  await h.click('+ Реплика собеседника');await h.message('Ты где?');
  await h.click('+ Моя реплика');await h.message('Ошибка');
  await h.click('Удалить последнюю');
  await h.click('+ Моя реплика');await h.message('Скоро буду');
  assert.match(h.lastText(),/1\. Собеседник: Ты где\?\n2\. Я: Скоро буду/);
  await h.click('Готово');await h.click('Не понимаю');
  const s=[...h.domain.store.values()][0]!;
  assert.equal(s.input.mode,'thread');
  assert.deepEqual(s.input.mode==='thread'&&s.input.turns.map(x=>[x.speaker,x.text]),[['other','Ты где?'],['self','Скоро буду']]);
  assert.match(h.lastText(),/Реплика собеседника[\s\S]*Моя реплика/);
});

test('examples: fictional catalogue goes through own guess and the normal preview',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Попробовать на примере');assert.match(h.lastText(),/вымышленную/);
  await h.click(/«Ок\.»/);
  assert.ok(h.messages().some(m=>m.text?.startsWith('Пример (вымышленный)')));
  assert.match(h.lastText(),/Сначала твоя версия/);
  await h.click('Не понимаю');assert.match(h.lastText(),/Так текст уйдёт в модель/);assert.equal(h.domain.runs.size,0);
});

test('danger: support scenario from the domain instead of the send button',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h,'Я убью тебя, если расскажешь');
  assert.match(h.lastText(),/может быть опасность/);assert.match(h.lastText(),/могу не распознать/);
  assert.ok(!h.last().buttons.some(b=>b.text==='Отправить в модель'));assert.equal(h.domain.runs.size,0);
});

test('history: shared pages of 5, context filter, open, delete with revision and confirmation',async()=>{
  const h=new Harness();await h.register();
  for(let i=0;i<7;i++){await understandToPreview(h,`Ситуация номер ${i}`);await confirmAndComplete(h);}
  await h.message('/history');assert.match(h.lastText(),/страница 1/);assert.match(h.lastText(),/Общая для бота и сайта/);
  assert.equal(h.last().buttons.filter(b=>/^\d\./.test(b.text)).length,5);
  await h.click('Дальше →');assert.match(h.lastText(),/страница 2/);
  await h.click('Коллеги');assert.match(h.lastText(),/В сфере «Коллеги» записей нет/);
  await h.click('Все сферы');await h.click(/^1\./);assert.match(h.lastText(),/Результат готов/);
  await h.click('Удалить');assert.match(h.lastText(),/Сообщения в этом чате Telegram останутся/);
  assert.equal(h.domain.store.size,7);await h.click('Да, удалить');assert.equal(h.domain.store.size,6);
});

test('practice of the day, cards, skills, idempotent completion',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Практика дня');
  assert.match(h.lastText(),/около 2 минут/);assert.match(h.lastText(),/не наказывает за пропуски/);
  const done=h.button('Выполнено');await h.callback(done);await h.callback(done);
  assert.equal(h.domain.completions.size,1);
  await h.message('/menu');await h.click('Ещё →');await h.click('Карточки');await h.click(/Уточнение/);
  assert.match(h.lastText(),/Пример:/);await h.click('Отметить пройденной');assert.match(h.lastText(),/пройденной/);
  await h.click('Все карточки');await h.click(/Уточнение/);await h.click('Попробовать');
  await h.message('Когда тебе удобно?');assert.match(h.lastText(),/Моя попытка/);
  await h.message('/menu');await h.click('Ещё →');await h.click('Навыки');
  assert.match(h.lastText(),/Уточнение: практик 2, последняя оценка попытки 1\/2/);assert.match(h.lastText(),/Процента эмпатии нет/);
});

test('assessment: series answers, result after the whole series, follow-up not due',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Тест до/после');
  await h.click('Повторный тест');assert.match(h.lastText(),/через 7 дней/);
  await h.click('Входной тест');assert.ok(h.messages().some(m=>/без рейтинга|не рейтинг/.test(m.text??'')));
  assert.match(h.lastText(),/Задание 1 из 3/);
  await h.click('1');assert.match(h.lastText(),/Задание 2 из 3/);
  await h.click('2');await h.click('1');
  assert.match(h.lastText(),/Результат входного теста/);assert.match(h.lastText(),/не оценка эмпатии/);assert.match(h.lastText(),/Повторный тест будет доступен/);
});

test('reminders: opt-in toggle, time, timezone and quiet hours validated; reminder delivery',async()=>{
  const h=new Harness();await h.register();
  await h.message('/account');await h.click('Напоминания');assert.match(h.lastText(),/Сейчас: выключены/);
  await h.click('Включить');assert.match(h.lastText(),/Сейчас: включены/);
  await h.click('Время');await h.message('25:00');assert.match(h.lastText(),/ЧЧ:ММ/);
  await h.message('08:30');assert.match(h.lastText(),/Время: 08:30/);
  await h.click('Часовой пояс');await h.message('Mars/Base');assert.match(h.lastText(),/не найден/);
  await h.message('Asia/Novosibirsk');assert.match(h.lastText(),/Asia\/Novosibirsk/);
  await h.click('Тихие часы');await h.message('23:00-07:00');assert.match(h.lastText(),/23:00–07:00/);
  h.domain.remind(h.account().id);await h.deliver();
  assert.match(h.lastText(),/Напоминание о практике дня/);assert.match(h.lastText(),/необязательно/);
});

test('web: bot-issued one-time link with warning, link preview disabled; sessions revoke',async()=>{
  const h=new Harness();await h.register();
  await h.message('/account');await h.click('Открыть веб');
  const m=h.last();assert.match(m.text!,/\/auth\/connect#token=/);assert.match(m.text!,/Не пересылай/);
  assert.deepEqual(m.body.link_preview_options,{is_disabled:true});
  await h.message('/account');await h.click('Веб-сессии');assert.match(h.lastText(),/Активные входы/);
  await h.click('Выйти на всех сайтах');assert.ok(h.domain.calls.includes('revokeAllWebSessions'));
});

test('account: delete learning data keeps the account; consent revoke gates learning; account deletion is separate',async()=>{
  const h=new Harness();await analysed(h);
  await h.message('/account');await h.click('Удалить учебные данные');
  assert.match(h.lastText(),/Аккаунт и почта останутся/);assert.match(h.lastText(),/только в самом Telegram/);
  await h.click('Да, удалить учебные данные');assert.equal(h.domain.store.size,0);assert.equal(h.domain.accounts.size,1);
  await h.message('/account');await h.click('Отозвать согласие');await h.click('Да, отозвать');assert.match(h.lastText(),/Перед началом/);
  await h.message('/account');await h.click('Удалить аккаунт');await h.click('Да, удалить аккаунт');assert.equal(h.domain.accounts.size,0);
});

test('delivery: blocked user → CHAT_UNAVAILABLE in the domain outbox, no endless resend',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  h.domain.complete(h.domain.pending()!.id);
  h.failNext=m=>m==='sendMessage'?{ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'}:null;
  await h.deliver();assert.deepEqual([...h.domain.deliveries.values()][0]!.failures,['CHAT_UNAVAILABLE']);
  const before=h.messages().length;await h.deliver();assert.equal(h.messages().length,before);
});

test('retry of a failed run passes the confirmed snapshot hash and revision of its preview',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  const failed=h.domain.pending()!;h.domain.failRun(failed.id);await h.deliver();
  const calls:unknown[]=[];const original=h.domain.retry.bind(h.domain);
  h.domain.retry=async(ctx,input,key)=>{calls.push(input);return original(ctx,input,key);};
  await h.click('Повторить');assert.match(h.lastText(),/Запрос принят/);
  const p=h.domain.previews.get(failed.previewId)!.preview;
  assert.deepEqual(calls,[{id:failed.id,previewId:p.id,previewRevision:p.revision,snapshotHash:p.snapshotHash,expectedRevision:failed.revision}]);
});

test('telegram client: bounded 429 wait; no token or URL in errors and logs',async()=>{
  let calls=0;const waits:number[]=[];
  const api=new TelegramApi(TOKEN,async()=>{calls++;return {json:async()=>({ok:false,error_code:429,description:'Too Many Requests',parameters:{retry_after:2}})};},async ms=>{waits.push(ms);});
  const error=await api.sendMessage('1','x').catch(e=>e);
  assert.ok(error instanceof TelegramError);assert.equal(calls,3);assert.deepEqual(waits,[2000,2000]);
  const unavailable=await new TelegramApi(TOKEN,async url=>{throw new Error(`fetch failed ${url}`);}).getMe().catch(e=>e);
  assert.ok(unavailable instanceof TelegramUnavailable);
  const logged:string[]=[];const original=console.error;console.error=(...a:unknown[])=>{logged.push(a.join(' '));};
  try{logError('poll',unavailable);logError('poll',error);logError('poll',new Error(`boom ${TOKEN}`));}finally{console.error=original;}
  assert.ok(logged.length===3&&logged.every(l=>!l.includes(TOKEN)&&!l.includes('api.telegram.org')));
});

test('transport lifecycle: identify without polling, start with lease, idempotent stop, finished, health',async()=>{
  assert.throws(()=>createTelegramTransport({token:'bad'}));
  const original=globalThis.fetch;const urls:string[]=[];
  globalThis.fetch=(async(url:string,init:{body:string;signal?:AbortSignal})=>{
    urls.push(url.split('/').at(-1)!);
    if(url.endsWith('/getMe'))return {json:async()=>({ok:true,result:{id:777,is_bot:true,first_name:'B',username:'between_test_bot'}})};
    if(url.endsWith('/getUpdates'))return new Promise(resolve=>{const done=()=>resolve({json:async()=>({ok:true,result:[]})});init.signal?.addEventListener('abort',done,{once:true});setTimeout(done,20);});
    return {json:async()=>({ok:true,result:true})};
  }) as unknown as typeof fetch;
  try{
    const transport=createTelegramTransport({token:TOKEN});
    assert.deepEqual(await transport.identify(),{botId:'777',username:'between_test_bot'});
    assert.ok(!urls.includes('getUpdates'),'identify never polls');
    const {FakeProduct}=await import('./fake-product.js');const domain=new FakeProduct();
    const leaseAbort=new AbortController();
    await transport.start(domain.asFacade(),{signal:leaseAbort.signal,release:async()=>{}});
    await new Promise(r=>setTimeout(r,60));
    assert.equal(transport.health().polling,true);
    await assert.rejects(transport.start(domain.asFacade(),{signal:leaseAbort.signal,release:async()=>{}}));
    leaseAbort.abort();
    await transport.finished;
    assert.equal(transport.health().polling,false);
    await transport.stop();await transport.stop();
    const dead=new AbortController();dead.abort();
    await assert.rejects(createTelegramTransport({token:TOKEN}).start(domain.asFacade(),{signal:dead.signal,release:async()=>{}}));
  }finally{globalThis.fetch=original;}
});

test('poller: offset from the domain cursor; fatal 409 ends polling',async()=>{
  const h=new Harness();const offsets:unknown[]=[];
  const tg=new TelegramApi(TOKEN,async(url,init)=>{
    if(url.endsWith('/getUpdates')){offsets.push(JSON.parse(init.body).offset);
      if(offsets.length===2)return {json:async()=>({ok:false,error_code:409,description:'Conflict'})};
      return {json:async()=>({ok:true,result:[{update_id:41,message:{message_id:1,date:0,chat:{id:-1,type:'group'},text:'hi'}}]})};}
    return {json:async()=>({ok:true,result:true})};
  });
  await assert.rejects(new Poller(tg,h.domain.asFacade(),h.flows,{timeoutSeconds:0,backoffMs:1,fatal:e=>e instanceof TelegramError&&e.status===409}).run(new AbortController().signal));
  assert.deepEqual(offsets,[0,42]);
});

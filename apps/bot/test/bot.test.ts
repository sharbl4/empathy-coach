import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BotHealth} from '@between/contracts/domain';
import {CALLBACK_LIMIT,decode,encode,intentKey} from '../src/callbacks.js';
import {classify} from '../src/identity.js';
import {Heartbeat,logError} from '../src/runtime.js';
import {TelegramApi,TelegramError,TelegramUnavailable} from '../src/telegram.js';
import {chunk,TELEGRAM_LIMIT} from '../src/text.js';
import {Harness,TOKEN} from './harness.js';

const UUID='123e4567-e89b-42d3-a456-426614174000';

async function understandToConfirm(h:Harness,message='Ок. Давай потом',user=42) {
  await h.message('/menu',{user});await h.click('Понять сообщение',user);
  await h.message(message,{user});await h.message('Друг',{user});
  await h.click('Пропустить',user);await h.click('Уточнить',user);
  await h.message('обида, усталость',{user});await h.message('Ок.',{user});
  await h.click('Готово',user);
}
async function analysed(h:Harness) {
  await h.register();await understandToConfirm(h);await h.click('Отправить в модель');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
}

test('callbacks fit the Bot API limit, junk is rejected, intent keys are stable UUIDs',()=>{
  const data=encode('hy',123456,UUID);
  assert.ok(Buffer.byteLength(data)<=CALLBACK_LIMIT);
  assert.deepEqual(decode(data),{op:'hy',version:123456,arg:UUID});
  for(const bad of [undefined,'','x','a|b|c|d','h o|-|','ho|-|привет','ho|-|'+'a'.repeat(70)])assert.equal(decode(bad),null);
  assert.equal(intentKey(UUID,'analyze',0),intentKey(UUID,'analyze',0));
  assert.notEqual(intentKey(UUID,'analyze',0),intentKey(UUID,'analyze',1));
  assert.match(intentKey('x'),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('chunk keeps text below the Telegram limit without losing words',()=>{
  const text=Array.from({length:900},(_,i)=>`Фраза ${i} <b>&amp;</b> *_[]`).join(' ')+'\n\n'+'я'.repeat(5000);
  const parts=chunk(text);
  assert.ok(parts.length>2);
  for(const p of parts)assert.ok(p.length<TELEGRAM_LIMIT);
  assert.equal(parts.join(' ').replace(/\s+/g,''),text.replace(/\s+/g,''));
});

test('identity: only matching private chat; groups, channels, bots, unsafe ids and inline callbacks are rejected',()=>{
  const from={id:42,is_bot:false,first_name:'T'};
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:42,type:'private'},from,text:'hi'}}).kind,'private');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:43,type:'private'},from,text:'hi'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:-1,type:'group'},from,text:'hi'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:-1,type:'supergroup'},from,text:'/start'}}).kind,'group_command');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:-1,type:'channel'},text:'post'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:42,type:'private'},from:{...from,is_bot:true},text:'x'}}).kind,'ignored');
  assert.equal(classify({update_id:1,message:{message_id:1,date:0,chat:{id:2**60,type:'private'},from:{...from,id:2**60},text:'x'}}).kind,'ignored');
  assert.equal(classify({update_id:1,callback_query:{id:'c',from,inline_message_id:'i',data:'m|-|u'}}).kind,'callback_rejected');
  assert.equal(classify({update_id:1,callback_query:{id:'c',from,message:{message_id:1,date:0,chat:{id:-5,type:'group'}},data:'m|-|u'}}).kind,'callback_rejected');
  const ok=classify({update_id:7,callback_query:{id:'c',from,message:{message_id:1,date:0,chat:{id:42,type:'private'}},data:'m|-|u'}});
  assert.deepEqual(ok.kind==='private'&&ok.identity,{telegramUserId:'42',privateChatId:'42',updateId:'7'});
});

test('inline callback with from.id but no chat calls no domain method except acknowledge',async()=>{
  const h=new Harness();
  await h.callback(encode('m',null,'u'),{chat:null});
  assert.deepEqual(h.domain.calls,['acknowledgeUpdate']);
  assert.equal(h.domain.accounts.size,0);
  assert.equal(h.messages().length,0);
});

test('groups: short hint on commands only, nothing stored, offset advances',async()=>{
  const h=new Harness();
  await h.message('Привет всем',{chat:{id:-100,type:'supergroup'}});
  assert.equal(h.messages().length,0);
  await h.message('/start',{chat:{id:-100,type:'supergroup'}});
  assert.match(h.lastText(),/только в личном чате/);
  assert.deepEqual([...new Set(h.domain.calls)],['acknowledgeUpdate']);
  assert.equal(h.domain.accounts.size,0);
  assert.equal(h.domain.offset>0,true);
});

test('registration: greeting, consent, gated menu, wrong code, verified, onboarding',async()=>{
  const h=new Harness();
  await h.message('/start');
  assert.ok(h.messages().some(m=>m.text?.includes('Несколько возможных трактовок. Мысли не читаем.')));
  assert.ok(!h.messages().some(m=>/парол.*введи|https?:\/\//i.test(m.text??'')));
  await h.message('/history');
  assert.match(h.lastText(),/Перед началом/);
  await h.click('Принимаю, продолжить');
  assert.equal([...h.domain.accounts.values()][0]!.consentVersion,'telegram-1');
  await h.message('not-an-email');assert.match(h.lastText(),/не похоже на адрес/);
  await h.message('me@example.com');assert.match(h.lastText(),/m\*\*\*@example\.com/);
  await h.message('12345');assert.match(h.lastText(),/6 цифр/);
  await h.message(h.domain.lastCode==='000000'?'111111':'000000');assert.match(h.lastText(),/Код не подошёл/);
  await h.message(h.domain.lastCode);
  assert.ok(h.messages().some(m=>m.text==='Почта подтверждена.'));
  assert.match(h.lastText(),/Главное меню/);
  assert.ok([...h.domain.accounts.values()][0]!.onboardingCompletedAt);
});

test('understand: steps → exact confirmation → no model call before confirm → analysis with clarify from saved result',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('Ок. Давай потом');await h.message('Друг');
  await h.click('Назад');assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('Друг');await h.click('Пропустить');await h.click('Уточнить');
  await h.message('обида, усталость');
  await h.message('Перезвони');assert.match(h.lastText(),/Такой цитаты нет/);
  await h.message('Ок.');await h.click('Готово');
  assert.match(h.lastText(),/Так текст уйдёт в модель/);
  assert.match(h.lastText(),/Сообщение:\nОк\. Давай потом/);
  assert.match(h.lastText(),/скрытие телефонов и почт пока не подключено/);
  assert.equal(h.domain.runs.size,0,'no run before confirmation');
  await h.click('Отправить в модель');
  assert.match(h.lastText(),/Запрос принят/);
  const run=h.domain.pending()!;assert.equal(run.kind,'analysis');
  const session=[...h.domain.store.values()][0]!.detail;
  assert.deepEqual(session.guess,{emotions:['обида','усталость'],evidenceQuotes:['Ок.'],unsure:false});
  h.domain.complete(run.id);await h.deliver();
  for(const label of ['Как уточнить?','Написать ответ','Упражнение','Потренировать разговор','В меню'])assert.ok(h.last().buttons.some(b=>b.text===label),label);
  assert.match(h.lastText(),/гипотезы, не факты/);
  await h.click('Как уточнить?');
  assert.match(h.lastText(),/Во сколько завтра удобно\?/);
  assert.equal(h.domain.modelCalls,1,'clarifying question comes from the saved analysis');
});

test('duplicates: redelivered update, completed receipt and double click create one analysis',async()=>{
  const h=new Harness();await h.register();await understandToConfirm(h);
  const send=h.button('Отправить в модель');
  await h.callback(send,{updateId:7777});
  await h.callback(send,{updateId:7777});
  await h.callback(send);
  assert.equal(h.domain.runs.size,1);
  assert.equal(h.domain.store.size,1);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
});

test('crash-resume: transient failure leaves the update unacknowledged; retry uses the same intent and creates one run',async()=>{
  const h=new Harness();await h.register();await understandToConfirm(h);
  const send=h.button('Отправить в модель');
  h.domain.transient.set('analysis',1);
  const first=await h.callback(send,{updateId:8888});
  assert.equal(first,false,'not acknowledged');
  assert.equal(h.domain.receipts.get('8888')!.status,'processing');
  assert.equal(h.domain.store.size,1,'session committed before the failure');
  const second=await h.callback(send,{updateId:8888});
  assert.equal(second,true);
  assert.equal(h.domain.store.size,1,'same intent key → same session');
  assert.equal(h.domain.runs.size,1);
  assert.equal(h.domain.receipts.get('8888')!.status,'completed');
});

test('transient failures are bounded: after 3 attempts the user is told and the update is acknowledged',async()=>{
  const h=new Harness();await h.register();
  h.domain.transient.set('dialogue',3);
  const id=5555;
  assert.equal(await h.message('/menu',{updateId:id}),false);
  assert.equal(await h.message('/menu',{updateId:id}),false);
  assert.equal(await h.message('/menu',{updateId:id}),true);
  assert.match(h.lastText(),/Что-то пошло не так/);
});

test('edit invalidates confirmation: old send button is stale and generates nothing',async()=>{
  const h=new Harness();await h.register();await understandToConfirm(h);
  const oldSend=h.button('Отправить в модель');
  await h.click('Изменить');
  assert.match(h.lastText(),/Пришли сообщение/);
  await h.callback(oldSend);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
  assert.equal(h.domain.runs.size,0);
});

test('ownership: forged callbacks with another account session/run ids reveal nothing',async()=>{
  const h=new Harness();await h.register(1);await h.register(2);
  await understandToConfirm(h,'Секрет первого',1);await h.click('Отправить в модель',1);
  const sid=[...h.domain.store.keys()][0]!,runId=h.domain.pending()!.id;
  for(const [op,arg] of [['ho',sid],['ha',sid],['hd',sid],['rw',sid],['xs',sid],['rp',sid],['cl',runId],['rt',runId],['xa',runId]] as const)await h.callback(encode(op,null,arg),{user:2});
  const toUser2=h.messages().filter(m=>m.chat_id==='2').map(m=>m.text).join('\n');
  assert.doesNotMatch(toUser2,/Секрет первого/);
  assert.match(h.lastText(),/нет или она удалена/);
  assert.equal(h.domain.store.size,1);
  assert.equal(h.domain.runs.size,1);
});

test('stale and junk buttons give «Этот шаг уже завершён» and the menu',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  const cancel=h.button('Отмена');
  await h.message('текст');
  await h.callback(cancel);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
  assert.ok(h.last().buttons.some(b=>b.text==='История'));
  await h.callback('garbage|data');
  assert.match(h.lastText(),/Этот шаг уже завершён/);
});

test('limits keep the draft; special characters are sent as plain text; non-text; /cancel',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('х'.repeat(6001));assert.match(h.lastText(),/6001 символов, можно до 6000/);
  const special='<script>alert(1)</script> & *bold* _x_ [a](b)';
  await h.message(special);assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('я'.repeat(201));assert.match(h.lastText(),/до 200/);
  const ctx=[...h.domain.accounts.values()][0]!.id;
  assert.equal(h.domain.dialogues.get(ctx)!.draft.message,special);
  await h.push(h.update({message:{message_id:2,date:0,chat:{id:42,type:'private'},from:{id:42,is_bot:false,first_name:'Т'}}}));
  assert.match(h.lastText(),/только текст/);
  assert.ok(h.sent.every(s=>!('parse_mode' in s)));
  await h.message('/cancel');assert.match(h.lastText(),/черновик удалён/);
  assert.equal(h.domain.dialogues.get(ctx)!.stage,'menu');
});

test('restart: a new process continues the saved step from the database',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');await h.message('До рестарта');
  const restarted=new Harness(h.domain);
  await restarted.message('Коллега');
  assert.match(restarted.lastText(),/Что было до этого/);
  const ctx=[...h.domain.accounts.values()][0]!.id;
  assert.equal(h.domain.dialogues.get(ctx)!.draft.message,'До рестарта');
});

test('model failure: clear message, history still works, explicit retry, delivery never generates',async()=>{
  const h=new Harness();await h.register();await understandToConfirm(h);await h.click('Отправить в модель');
  h.domain.failRun(h.domain.pending()!.id,'MODEL_UNAVAILABLE');await h.deliver();
  assert.match(h.lastText(),/Модель сейчас недоступна/);
  await h.message('/history');assert.match(h.lastText(),/История · страница 1/);
  await h.click('Повторить');assert.match(h.lastText(),/Запрос принят/);
  assert.equal(h.domain.runs.size,2);
  await h.deliver();await h.deliver();
  assert.equal(h.domain.runs.size,2);
  assert.equal(h.domain.modelCalls,0);
});

test('reply: own draft first, confirmation, numbered phrases with words, examples on demand',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Написать ответ');assert.match(h.lastText(),/Сначала свой вариант/);
  await h.message('Ты опять пропал. Во сколько?');
  assert.match(h.lastText(),/Так текст уйдёт в модель/);
  assert.equal(h.domain.pending(),undefined);
  await h.click('Отправить в модель');
  assert.equal(h.domain.pending()!.kind,'reply_feedback');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/1\. 🟡 обрати внимание\n«Во сколько\?»/);
  assert.match(h.lastText(),/Сильные стороны черновика/);
  await h.click('Другой черновик');await h.click('Нужен пример');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Поддержать:[\s\S]*Уточнить:[\s\S]*Помириться:[\s\S]*Обозначить границу:/);
});

test('exercise: task → attempt → confirmation → feedback with the server exercise run id',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Упражнение');h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Упражнение \(30–60 секунд\)/);
  await h.message('Во сколько тебе удобно?');await h.click('Отправить в модель');
  assert.equal(h.domain.pending()!.kind,'exercise_feedback');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Что улучшить/);
});

test('roleplay: counter 1/3, finish only after the first answer, final feedback',async()=>{
  const h=new Harness();await analysed(h);
  await h.click('Потренировать разговор');h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Твой ответ 1 из 3/);
  assert.ok(!h.last().buttons.some(b=>b.text.startsWith('Завершить')));
  await h.message('Извини, давай обсудим.');await h.click('Отправить в модель');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Твой ответ 2 из 3/);
  await h.click('Завершить (1/3)');
  assert.equal(h.domain.pending()!.kind,'roleplay_feedback');
  h.domain.complete(h.domain.pending()!.id);await h.deliver();
  assert.match(h.lastText(),/Итог тренировки/);
});

test('say direct: own feeling/need/request, situation, own attempt first, say_direct run',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Сказать прямо');
  assert.match(h.lastText(),/свои чувства и потребности/);
  await h.message('Обида');await h.message('Чтобы меня предупреждали');await h.message('Пиши, если опаздываешь');
  await h.message('Друг опоздал на час без предупреждения');await h.message('Друг');
  await h.click('Пропустить');await h.click('Обозначить границу');
  assert.match(h.lastText(),/Сначала попробуй сам/);
  await h.message('Мне неприятно ждать без предупреждения');
  assert.match(h.lastText(),/Что я чувствую:\nОбида/);
  assert.match(h.lastText(),/Моя формулировка:\nМне неприятно/);
  await h.click('Отправить в модель');
  const run=h.domain.pending()!;assert.equal(run.kind,'say_direct');
  const s=[...h.domain.store.values()][0]!.detail;assert.equal(s.guess.unsure,true);
  h.domain.complete(run.id);await h.deliver();
  assert.match(h.lastText(),/Как сказать о себе прямо/);
  assert.match(h.lastText(),/не определение чьих-то намерений/);
});

test('history: pages of 5, open, delete with a separate confirmation',async()=>{
  const h=new Harness();await h.register();
  for(let i=0;i<7;i++){await understandToConfirm(h,`Ситуация номер ${i}`);await h.click('Отправить в модель');h.domain.complete(h.domain.pending()!.id);await h.deliver();}
  await h.message('/history');
  assert.match(h.lastText(),/страница 1/);
  assert.equal(h.last().buttons.filter(b=>/^\d\./.test(b.text)).length,5);
  await h.click('Дальше →');assert.match(h.lastText(),/страница 2/);
  await h.click(/^6\./);assert.match(h.lastText(),/Результат готов/);
  await h.click('Удалить');assert.match(h.lastText(),/Сообщения в этом чате Telegram останутся/);
  assert.equal(h.domain.store.size,7);
  await h.click('Да, удалить');
  assert.equal(h.domain.store.size,6);
});

test('account: delete learning data keeps the account; consent revoke gates learning; account deletion is separate',async()=>{
  const h=new Harness();await analysed(h);
  await h.message('/account');assert.match(h.lastText(),/Почта: подтверждена/);
  await h.click('Удалить учебные данные');
  assert.match(h.lastText(),/Аккаунт и почта останутся/);
  assert.match(h.lastText(),/только в самом Telegram/);
  await h.click('Да, удалить учебные данные');
  assert.equal(h.domain.store.size,0);
  assert.equal(h.domain.accounts.size,1);
  await h.message('/account');await h.click('Отозвать согласие');await h.click('Да, отозвать');
  assert.match(h.lastText(),/Перед началом/);
  await h.message('/history');assert.match(h.lastText(),/Перед началом/);
  await h.message('/account');await h.click('Удалить аккаунт');await h.click('Да, удалить аккаунт');
  assert.equal(h.domain.accounts.size,0);
});

test('delivery: blocked user → CHAT_UNAVAILABLE in the domain outbox, no endless resend',async()=>{
  const h=new Harness();await h.register();await understandToConfirm(h);await h.click('Отправить в модель');
  h.domain.complete(h.domain.pending()!.id);
  h.failNext=m=>m==='sendMessage'?{ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'}:null;
  await h.deliver();
  const d=[...h.domain.deliveries.values()][0]!;
  assert.deepEqual(d.failures,['CHAT_UNAVAILABLE']);
  const before=h.messages().length;await h.deliver();assert.equal(h.messages().length,before);
});

test('telegram client: bounded 429 wait, no token or URL in errors and logs',async()=>{
  let calls=0;const waits:number[]=[];
  const api=new TelegramApi(TOKEN,async()=>{calls++;return {json:async()=>({ok:false,error_code:429,description:'Too Many Requests',parameters:{retry_after:2}})};},async ms=>{waits.push(ms);});
  const error=await api.sendMessage('1','x').catch(e=>e);
  assert.ok(error instanceof TelegramError);assert.equal(calls,3);assert.deepEqual(waits,[2000,2000]);
  const down=new TelegramApi(TOKEN,async url=>{throw new Error(`fetch failed ${url}`);});
  const unavailable=await down.getMe().catch(e=>e);
  assert.ok(unavailable instanceof TelegramUnavailable);
  const logged:string[]=[];const original=console.error;console.error=(...a:unknown[])=>{logged.push(a.join(' '));};
  try{logError('poll',unavailable);logError('poll',error);logError('poll',new Error(`boom ${TOKEN}`));}finally{console.error=original;}
  assert.ok(logged.length===3&&logged.every(l=>!l.includes(TOKEN)&&!l.includes('api.telegram.org')));
  assert.ok(!String(unavailable.message).includes(TOKEN));
});

test('heartbeat: atomic private file valid against BotHealth, no ids or text',async()=>{
  const h=new Harness();const dir=mkdtempSync(join(tmpdir(),'bot-health-')),file=join(dir,'h.json');
  try{
    h.poller.polling=true;await new Heartbeat(file,h.domain,h.poller).beat();
    const raw=readFileSync(file,'utf8'),health=BotHealth.parse(JSON.parse(raw));
    assert.equal(health.polling,true);assert.equal(health.pollerLease,true);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['database','heartbeatAt','pid','pollerLease','polling']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('poller loop: offset comes from the domain cursor and stops on abort',async()=>{
  const h=new Harness();const offsets:unknown[]=[];const stop=new AbortController();
  const tg=new TelegramApi(TOKEN,async(url,init)=>{
    if(url.endsWith('/getUpdates')){offsets.push(JSON.parse(init.body).offset);if(offsets.length===2)stop.abort();
      return {json:async()=>({ok:true,result:offsets.length===1?[{update_id:41,message:{message_id:1,date:0,chat:{id:-1,type:'group'},text:'hi'}}]:[]})};}
    return {json:async()=>({ok:true,result:true})};
  });
  const {Poller}=await import('../src/runtime.js');
  await new Poller(tg,h.domain,h.flows,{timeoutSeconds:0,backoffMs:1}).run(stop.signal);
  assert.deepEqual(offsets,[0,42]);
});

test('free text in the menu offers both modes without putting text into callback_data',async()=>{
  const h=new Harness();await h.register();
  await h.message('Как скажешь)');
  assert.match(h.lastText(),/Что сделать с этим текстом/);
  for(const b of h.last().buttons)assert.doesNotMatch(b.data,/скажешь/);
  await h.click('Понять сообщение');assert.match(h.lastText(),/Кто тебе этот человек/);
});

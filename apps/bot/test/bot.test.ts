import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CALLBACK_LIMIT,decode,encode,intentKey} from '../src/callbacks.js';
import {ConfigError,loadConfig} from '../src/config.js';
import {chunk,TELEGRAM_LIMIT} from '../src/text.js';
import {retryAfter} from '../src/telegram.js';
import {Harness} from './harness.js';

const UUID='123e4567-e89b-42d3-a456-426614174000';

/** Walks «Понять сообщение» up to the preview. */
async function understandToPreview(h:Harness,message='Ок. Позвони мне: +7 999 123-45-67',user=42) {
  await h.message('/menu',{user});await h.click('Понять сообщение',user);
  await h.message(message,{user});
  await h.message('Друг',{user});
  await h.click('Близкие',user);
  await h.click('Пропустить',user);
  await h.click('Уточнить',user);
  await h.message('обида, усталость',{user});
  await h.message('Ок.',{user});
  await h.click('Готово',user);
}

test('config: empty or malformed token is a configuration error',()=>{
  assert.throws(()=>loadConfig({}),ConfigError);
  assert.throws(()=>loadConfig({TELEGRAM_BOT_TOKEN:'  '}),ConfigError);
  assert.throws(()=>loadConfig({TELEGRAM_BOT_TOKEN:'nope'}),ConfigError);
  assert.equal(loadConfig({TELEGRAM_BOT_TOKEN:'123:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NODE_ENV:'production'}).production,true);
});

test('callbacks: fit Bot API limit, reject junk, keys are stable UUIDs',()=>{
  const data=encode('hy',123456,UUID);
  assert.ok(Buffer.byteLength(data)<=CALLBACK_LIMIT);
  assert.deepEqual(decode(data),{op:'hy',version:123456,arg:UUID});
  for(const bad of [undefined,'','x','a|b|c|d','h o|-|','ho|-|привет','ho|-|'+'a'.repeat(70)])assert.equal(decode(bad),null);
  assert.equal(intentKey('42',3,'pv'),intentKey('42',3,'pv'));
  assert.notEqual(intentKey('42',3,'pv'),intentKey('42',4,'pv'));
  assert.match(intentKey('x'),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('chunk: long text splits below Telegram limit without losing words',()=>{
  const text=Array.from({length:900},(_,i)=>`Фраза ${i} <b>&amp;</b> *_[]`).join(' ')+'\n\n'+'я'.repeat(5000);
  const parts=chunk(text);
  assert.ok(parts.length>2);
  for(const p of parts)assert.ok(p.length<TELEGRAM_LIMIT);
  assert.equal(parts.join(' ').replace(/\s+/g,''),text.replace(/\s+/g,''));
});

test('registration: greeting, gated menu, wrong code, verified',async()=>{
  const h=new Harness();
  await h.message('/start');
  assert.ok(h.messages().some(m=>m.text?.includes('Несколько возможных трактовок. Мысли не читаем.')));
  assert.ok(!h.messages().some(m=>/парол.*введи|https?:\/\//i.test(m.text??'')));
  await h.message('/history');
  assert.match(h.lastText(),/Перед началом/);
  await h.click('Понятно, продолжить');
  await h.message('not-an-email');
  assert.match(h.lastText(),/не похоже на адрес/);
  await h.message('me@example.com');
  assert.match(h.lastText(),/m\*\*\*@example\.com/);
  await h.message('000000');
  assert.match(h.lastText(),/Осталось попыток: 4/);
  await h.message('/menu');
  assert.match(h.lastText(),/Введи код/);
  await h.message(h.domain.lastCode);
  assert.match(h.lastText(),/Почта подтверждена/);
  assert.ok(h.last().buttons.some(b=>b.text==='Понять сообщение'));
});

test('groups: short hint on commands, nothing stored or analysed',async()=>{
  const h=new Harness();
  await h.message('Привет всем',{chat:{id:-100,type:'supergroup',title:'g'}});
  assert.equal(h.messages().length,0);
  await h.message('/start',{chat:{id:-100,type:'supergroup',title:'g'}});
  assert.match(h.lastText(),/только в личном чате/);
  assert.equal(h.domain.inbox.size,0);
  assert.equal(h.domain.accounts.size,0);
});

test('understand: steps → masked preview → no model call before confirm → result',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('Ок. Позвони мне: +7 999 123-45-67');
  await h.message('Друг');
  await h.click('Назад');assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('Друг');
  await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');
  await h.message('обида, усталость');
  await h.message('Перезвони');
  assert.match(h.lastText(),/Такой цитаты нет/);
  await h.message('Ок.');await h.click('Готово');
  const preview=h.lastText();
  assert.match(preview,/Так текст уйдёт в модель/);
  assert.match(preview,/\[телефон скрыт\]/);
  assert.doesNotMatch(preview,/999 123/);
  assert.match(preview,/не гарантия анонимности/);
  assert.equal(h.domain.runs.size,0,'no run before confirmation');
  await h.click('Отправить в модель');
  assert.match(h.lastText(),/Запрос принят/);
  const run=h.domain.pendingRun()!;
  h.domain.complete(run.id,{literalMeaning:'Согласие.',interpretations:[
    {emotion:'Спокойствие',possibleNeed:'Закрыть вопрос',explanation:'Короткий ответ.',evidenceQuotes:['Ок.'],evidenceLevel:'text'},
    {emotion:'Обида',possibleNeed:'Внимание',explanation:'Может быть.',evidenceQuotes:[],evidenceLevel:'insufficient'}],
    uncertainty:'Тон неизвестен.',clarifyingQuestion:'Тебе удобно так?',guessFeedback:'Ты заметил краткость.',skillTip:'Уточняй.',
    comparison:{matches:['обида'],alternatives:['спокойствие'],toClarify:['тон']}});
  await h.deliver();
  const out=h.lastText();
  assert.match(out,/есть текстовые основания/);
  assert.match(out,/данных недостаточно/);
  assert.match(out,/Где совпало: обида/);
  assert.match(out,/не означает «правильно»/);
  assert.doesNotMatch(out,/%/);
  for(const label of ['Как уточнить?','Полезно','Написать ответ','Упражнение','Потренировать разговор','В меню'])assert.ok(h.last().buttons.some(b=>b.text===label),label);
  await h.click('Как уточнить?');
  assert.match(h.lastText(),/Тебе удобно так\?/);
  assert.equal(h.domain.modelCalls,1,'clarifying question comes from saved analysis');
  await h.click('Полезно');await h.click('Полезно');await h.click('Не полезно');
  assert.equal(h.domain.ratings.size,1);
  assert.equal([...h.domain.ratings.values()][0],'not_useful');
});

test('duplicates: redelivered update and double click do not create a second analysis',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  const send=h.button('Отправить в модель');
  await h.callback(send,{updateId:7777});
  await h.callback(send,{updateId:7777});
  await h.callback(send);
  assert.equal(h.domain.runs.size,1);
  assert.equal(h.domain.sessionsById.size,1);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
});

test('edit preview: new preview, old send button is stale and sends nothing',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  const oldSend=h.button('Отправить в модель');
  await h.click('Редактировать');await h.click('Собеседник');
  await h.message('Сестра');
  assert.match(h.lastText(),/Собеседник:\nСестра/);
  await h.callback(oldSend);
  assert.match(h.lastText(),/Этот шаг уже завершён/);
  assert.equal(h.domain.runs.size,0);
  await h.click('Отправить в модель');
  assert.equal(h.domain.runs.size,1);
});

test('ownership: forged callback with another user session id shows nothing',async()=>{
  const h=new Harness();await h.register(1);await h.register(2);
  await understandToPreview(h,'Секрет первого',1);
  await h.click('Отправить в модель',1);
  const sid=[...h.domain.sessionsById.keys()][0]!;
  for(const op of ['ho','ha','hd','rw','xs','rp'])await h.callback(encode(op,null,sid),{user:2});
  const toUser2=h.messages().filter(m=>String(m.chat_id)==='2').map(m=>m.text).join('\n');
  assert.doesNotMatch(toUser2,/Секрет первого/);
  assert.match(h.lastText(),/нет или она удалена/);
  assert.equal(h.domain.sessionsById.size,1);
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

test('input limits keep the draft; non-text and /cancel',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('х'.repeat(6001));
  assert.match(h.lastText(),/6001 символов, можно до 6000/);
  await h.message('Нормальный текст <script> & *bold*');
  assert.match(h.lastText(),/Кто тебе этот человек/);
  await h.message('я'.repeat(201));
  assert.match(h.lastText(),/до 200/);
  const st=await h.domain.state({telegramId:'42'});
  assert.equal((st.payload.d as {message:string}).message,'Нормальный текст <script> & *bold*');
  await h.bot.handleUpdate({update_id:99999,message:{message_id:2,date:0,chat:{id:42,type:'private',first_name:'Т'},from:{id:42,is_bot:false,first_name:'Т'},sticker:{} as never}});
  assert.match(h.lastText(),/только текст/);
  await h.message('/cancel');
  assert.match(h.lastText(),/черновик удалён/);
  assert.equal((await h.domain.state({telegramId:'42'})).name,'idle');
  assert.ok(h.domain.events.includes('flow_cancelled'));
});

test('restart: a new bot process continues the saved step',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Понять сообщение');await h.message('До рестарта');
  const restarted=new Harness(h.domain);
  await restarted.message('Коллега');
  assert.match(restarted.lastText(),/К какой сфере/);
  const st=await h.domain.state({telegramId:'42'});
  assert.equal((st.payload.d as {message:string}).message,'До рестарта');
});

test('model offline: clear error, menu and history keep working, failed run offers retry',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  h.domain.modelOnline=false;
  await h.click('Отправить в модель');
  assert.match(h.lastText(),/Модель сейчас недоступна/);
  await h.message('/history');
  assert.match(h.lastText(),/История/);
  h.domain.modelOnline=true;
  await h.click(/^1\./);
  await h.click('Запустить разбор');
  const run=h.domain.pendingRun()!;h.domain.fail(run.id,'MODEL_TIMEOUT');
  await h.deliver();
  assert.match(h.lastText(),/не ответила вовремя/);
  await h.click('Повторить');
  assert.match(h.lastText(),/Запрос принят/);
  assert.equal(h.domain.runs.size,2);
  await h.deliver();
  assert.equal(h.domain.runs.size,2,'delivery never generates');
});

test('reply: own draft first, heatmap phrases with words and «Почему?», examples on demand',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  await h.click('Отправить в модель');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  await h.click('Написать ответ');
  assert.match(h.lastText(),/Сначала свой вариант/);
  await h.message('Ты опять пропал. Во сколько?');
  assert.match(h.lastText(),/Так текст уйдёт в модель/);
  await h.click('Отправить в модель');
  h.domain.complete(h.domain.pendingRun()!.id,{strengths:['Есть вопрос.'],phraseFeedback:[
    {quote:'Ты опять пропал.',possibleImpact:'Может прозвучать как обобщение.',suggestion:'Я скучал, давно не слышались.',tone:'risky',why:'«Опять» обобщает.',softer:'Давно тебя не слышно.'},
    {quote:'Во сколько?',possibleImpact:'Коротко.',suggestion:'Во сколько тебе удобно?',tone:'caution'}],revisedReply:'Давно не слышались. Во сколько тебе удобно?',options:(await import('@between/contracts/fixtures')).outputFixtures.reply_examples});
  await h.deliver();
  const out=h.lastText();
  assert.match(out,/1\. 🟠 стоит пересмотреть\n«Ты опять пропал\.»/);
  assert.match(out,/2\. 🟡 может прозвучать двояко/);
  assert.match(out,/Сильные стороны черновика/);
  await h.click('1: Почему?');
  assert.match(h.lastText(),/«Опять» обобщает/);
  await h.click('1: Вариант мягче');
  assert.match(h.lastText(),/Давно тебя не слышно/);
  await h.click('Другой черновик');await h.click('Нужен пример');
  h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Поддержать:[\s\S]*Уточнить:[\s\S]*Помириться:[\s\S]*Обозначить границу:/);
});

test('exercise: task → attempt → preview → feedback',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  await h.click('Отправить в модель');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  await h.click('Упражнение');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Упражнение \(30–60 секунд\)/);
  await h.message('Во сколько тебе удобно?');await h.click('Отправить в модель');
  h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Что улучшить/);
});

test('roleplay: level choice, 1/3 counter, early finish, final feedback',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);
  await h.click('Отправить в модель');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  await h.click('Потренировать разговор');
  for(const l of ['Спокойный','Обиженный','Раздражённый'])assert.ok(h.last().buttons.some(b=>b.text===l));
  await h.click('Обиженный');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Твой ответ 1 из 3/);
  assert.ok(!h.last().buttons.some(b=>b.text.startsWith('Завершить')),'finish only after first answer');
  await h.message('Извини, давай обсудим.');await h.click('Отправить в модель');
  h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Твой ответ 2 из 3/);
  await h.click('Завершить (1/3)');
  h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Итог тренировки/);
  assert.match(h.lastText(),/Следующий навык/);
});

test('direct: phrase → intent → goal → own attempt first → variants, repeat with another goal',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Сказать прямо');
  await h.message('Ну я не знаю, может, как-нибудь потом');
  await h.message('Отказаться от встречи в субботу');
  await h.click('Пропустить');await h.click('Обозначить границу');
  assert.match(h.lastText(),/Сначала попробуй сам/);
  await h.message('Я не приду в субботу');
  assert.match(h.lastText(),/Моя формулировка:\nЯ не приду/);
  await h.click('Отправить в модель');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();
  assert.match(h.lastText(),/Варианты прямее/);
  assert.match(h.lastText(),/не определение чьих-то намерений/);
  await h.click('С другой целью');await h.click('Поддержать');
  assert.match(h.lastText(),/Цель: Поддержать/);
  assert.match(h.lastText(),/Фраза|Текст/);
});

test('examples: fictional catalog goes through the normal pipeline',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Попробовать на примере');
  assert.match(h.lastText(),/вымышленную/);
  await h.click('«Ок.»');
  assert.ok(h.messages().some(m=>m.text?.startsWith('Пример (вымышленный)')));
  assert.match(h.lastText(),/Чего хочешь добиться/);
  await h.click('Поддержать');await h.click('Не понимаю');
  assert.match(h.lastText(),/Моя версия: не понимаю/);
  await h.click('Отправить в модель');
  assert.equal(h.domain.runs.size,1);
  assert.ok(h.domain.events.includes('example_selected'));
});

test('danger: support scenario instead of normal analysis',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h,'Я убью тебя, если расскажешь');
  assert.match(h.lastText(),/может быть угроза/);
  assert.doesNotMatch(h.lastText(),/\d{3}/,'no generated phone numbers');
  assert.equal(h.domain.runs.size,0);
});

test('history: pages of 5, open, delete with separate confirmation',async()=>{
  const h=new Harness();await h.register();
  for(let i=0;i<7;i++){await understandToPreview(h,`Ситуация номер ${i}`);await h.click('Отправить в модель');h.domain.complete(h.domain.pendingRun()!.id);await h.deliver();}
  await h.message('/history');
  assert.match(h.lastText(),/страница 1/);
  assert.equal(h.last().buttons.filter(b=>/^\d\./.test(b.text)).length,5);
  await h.click('Дальше →');
  assert.match(h.lastText(),/страница 2/);
  await h.click(/^6\./);
  assert.match(h.lastText(),/Разбор готов/);
  await h.click('Удалить');
  assert.match(h.lastText(),/Сообщения в этом чате Telegram останутся/);
  assert.equal(h.domain.sessionsById.size,7);
  await h.click('Да, удалить');
  assert.equal(h.domain.sessionsById.size,6);
});

test('account: delete learning data keeps account; delete account is separate',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  await h.message('/account');
  assert.match(h.lastText(),/подтверждена/);
  await h.click('Удалить учебные данные');
  assert.match(h.lastText(),/Аккаунт и почта останутся/);
  assert.match(h.lastText(),/только в самом Telegram/);
  await h.click('Да, удалить учебные данные');
  assert.equal(h.domain.sessionsById.size,0);
  assert.equal(h.domain.accounts.get('42')?.status,'verified');
  await h.message('/account');await h.click('Удалить аккаунт');await h.click('Да, удалить аккаунт');
  assert.equal(h.domain.accounts.has('42'),false);
});

test('delivery: blocked user is not retried forever',async()=>{
  const h=new Harness();await h.register();await understandToPreview(h);await h.click('Отправить в модель');
  const run=h.domain.pendingRun()!;h.domain.complete(run.id);
  h.failNext=m=>m==='sendMessage'?{error_code:403,description:'Forbidden: bot was blocked by the user'}:null;
  await h.deliver();
  assert.equal(h.domain.runs.get(run.id)!.undeliverable,true);
  const before=h.messages().length;await h.deliver();
  assert.equal(h.messages().length,before);
});

test('429: bounded wait on retry_after, then gives up',async()=>{
  const waits:number[]=[];let calls=0;
  const transformer=retryAfter(async ms=>{waits.push(ms);});
  const prev=(async()=>{calls++;return {ok:false,error_code:429,description:'Too Many Requests',parameters:{retry_after:2}};}) as never;
  const result=await transformer(prev,'sendMessage' as never,{} as never);
  assert.equal(calls,3);
  assert.deepEqual(waits,[2000,2000]);
  assert.equal((result as {ok:boolean}).ok,false);
  calls=0;
  await retryAfter(async()=>{throw new Error('must not wait');})((async()=>{calls++;return {ok:false,error_code:429,description:'x',parameters:{retry_after:600}};}) as never,'sendMessage' as never,{} as never);
  assert.equal(calls,1);
});

test('free text in menu offers both modes without putting text into callback_data',async()=>{
  const h=new Harness();await h.register();
  await h.message('Как скажешь)');
  assert.match(h.lastText(),/Что сделать с этим текстом/);
  for(const b of h.last().buttons)assert.doesNotMatch(b.data,/скажешь/);
  await h.click('Понять сообщение');
  assert.match(h.lastText(),/Кто тебе этот человек/);
});

// PREPARED, NOT YET RUN BY CI: the file name is not *.test.ts on purpose (no skipped tests in the gate).
// These scenarios describe recovery of unfinished steps after a transport restart and the support region choice.
// They need durable fields the contract does not have yet (Anton is updating it). After the contract is published:
// 1) store these values through the domain (DialogueV2 / account), not in Flows memo;
// 2) rename this file to restart-recovery.test.ts and adapt FakeProduct to the new fields.
// Run manually now to see the expected failures: npx tsx --test apps/bot/test/restart-recovery.pending.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harness} from './harness.js';

async function analysedPreview(h:Harness) {
  await h.register();
  await h.message('/menu');await h.click('Понять сообщение');
  await h.message('Ок. Позвони: +7 999 123-45-67');await h.message('Друг');
  await h.click('Близкие');await h.click('Пропустить');await h.click('Уточнить');await h.click('Не понимаю');
}

test('preview field edit survives restart: the chosen field is still being edited',async()=>{
  const h=new Harness();await analysedPreview(h);
  await h.click('Изменить');await h.click(/^1\. Сообщение/);
  const restarted=new Harness(h.domain);
  await restarted.message('Ок, пиши на me@example.com');
  assert.match(restarted.lastText(),/\[почта скрыта\]/,'edit applied to the remembered field');
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

test('card attempt survives restart: the answer goes to the same card',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Карточки');await h.click(/Уточнение/);await h.click('Попробовать');
  const restarted=new Harness(h.domain);
  await restarted.message('Когда тебе удобно?');
  assert.match(restarted.lastText(),/Моя попытка/);
});

test('reminder field being edited survives restart',async()=>{
  const h=new Harness();await h.register();
  await h.message('/account');await h.click('Напоминания');await h.click('Время');
  const restarted=new Harness(h.domain);
  await restarted.message('08:30');
  assert.match(restarted.lastText(),/Время: 08:30/);
});

test('assessment answers are saved after each answer and the series continues after restart',async()=>{
  const h=new Harness();await h.register();
  await h.message('/menu');await h.click('Ещё →');await h.click('Тест до/после');await h.click('Входной тест');
  await h.click('1');
  const restarted=new Harness(h.domain);
  await restarted.message('/menu');await restarted.click('Ещё →');await restarted.click('Тест до/после');await restarted.click('Входной тест');
  assert.match(restarted.lastText(),/Задание 2 из 3/,'continues from the saved answer');
});

test('history position and search survive restart',async()=>{
  const h=new Harness();await h.register();
  await h.message('/history');await h.click('Поиск по названию');
  const restarted=new Harness(h.domain);
  await restarted.message('отпуск');
  assert.match(restarted.lastText(),/«отпуск»/);
});

test('support region: user chooses a country, the choice is stored by the domain and used after restart',async()=>{
  const h=new Harness();await h.register();
  const calls:unknown[]=[];const original=h.domain.support.bind(h.domain);
  h.domain.support=(async(...args:Parameters<typeof original>)=>{calls.push(args);return original();}) as typeof h.domain.support;
  await h.message('/account');await h.click('Регион помощи');await h.click('Казахстан');
  const restarted=new Harness(h.domain);restarted.domain.support=h.domain.support;
  await restarted.message('/menu');await restarted.click('Понять сообщение');
  await restarted.message('Я убью тебя, если расскажешь');await restarted.message('Знакомый');
  await restarted.click('Коллеги');await restarted.click('Пропустить');await restarted.click('Уточнить');await restarted.click('Не понимаю');
  assert.deepEqual((calls.at(-1) as unknown[])[1],{countryCode:'KZ'});
  assert.ok(!restarted.messages().some(m=>/\+7\s?\d{3}/.test(m.text??'')),'no invented phone numbers');
});

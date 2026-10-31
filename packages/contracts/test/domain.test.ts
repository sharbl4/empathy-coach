import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TelegramUserId,PrivateTelegramIdentity,EmailVerification,SayDirectRequest,DomainRun,DialogueUpdate,domainOutputs} from '../src/domain.js';
import {id,timestamp,outputFixtures} from '../src/fixtures.js';
test('Telegram IDs survive beyond JS precision and fit PostgreSQL BIGINT',()=>{
  assert.equal(TelegramUserId.parse('9007199254740993'),'9007199254740993');
  for(const value of [123,'0','01','-1','9223372036854775808'])assert.equal(TelegramUserId.safeParse(value).success,false);
});
test('private identity rejects mismatched chat and callback owner injection',()=>{
  const identity={telegramUserId:'123',privateChatId:'123',updateId:'1'};
  PrivateTelegramIdentity.parse(identity);
  assert.equal(PrivateTelegramIdentity.safeParse({...identity,privateChatId:'124'}).success,false);
  assert.equal(PrivateTelegramIdentity.safeParse({...identity,ownerId:id}).success,false);
  assert.equal(EmailVerification.safeParse({challengeId:id,code:'12345'}).success,false);
  assert.equal(DialogueUpdate.safeParse({expectedRevision:1,stage:'menu',draft:{analysis:outputFixtures.analysis},sessionId:null,roleplayId:null}).success,false);
});
test('say-direct expresses user feelings and is a validated persisted run',()=>{
  SayDirectRequest.parse({expectedRevision:1,feeling:'Растерянность',need:'Ясность',request:'Давай договоримся о времени'});
  assert.equal(SayDirectRequest.safeParse({expectedRevision:1,feeling:'Я злюсь',need:'ясность',request:'уточни',ownerId:id}).success,false);
  const output={observation:'Время не указано',feeling:'Я растерян',need:'Мне нужна ясность',request:'Уточни время',message:'Мне важно договориться о времени. Когда удобно?',explanation:'Говорит о себе и содержит просьбу'};
  DomainRun.parse({id,sessionId:id,revision:1,createdAt:timestamp,updatedAt:timestamp,kind:'say_direct',status:'succeeded',output,errorCode:null});
  assert.equal(DomainRun.safeParse({id,sessionId:id,revision:1,createdAt:timestamp,updatedAt:timestamp,kind:'say_direct',status:'succeeded',output:outputFixtures.analysis,errorCode:null}).success,false);
  for(const schema of Object.values(domainOutputs))assert.ok(schema);
});

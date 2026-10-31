// Shared synthetic data for tests only. No production provider or transport fallback.
import {Account,ConsentAcceptance,EmailRequest,EmailChallenge,EmailVerification,Dialogue,DialogueUpdate,SayDirectRequest,SayDirectOutput,PrivateTelegramIdentity,UpdateReceipt} from './domain.js';
import {id,timestamp} from './fixtures.js';
export const telegramIdentity=PrivateTelegramIdentity.parse({telegramUserId:'9007199254740993',privateChatId:'9007199254740993',updateId:'1'});
export const telegramAccount=Account.parse({id,telegramUserId:telegramIdentity.telegramUserId,displayName:'Тестовый участник',emailVerified:true,consentVersion:'telegram-1',onboardingCompletedAt:timestamp});
export const consentAcceptance=ConsentAcceptance.parse({policyVersion:'telegram-1',accepted:true});
export const emailRequest=EmailRequest.parse({email:'participant@example.invalid'});
export const emailChallenge=EmailChallenge.parse({challengeId:id,expiresAt:'2026-10-30T06:10:00.000Z',resendAfter:'2026-10-30T06:01:00.000Z'});
export const emailVerification=EmailVerification.parse({challengeId:id,code:'123456'});
export const dialogue=Dialogue.parse({revision:1,stage:'menu',draft:{},sessionId:null,roleplayId:null,pendingRunId:null});
export const dialogueUpdate=DialogueUpdate.parse({expectedRevision:1,stage:'message',draft:{},sessionId:null,roleplayId:null});
export const sayDirectRequest=SayDirectRequest.parse({expectedRevision:1,feeling:'Растерянность',need:'Ясность',request:'Уточнить удобное время'});
export const sayDirectOutput=SayDirectOutput.parse({observation:'Время не указано',feeling:'Я растерян',need:'Мне нужна ясность',request:'Уточни время',message:'Мне важно договориться о времени. Когда удобно?',explanation:'Говорит о себе и содержит просьбу'});
export const updateReceipt=UpdateReceipt.parse({updateId:'1',intentKey:id,status:'processing'});
export function validateDomainFixtures(){
  PrivateTelegramIdentity.parse(telegramIdentity);Account.parse(telegramAccount);ConsentAcceptance.parse(consentAcceptance);EmailRequest.parse(emailRequest);EmailChallenge.parse(emailChallenge);EmailVerification.parse(emailVerification);Dialogue.parse(dialogue);DialogueUpdate.parse(dialogueUpdate);SayDirectRequest.parse(sayDirectRequest);SayDirectOutput.parse(sayDirectOutput);UpdateReceipt.parse(updateReceipt);
}

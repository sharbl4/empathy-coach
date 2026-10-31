import{test}from'node:test';
import assert from'node:assert/strict';
import{DialoguePatch,DialogueV2,AssessmentSubmit,Support,SupportRegionPatch,operations,UPDATE_MAX_ATTEMPTS,domainRetryPolicy}from'../src/product.js';
import{RuntimeEnvironment}from'../src/runtime.js';
import{id,timestamp}from'../src/fixtures.js';
import{assertPublicContractGraph}from'../../../scripts/lib/public-contracts.mjs';
import{readFileSync}from'node:fs';
import{spawnSync}from'node:child_process';

const base={expectedRevision:1,step:'compose',draft:{mode:'thread'},navigation:{kind:'thread_turn',speaker:'other',turnId:null},sessionId:null,previewId:null,roleplayId:null};
test('persistent scenario state survives a serialized round trip without email/code or catalogue copies',()=>{
  DialoguePatch.parse(base);
  const state=DialogueV2.parse({revision:2,step:base.step,draft:base.draft,navigation:base.navigation,sessionId:null,previewId:null,roleplayId:null,pendingRunId:null,createdAt:timestamp,expiresAt:new Date(Date.parse(timestamp)+3600000).toISOString()});
  assert.deepEqual(DialogueV2.parse(JSON.parse(JSON.stringify(state))),state);
  for(const navigation of [{kind:'thread_turn',speaker:'system',turnId:null},{kind:'none',challengeId:id},{kind:'card',cardId:'card',contentVersion:'1',theory:'copy'}])assert.equal(DialoguePatch.safeParse({...base,navigation}).success,false);
  assert.equal(DialoguePatch.safeParse({...base,expiresAt:timestamp}).success,false);
  assert.equal(DialogueV2.safeParse({...state,expiresAt:new Date(Date.parse(timestamp)+86401000).toISOString()}).success,false);
});
test('preview navigation binds the hash/revision actually displayed rather than silently reading the newest',()=>{
  const nav={kind:'preview',previewId:id,previewRevision:1,snapshotHash:'a'.repeat(64)};
  DialoguePatch.parse({...base,step:'preview',draft:{},previewId:id,navigation:nav});
  assert.equal(DialoguePatch.safeParse({...base,step:'preview',draft:{},previewId:id,navigation:{kind:'none'}}).success,false);
  assert.equal(DialoguePatch.safeParse({...base,step:'preview',draft:{},previewId:null,navigation:nav}).success,false);
});
test('assessment partial answers are canonical navigation data and submit requires the dialogue revision',()=>{
  const nav={kind:'assessment',assessmentId:id,contentVersion:'1',assessmentKind:'baseline',answers:[{questionId:'q1',choiceId:'a'}]};
  DialoguePatch.parse({...base,step:'assessment',draft:{},navigation:nav});
  assert.equal(DialoguePatch.safeParse({...base,step:'assessment',navigation:{...nav,answers:[...nav.answers,...nav.answers]}}).success,false);
  const input={id,contentVersion:'1',expectedDialogueRevision:3,answers:['q1','q2','q3'].map(questionId=>({questionId,choiceId:'a'}))};
  AssessmentSubmit.parse(input);assert.equal(AssessmentSubmit.safeParse({...input,expectedDialogueRevision:undefined}).success,false);
});
test('unknown support region never yields contacts or silently accepts a country from the caller',()=>{
  const response={countryCode:null,region:null,availability:'region_required',message:'Выберите регион при необходимости.',recognitionGuaranteed:false,contacts:[]};
  Support.parse(response);operations.support.input.parse({});
  assert.equal(operations.support.input.safeParse({countryCode:'RU'}).success,false);
  assert.equal(Support.safeParse({...response,availability:'available'}).success,false);
  assert.equal(Support.safeParse({...response,contacts:[{label:'Synthetic',phone:null,url:'https://example.invalid',sourceUrl:'https://example.invalid',verifiedAt:timestamp}]}).success,false);
  SupportRegionPatch.parse({expectedRevision:1,countryCode:null,region:null});
  assert.equal(SupportRegionPatch.safeParse({expectedRevision:1,countryCode:null,region:'guessed'}).success,false);
});
test('public contracts have no runtime import edge and browser resolution rejects runtime',()=>{
  assert.ok(assertPublicContractGraph().every(path=>!path.endsWith('runtime.ts')));
  assert.equal(JSON.parse(readFileSync('packages/contracts/package.json','utf8')).exports['./runtime'].browser,null);
  assert.ok(RuntimeEnvironment.shape.SMTP_PORT);assert.equal(UPDATE_MAX_ATTEMPTS,3);
  assert.equal(domainRetryPolicy(new Error('unknown'),'read').retryable,false);
  const blocked=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',"try{await import('@between/contracts/runtime');process.exit(1)}catch(error){if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')process.exit(2)}"],{encoding:'utf8'});
  assert.equal(blocked.status,0);
});

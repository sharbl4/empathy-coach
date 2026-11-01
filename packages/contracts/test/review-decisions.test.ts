import{test}from'node:test';
import assert from'node:assert/strict';
import{DialoguePatch,ResetDialogue,RunV2,StageEvent,OperationalAnalytics,SessionInputV2}from'../src/product.js';
import{id,timestamp}from'../src/fixtures.js';
import{analysisFixture}from'../src/product-fixtures.js';
test('menu can retain the canonical unfinished assessment and reset can explicitly confirm discard',()=>{
  const navigation={kind:'assessment',assessmentId:id,assessmentKind:'baseline',contentVersion:'1',answers:[{questionId:'q1',choiceId:'a'}]};
  DialoguePatch.parse({expectedRevision:2,step:'menu',draft:{},navigation,sessionId:null,previewId:null,roleplayId:null});
  ResetDialogue.parse({expectedRevision:2,confirmation:'DISCARD_UNFINISHED_ASSESSMENT'});
  ResetDialogue.parse({expectedRevision:2}); // Still valid for scenarios without an assessment; domain enforces pending guard.
});
test('run read carries own persisted vote with backward-compatible absent field',()=>{
  const run={id,sessionId:id,revision:1,previewId:id,previewRevision:1,modelRevision:'synthetic',promptVersion:'synthetic',createdAt:timestamp,updatedAt:timestamp,kind:'analysis',status:'succeeded',phase:null,queuePosition:null,errorCode:null,output:analysisFixture};
  for(const myRating of [undefined,null,'useful','not_useful'])RunV2.parse({...run,myRating});
  assert.equal(RunV2.safeParse({...run,myRating:'guessed'}).success,false);
});
test('run_completed is domain-only but remains readable in aggregate analytics',()=>{
  assert.equal(StageEvent.safeParse({name:'run_completed',resourceId:id}).success,false);
  OperationalAnalytics.parse({events:[{name:'run_completed',count:1}],contexts:[],usefulness:{useful:0,notUseful:0}});
});
test('thread edits and permutations already preserve turn identity through existing session input',()=>{
  const other='00000000-0000-4000-8000-000000000002';
  const input={mode:'thread',title:'Synthetic',relationship:'Colleague',context:'',contextType:'colleague',goal:'clarify',guess:{emotions:[],quotes:[],unsure:true},turns:[{id,speaker:'self',text:'Original'},{id:other,speaker:'other',text:'Reply'}]};
  SessionInputV2.parse(input);
  SessionInputV2.parse({...input,turns:[input.turns[1],{...input.turns[0],text:'Edited'}]});
});

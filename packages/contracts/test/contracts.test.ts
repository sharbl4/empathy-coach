import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, SessionInput, SessionQuery, ReplyOptions, Run, ExpectedRevision, outputs, outputJsonSchema, validateAnalysisEvidence, validateReplyEvidence } from '../src/index.js';
import { validateFixtures, situations, pending, runs, outputFixtures } from '../src/fixtures.js';
test('all shared requests, responses, results and states validate',validateFixtures);
test('rejects ownership, role history and analysis supplied by client',()=>{
  for(const field of ['ownerId','userId','history','analysis'])assert.equal(SessionInput.safeParse({...situations[0],[field]:'untrusted'}).success,false);
  assert.equal(ExpectedRevision.safeParse({expectedRevision:1,history:[]}).success,false);
});
test('quotes must be exact substrings; revision and limits are bounded',()=>{
  assert.equal(SessionInput.safeParse({...situations[0],guess:{emotions:[],evidenceQuotes:['invented'],unsure:true}}).success,false);
  assert.equal(SessionQuery.safeParse({limit:51}).success,false);
  assert.equal(ExpectedRevision.safeParse({expectedRevision:0}).success,false);
  assert.equal(ReplyOptions.safeParse(Array(4).fill(outputFixtures.reply_examples[0])).success,false);
});
test('run status and kind constrain output',()=>{
  assert.equal(Run.safeParse({...pending,output:outputFixtures.analysis}).success,false);
  assert.equal(Run.safeParse({...runs[0],output:outputFixtures.exercise}).success,false);
});
test('provider JSON schemas generate and contextual quotes are checked',()=>{
  for(const kind of Object.keys(outputs) as (keyof typeof outputs)[])assert.ok(outputJsonSchema(kind));
  validateAnalysisEvidence(outputFixtures.analysis,situations[0].situation.message);
  assert.throws(()=>validateAnalysisEvidence(outputFixtures.analysis,'Другое сообщение'));
  validateReplyEvidence(outputFixtures.reply_feedback,'Во сколько?');
  assert.throws(()=>validateReplyEvidence(outputFixtures.reply_feedback,'Другая фраза'));
});
test('documentation JSON examples match each endpoint schema',()=>{
  const doc=readFileSync('docs/api.md','utf8');
  const examples=[...doc.matchAll(/<!-- schema:(\w+)\.(body|response) -->\s*```json\s*([\s\S]*?)```/g)];
  assert.equal(examples.length,Object.values(api).reduce((n,r)=>n+1+('body' in r?1:0),0));
  for(const [,name,part,json] of examples){const route=api[name as keyof typeof api];assert.ok(route);const schema=part==='body'&&'body' in route?route.body:route.response;schema.parse(JSON.parse(json));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewFixture,analysisFixture} from '@between/contracts/product-fixtures';
import {LocalProductModel,ModelFailure,budget} from '../src/domain/product/model.js';
const config={provider:'local' as const,baseUrl:'http://127.0.0.1:18080/v1',model:'explicit-provider-test',timeoutMs:1000,maxConcurrency:1 as const,maxQueueLength:3};
test('A1 local adapter measures static template before consent; only confirmed snapshot reaches tokenize/generate, once',async()=>{
  const calls:Array<{path:string;body:Record<string,unknown>}>=[];let reasoning=false,changed=false;
  const provider=new LocalProductModel(config,async(url,init)=>{const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body??'{}'));calls.push({path,body});assert.equal(init?.redirect,'error');let response:unknown;
    if(path==='/props')response={chat_template:changed?'changed template':'approved synthetic template',default_generation_settings:{n_ctx:4096}};
    else if(path==='/apply-template')response={prompt:JSON.stringify(body.messages)};
    else if(path==='/tokenize')response={tokens:[1,2,3,4]};
    else{assert.equal(path,'/v1/chat/completions');assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.equal(body.max_tokens,1400);assert.equal(body.reasoning_effort,'none');response={model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysisFixture),...(reasoning?{reasoning_content:'forbidden'}:{})}}]};}
    return new Response(JSON.stringify(response),{headers:{'content-type':'application/json'}});
  });
  const info=await provider.describe('analysis');assert.equal(info.known,true);assert.ok(calls.every(call=>!JSON.stringify(call.body).includes(previewFixture.fields[0].value)));const snapshot={...previewFixture,confirmedAt:'2026-10-31T12:00:00.000Z',modelRevision:config.model,templateHash:info.hash,budget:budget('analysis',previewFixture.fields,previewFixture.turns,info)};
  const result=await provider.generate(snapshot,new AbortController().signal);assert.ok(result);assert.equal(calls.filter(c=>c.path.endsWith('chat/completions')).length,1);assert.ok(calls.some(c=>c.path==='/apply-template'&&JSON.stringify(c.body).includes(previewFixture.fields[0].value)));
  reasoning=true;await assert.rejects(provider.generate(snapshot,new AbortController().signal),e=>e instanceof ModelFailure&&e.code==='MODEL_INVALID_OUTPUT');changed=true;await assert.rejects(provider.generate(snapshot,new AbortController().signal),e=>e instanceof ModelFailure&&e.code==='CONFIGURATION_ERROR');assert.equal(calls.filter(c=>c.path.endsWith('chat/completions')).length,2);
});
test('A1 missing local template/tokenizer metadata stays unknown, with no generation fallback',async()=>{
  let calls=0;const provider=new LocalProductModel(config,async()=>{calls++;return new Response('{}',{status:503});});const info=await provider.describe('analysis');assert.equal(info.known,false);assert.equal(budget('analysis',previewFixture.fields,[],info).fit,'unknown');await assert.rejects(provider.generate({...previewFixture,modelRevision:config.model},new AbortController().signal),e=>e instanceof ModelFailure&&e.code==='CONFIGURATION_ERROR');assert.equal(calls,2);
});

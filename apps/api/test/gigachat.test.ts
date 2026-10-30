import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GigaChatProvider } from '../src/ai/gigachat.js';
import { ModelError } from '../src/ai/provider.js';
import { situations, outputFixtures } from '@between/contracts/fixtures';

const config={credentials:'test-authorization-key',scope:'GIGACHAT_API_PERS',model:'test-model',baseUrl:'https://api.giga.chat/v1'};
const input=situations[0];
const output=outputFixtures.analysis;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('GigaChat strict v1 request, single token refresh, expiry and no generation retry',async()=>{
  let oauth=0,generations=0,now=Date.now(),status=200;
  const provider=new GigaChatProvider(config,async(url,init)=>{
    if(String(url).includes('/oauth')){oauth++;assert.equal(new Headers(init?.headers).get('Authorization'),`Basic ${config.credentials}`);return json({access_token:'test-token',expires_at:now+120000});}
    generations++;assert.equal(String(url),'https://api.giga.chat/v1/chat/completions');
    const body=JSON.parse(String(init?.body));assert.equal(body.response_format.strict,true);assert.ok(body.response_format.schema.required);assert.equal(body.model_options,undefined);
    assert.equal(body.messages[0].role,'system');assert.equal(body.messages[1].role,'user');
    return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]},status);
  },()=>now);
  await Promise.all([provider.analyze(input,new AbortController().signal),provider.analyze(input,new AbortController().signal)]);
  assert.equal(oauth,1);assert.equal(generations,2);
  now+=90000;await provider.analyze(input,new AbortController().signal);assert.equal(oauth,2);
  status=429;await assert.rejects(provider.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='MODEL_UNAVAILABLE');assert.equal(generations,4);
  status=401;await assert.rejects(provider.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');assert.equal(generations,5);
  status=200;await provider.analyze(input,new AbortController().signal);assert.equal(oauth,3);
});
test('GigaChat rejects malformed, incomplete, refused and fabricated evidence',async()=>{
  for(const [response,code] of [
    [{choices:[{finish_reason:'stop',message:{content:'not json'}}]},'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'length',message:{content:JSON.stringify(output)}}]},'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'blacklist',message:{content:''}}]},'MODEL_REFUSED'],
    [{choices:[{finish_reason:'stop',message:{content:'{}'}}]},'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...output,interpretations:[{emotion:'x',possibleNeed:'x',explanation:'x',evidenceQuotes:['fabricated']},{emotion:'x',possibleNeed:'x',explanation:'x',evidenceQuotes:[]}]})}}]},'MODEL_INVALID_OUTPUT']
  ] as const){
    const provider=new GigaChatProvider(config,async url=>String(url).includes('/oauth')?json({access_token:'test',expires_at:Date.now()+120000}):json(response));
    await assert.rejects(provider.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code===code);
  }
});
test('GigaChat configuration, OAuth failure and timeout fail without fallback',async()=>{
  await assert.rejects(new GigaChatProvider({}).analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');
  const denied=new GigaChatProvider(config,async()=>json({},401));
  await assert.rejects(denied.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');
  const timeout=new GigaChatProvider(config,async()=>{throw new DOMException('timeout','TimeoutError');});
  await assert.rejects(timeout.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='MODEL_TIMEOUT');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GigaChatProvider } from '../src/ai/gigachat.js';
import { ModelError } from '../src/ai/provider.js';
import { situations, outputFixtures } from '@between/contracts/fixtures';
import {outputs} from '@between/contracts';
import {validateTask} from '../src/ai/tasks.js';

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
    [null,'MODEL_INVALID_OUTPUT'],
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
test('all learning adapter methods use one strict request and validate the current roleplay stage',async()=>{
  let value:unknown=outputFixtures.analysis,generations=0;
  const provider=new GigaChatProvider(config,async(url,init)=>{
    if(String(url).includes('/oauth'))return json({access_token:'test',expires_at:Date.now()+120000});
    generations++;const body=JSON.parse(String(init?.body));
    assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.strict,true);
    assert.equal(body.messages.length,2);assert.equal(body.messages[0].role,'system');assert.equal(body.messages[1].role,'user');
    assert.equal(body.stream,false);
    return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
  });
  const context={session:input,analysis:outputs.analysis.parse(outputFixtures.analysis)},signal=new AbortController().signal;
  value=outputFixtures.reply_feedback;await provider.replyFeedback({...context,draft:'Во сколько?'},signal);
  value=outputFixtures.reply_examples;await provider.replyExamples(context,signal);
  value=outputFixtures.exercise;const exercise=await provider.exercise(context,signal);
  value=outputFixtures.exercise_feedback;await provider.exerciseFeedback({...context,exercise,exerciseRunId:'11111111-1111-4111-8111-111111111111',answer:'Когда удобно?'},signal);
  const role={...context,messages:[],turnCount:0};
  value=outputFixtures.roleplay_start;await provider.roleplayStart(role,signal);
  value=outputFixtures.roleplay_turn;await provider.roleplayTurn({...role,turnCount:1},signal);
  value=outputFixtures.roleplay_feedback;await provider.roleplayTurn({...role,turnCount:3},signal);await provider.roleplayFinish({...role,turnCount:1},signal);
  assert.equal(generations,8);
  const id='11111111-1111-4111-8111-111111111111';
  assert.throws(()=>validateTask({kind:'roleplay_turn',roleplayId:id,context:{...role,turnCount:1}},outputFixtures.roleplay_feedback),e=>e instanceof ModelError&&e.code==='MODEL_INVALID_OUTPUT');
  assert.throws(()=>validateTask({kind:'roleplay_turn',roleplayId:id,context:{...role,turnCount:3}},outputFixtures.roleplay_start),e=>e instanceof ModelError&&e.code==='MODEL_INVALID_OUTPUT');
  assert.throws(()=>validateTask({kind:'reply_feedback',context:{...context,draft:'Совсем другой текст.'}},outputFixtures.reply_feedback),e=>e instanceof ModelError&&e.code==='MODEL_INVALID_OUTPUT');
});
test('GigaChat configuration, OAuth failure and timeout fail without fallback',async()=>{
  await assert.rejects(new GigaChatProvider({}).analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');
  const denied=new GigaChatProvider(config,async()=>json({},401));
  await assert.rejects(denied.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');
  const timeout=new GigaChatProvider(config,async()=>{throw new DOMException('timeout','TimeoutError');});
  await assert.rejects(timeout.analyze(input,new AbortController().signal),e=>e instanceof ModelError&&e.code==='MODEL_TIMEOUT');
});
test('access probe checks model and distinguishes token packages from pay-as-you-go',async()=>{
  for(const status of [200,403]){
    const provider=new GigaChatProvider(config,async url=>{
      if(String(url).includes('/oauth'))return json({access_token:'test',expires_at:Date.now()+120000});
      if(String(url).endsWith('/models'))return json({data:[{id:config.model}]});
      assert.ok(String(url).endsWith('/balance'));
      return json({balance:[{usage:'GigaChat',value:100}]},status);
    });
    assert.equal((await provider.checkAccess()).budget,status===200?'generation-tokens-positive':'manual-check-required');
  }
});

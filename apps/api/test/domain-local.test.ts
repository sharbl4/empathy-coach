import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalLlmProvider} from '../src/ai/local.js';
import {ModelError} from '../src/ai/provider.js';
import {situations,outputFixtures} from '@between/contracts/fixtures';
import {smtpTransport} from '../src/domain/mail.js';
const config={provider:'local' as const,baseUrl:'http://127.0.0.1:18080/v1',model:'synthetic-local',timeoutMs:1000,maxConcurrency:1};
const settings={structuredOutput:false,contextTokens:32768,responseBytes:65536,requestBytes:24576};
const signal=()=>new AbortController().signal;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('local provider uses one private request, disables thinking, validates exact evidence and never falls back',async()=>{
  let calls=0;
  const provider=new LocalLlmProvider(config,settings,async(url,init)=>{
    calls++;assert.equal(String(url),'http://127.0.0.1:18080/v1/chat/completions');const body=JSON.parse(String(init?.body));
    assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.equal(body.reasoning_effort,'none');assert.equal(body.response_format,undefined);assert.equal(body.tools,undefined);assert.equal(body.messages[1].role,'user');assert.equal(init?.redirect,'error');
    return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(outputFixtures.analysis)}}]});
  });
  const valid=await provider.analyze(situations[0],signal());assert.equal(valid.interpretations.length,2);assert.equal(calls,1);
  await assert.rejects(provider.analyze({...situations[0],situation:{...situations[0].situation,message:'Нет таких цитат.'}},signal()),e=>e instanceof ModelError&&e.code==='MODEL_INVALID_OUTPUT');assert.equal(calls,2);
  assert.throws(()=>new LocalLlmProvider({...config,baseUrl:'https://public.example/v1'},settings),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');
});
test('local errors: reasoning, partial output, invalid JSON, refusal, response cap and 429',async()=>{
  for(const [value,status,expected] of [
    [{choices:[{finish_reason:'stop',message:{content:'{}',reasoning_content:'internal reasoning'}}]},200,'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'stop',message:{content:'<think>internal</think>{}'}}]},200,'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'length',message:{content:JSON.stringify(outputFixtures.analysis)}}]},200,'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'stop',message:{content:'not-json'}}]},200,'MODEL_INVALID_OUTPUT'],
    [{choices:[{finish_reason:'stop',message:{content:'{}',refusal:'refused'}}]},200,'MODEL_REFUSED'],
    [{padding:'a'.repeat(70000)},200,'MODEL_INVALID_OUTPUT'],
    [{},429,'MODEL_UNAVAILABLE'],[{},401,'CONFIGURATION_ERROR']
  ] as const){
    let calls=0;const provider=new LocalLlmProvider(config,settings,async()=>{calls++;return response(value,status);});
    await assert.rejects(provider.analyze(situations[0],signal()),e=>e instanceof ModelError&&e.code===expected);assert.equal(calls,1);
  }
  let calls=0;const bounded=new LocalLlmProvider(config,{...settings,contextTokens:512},async()=>{calls++;return response({});});
  await assert.rejects(bounded.analyze(situations[0],signal()),e=>e instanceof ModelError&&e.code==='CONFIGURATION_ERROR');assert.equal(calls,0);
  const timeout=new LocalLlmProvider(config,settings,async()=>{throw new DOMException('Synthetic timeout','TimeoutError');});
  await assert.rejects(timeout.analyze(situations[0],signal()),e=>e instanceof ModelError&&e.code==='MODEL_TIMEOUT');
});
test('SMTP rejects header injection and requires paired credentials before opening a socket',async()=>{
  assert.throws(()=>smtpTransport({host:'smtp.example.invalid',port:587,from:'sender@example.invalid\r\nBcc: injected@example.invalid'}));
  assert.throws(()=>smtpTransport({host:'smtp.example.invalid',port:587,from:'sender@example.invalid',user:'unpaired'}));
  const transport=smtpTransport({host:'smtp.example.invalid',port:587,from:'sender@example.invalid'});
  await assert.rejects(transport.sendCode('person@example.invalid\r\nRCPT TO:other@example.invalid','123456'));
});

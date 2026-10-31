import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isPrivateModelUrl} from '@between/contracts/domain';
import {checkedCompletion} from '../lib/model-validation.mjs';
test('production model URL refuses public inference and credential/query injection',()=>{
  for(const value of ['https://api.giga.chat/v1','https://example.org/v1','http://127.0.0.1:8080/v1','http://100.64.0.2:8080/v1?token=secret','http://key@100.64.0.2/v1'])assert.equal(isPrivateModelUrl(value,true),false);
  assert.equal(isPrivateModelUrl('http://100.64.0.2:8080/v1',true),true);
  assert.equal(isPrivateModelUrl('http://127.0.0.1:8080/v1',false),true);
});
test('local output guard rejects reasoning, partial JSON and truncated completion',()=>{
  const content=JSON.stringify({observation:'Факт',feeling:'Растерянность',need:'Ясность',request:'Уточни время',message:'Когда удобно?',explanation:'Просьба без обвинения'});
  const completion={choices:[{finish_reason:'stop',message:{content}}]};
  assert.ok(checkedCompletion(completion,'say_direct'));
  for(const changed of [{finish_reason:'length',message:{content}},{finish_reason:'stop',message:{content,reasoning_content:'private reasoning'}},{finish_reason:'stop',message:{content,refusal:'refused'}},{finish_reason:'stop',message:{content:'<think>trace</think>'+content}},{finish_reason:'stop',message:{content:'{'} }])assert.throws(()=>checkedCompletion({choices:[changed]},'say_direct'));
});
test('health requires live process, actual DB/lease/polling and recent heartbeat',()=>{
  const dir=mkdtempSync(join(tmpdir(),'between-health-')),file=join(dir,'health.json');
  try{
    const healthy={pid:process.pid,heartbeatAt:new Date().toISOString(),database:true,pollerLease:true,polling:true};
    for(const [patch,expected] of [[{},0],[{database:false},1],[{pollerLease:false},1],[{polling:false},1],[{heartbeatAt:'2020-01-01T00:00:00.000Z'},1],[{secret:'DO_NOT_PRINT'},1]]){
      writeFileSync(file,JSON.stringify({...healthy,...patch}));
      const result=spawnSync(process.execPath,['scripts/bot-health.mjs',file],{encoding:'utf8'});assert.equal(result.status,expected);assert.equal(`${result.stdout}${result.stderr}`.includes('DO_NOT_PRINT'),false);
    }
  }finally{unlinkSync(file);rmdirSync(dir);}
});
test('unconfigured services fail before networking and never expose values',()=>{
  const result=spawnSync(process.execPath,['scripts/telegram-services.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,DATABASE_URL:'invalid:DO_NOT_PRINT'}});
  assert.equal(result.status,1);assert.ok(result.stderr.includes('No API calls made'));assert.equal(`${result.stdout}${result.stderr}`.includes('DO_NOT_PRINT'),false);
});
test('tailnet policy grants only cloud tag to model port, not default allow-all',()=>{
  const policy=JSON.parse(readFileSync('deploy/tailscale-policy.json','utf8'));
  assert.deepEqual(policy.grants,[{src:['tag:coach-bot'],dst:['tag:coach-llm'],ip:['tcp:8080']}]);
});

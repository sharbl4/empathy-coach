// Lead-owned integration harness. Uses the real API, Auth and model, never adapters.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { api, validateAnalysisEvidence } from '../packages/contracts/dist/index.js';
const requireApi=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {createClient}=requireApi('@supabase/supabase-js');
const required=['DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','CHECKPOINT_ORIGIN','CHECKPOINT_EMAIL','CHECKPOINT_PASSWORD'];
const missing=required.filter(k=>!process.env[k]?.trim());
if(missing.length||process.env.CHECKPOINT_LIVE!=='1'||process.env.AI_PROVIDER!=='gigachat'){
  console.error(`BLOCKED: set CHECKPOINT_LIVE=1, AI_PROVIDER=gigachat and ${missing.join(', ')||'the documented dev/test configuration'}. No API calls made.`);
  process.exit(1);
}
let origin;
try{origin=new URL(process.env.CHECKPOINT_ORIGIN);}catch{console.error('BLOCKED invalid checkpoint origin; value suppressed.');process.exit(1);}
if(origin.username||origin.password||!['http:','https:'].includes(origin.protocol)||(origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))){console.error('BLOCKED: origin must be localhost HTTP or HTTPS, without credentials.');process.exit(1);}
let auth;
try{
  if(new URL(process.env.SUPABASE_URL).protocol!=='https:')throw new Error();
  auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}catch{console.error('BLOCKED invalid Supabase configuration; values suppressed.');process.exit(1);}
const {Pool}=requireApi('pg');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:3000});
let token;
let verifiedId;
let stage='readiness';
async function call(path,{method='GET',body,key,expected=200}={}){
  const response=await globalThis.fetch(new URL(path,origin),{method,redirect:'error',signal:globalThis.AbortSignal.timeout(10000),headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status!==expected)throw new Error('HTTP mismatch');
  return response.json();
}
async function login(){
  const {data,error}=await auth.auth.signInWithPassword({email:process.env.CHECKPOINT_EMAIL,password:process.env.CHECKPOINT_PASSWORD});
  if(error||!data.session)throw new Error('Login failed');
  token=data.session.access_token;
  const verified=await auth.auth.getUser(token);
  if(verified.error||!verified.data.user?.email_confirmed_at)throw new Error('Unconfirmed user');
  verifiedId=verified.data.user.id;
}
try{
  api.ready.response.parse(await call('/api/health/ready'));
  stage='real Auth login';await login();
  const me=api.me.response.parse(await call('/api/me'));assert.equal(me.id,verifiedId);assert.equal(me.aiMode,'gigachat');
  console.log('OK confirmed Auth login and live AI mode');
  stage='create session';
  const input=api.createSession.body.parse({title:'Integration checkpoint',situation:{message:'Давай поговорим завтра.',relationship:'Коллега',context:'Вымышленная проверочная ситуация.',goal:'clarify'},guess:{emotions:[],evidenceQuotes:['завтра'],unsure:true}});
  const creationKey=randomUUID();
  const session=api.createSession.response.parse(await call('/api/sessions',{method:'POST',body:input,key:creationKey,expected:201}));
  const repeatedSession=api.createSession.response.parse(await call('/api/sessions',{method:'POST',body:input,key:creationKey,expected:201}));
  assert.equal(repeatedSession.id,session.id);
  assert.deepEqual(session.situation,input.situation);
  console.log('OK session saved through HTTP; duplicate POST returned the same session');
  stage='live analysis';
  const key=randomUUID();const body={expectedRevision:session.revision};
  const accepted=api.analyze.response.parse(await call(`/api/sessions/${session.id}/analyze`,{method:'POST',body,key,expected:202}));
  const duplicate=api.analyze.response.parse(await call(`/api/sessions/${session.id}/analyze`,{method:'POST',body,key,expected:202}));
  assert.equal(accepted.runId,duplicate.runId);
  let result;
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const run=api.run.response.parse(await call(`/api/runs/${accepted.runId}`));
    assert.equal(run.sessionId,session.id);assert.equal(run.revision,session.revision);assert.equal(run.kind,'analysis');
    if(run.status==='failed')throw new Error('Run failed');
    if(run.status==='succeeded'){result=validateAnalysisEvidence(run.output,input.situation.message);break;}
    await delay(1500);
  }
  assert.ok(result);
  console.log('OK validated analysis and idempotent POST');
  stage='PostgreSQL persistence';
  const storedSession=await db.query('SELECT id FROM app.sessions WHERE id=$1 AND user_id=$2',[session.id,me.id]);
  assert.equal(storedSession.rowCount,1);
  const storedRun=await db.query('SELECT status, output FROM app.ai_runs WHERE id=$1 AND session_id=$2 AND user_id=$3',[accepted.runId,session.id,me.id]);
  assert.equal(storedRun.rowCount,1);assert.equal(storedRun.rows[0].status,'succeeded');assert.deepEqual(storedRun.rows[0].output,result);
  console.log('OK session and validated analysis persisted in PostgreSQL');
  stage='relogin and reload';
  const signedOut=await auth.auth.signOut({scope:'local'});if(signedOut.error)throw new Error('Signout failed');token=undefined;
  await login();
  assert.equal(verifiedId,me.id);
  const reopened=api.session.response.parse(await call(`/api/sessions/${session.id}`));
  assert.equal(reopened.revision,session.revision);assert.deepEqual(reopened.situation,input.situation);
  const saved=reopened.runs.find(r=>r.id===accepted.runId);assert.ok(saved);assert.equal(saved.status,'succeeded');assert.deepEqual(saved.output,result);
  console.log('OK saved analysis reopened after signout/signin; synthetic session retained');
  console.log('PASS HTTP checkpoint. Browser UX, DB restart and external email delivery still require manual checks.');
}catch{
  console.error(`BLOCKED checkpoint at ${stage}; raw error, identifiers, correspondence and credentials suppressed. No automatic generation retry.`);
  process.exitCode=1;
}finally{
  if(token){try{const {error}=await auth.auth.signOut({scope:'local'});if(error){console.error('BLOCKED local Auth session cleanup');process.exitCode=1;}}catch{console.error('BLOCKED local Auth session cleanup');process.exitCode=1;}}
  await db.end();
}

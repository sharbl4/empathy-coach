import {randomUUID,createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {
  PrivateTelegramIdentity,TelegramUserId,Id,AccountPatch,ConsentAcceptance,Dialogue,DialogueUpdate,Revision,
  SessionQuery,UpdateSession,ExpectedRevision,ReplyRequest,ExerciseAnswer,TurnRequest,SayDirectRequest,
  DeleteData,DeleteAccount,DeliveryFailure,type CreateDomain,type DomainFacade,type DomainOptions,type UserContext
} from '@between/contracts/domain';
import {Storage,transaction} from '../repositories/storage.js';
import {Runs} from '../services/runs.js';
import type {AiProvider} from '../ai/provider.js';
import {LocalLlmProvider} from '../ai/local.js';
import {Contexts,Mutations,accountDto,accountColumns,digest,fail,safe,type AccountRow} from './core.js';
import {Emails,emailLimits} from './email.js';
import {smtpTransport,type MailTransport} from './mail.js';
import {TransportState} from './transport-state.js';
import {maskAll,maskText,cleanSession,requireConfirmed} from './privacy.js';
import {cleanTemporary} from './maintenance.js';

interface TestDependencies {mail?:MailTransport;provider?:AiProvider;now?:()=>number;}
function boundedSetting(name:string,fallback:number,max:number){const value=Number(process.env[name]??fallback);if(!Number.isInteger(value)||value<1||value>max)fail('VALIDATION_ERROR');return value;}
const stamp=(value:unknown)=>JSON.stringify(value);
function operationKey(ctx:UserContext,operation:string,resource:string,key:string){
  Id.parse(key);const h=createHash('sha256').update(stamp([ctx.accountId,operation,resource,key])).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
function validateOptions(options:DomainOptions){
  TelegramUserId.parse(options.botId);
  if(!/^[a-fA-F0-9]{64,}$/.test(options.emailCodeSecret)||options.ai.provider!=='local'||options.ai.maxConcurrency!==1)fail('VALIDATION_ERROR');
  const url=new URL(options.databaseUrl);if(!['postgres:','postgresql:'].includes(url.protocol))fail('VALIDATION_ERROR');
}
export const createDomain:CreateDomain=options=>safe(()=>openDomain(options));
/** Explicit test-only dependencies. Never exported by the package entry. */
export async function createDomainForTest(options:DomainOptions,dependencies:TestDependencies):Promise<DomainFacade>{
  if(process.env.NODE_ENV!=='test')throw new Error('Test domain injection rejected');return safe(()=>openDomain(options,dependencies));
}
async function openDomain(options:DomainOptions,test:TestDependencies={}):Promise<DomainFacade>{
  validateOptions(options);
  const pool=new Pool({connectionString:options.databaseUrl,max:5,connectionTimeoutMillis:2000,query_timeout:5000});
  const now=test.now??Date.now;
  const shutdown=new AbortController(),contexts=new Contexts(pool,now),mutations=new Mutations(pool,contexts,options.emailCodeSecret),store=new Storage(pool);
  const provider=test.provider??new LocalLlmProvider(options.ai,{structuredOutput:process.env.LOCAL_LLM_JSON_SCHEMA==='1',contextTokens:Number(process.env.LOCAL_LLM_CONTEXT_TOKENS??4096),requestBytes:24576,responseBytes:65536});
  const emails=new Emails(pool,contexts,mutations,options.emailCodeSecret,test.mail??smtpTransport(options.smtp),now,{...emailLimits,accountPerHour:boundedSetting('EMAIL_ACCOUNT_HOURLY_LIMIT',5,20),addressPerHour:boundedSetting('EMAIL_ADDRESS_HOURLY_LIMIT',10,100)});
  let lease:PoolClient|undefined,closing:Promise<void>|undefined,maintenance:ReturnType<typeof setInterval>|undefined,cleaning=false;
  const owned=(client:PoolClient,userId:string)=>client.query<AccountRow>(`SELECT ${accountColumns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1`,[userId]);
  const runs=new Runs(pool,provider,1,1,options.ai.timeoutMs,{
    queueLimit:boundedSetting('AI_QUEUE_LIMIT',10,50),
    stopped:()=>{shutdown.abort();void facade.close().catch(()=>{});},
    authorize:async(client,userId,task,session)=>{
      const row=(await owned(client,userId)).rows[0];if(!row)fail('UNAUTHORIZED');if(row.consent_version!=='telegram-1')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');
      await requireConfirmed(client,userId,session.id,session.revision,task,options.emailCodeSecret,now());
    },
    completed:async(client,userId,runId)=>{await client.query('INSERT INTO app.run_deliveries(id,user_id,run_id,next_attempt_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),userId,runId,new Date(now())]);}
  });
  const active=()=>!!lease&&!shutdown.signal.aborted;
  const transport=new TransportState(pool,contexts,runs,options.botId,options.emailCodeSecret,now,active);
  const boundary=<T>(work:()=>Promise<T>)=>safe(async()=>{if(!active())fail('DEPENDENCY_UNAVAILABLE');return work();});
  const read=<T>(ctx:UserContext,learning:boolean,work:(client:PoolClient,row:AccountRow)=>Promise<T>)=>boundary(()=>transaction(pool,async client=>work(client,await contexts.check(ctx,client,learning,true))));
  const mutate=<T>(ctx:UserContext,op:string,resource:string,key:string,payload:unknown,work:Parameters<Mutations['run']>[5],learning=false)=>boundary(()=>mutations.run(ctx,op,resource,key,payload,work,learning)) as Promise<T>;
  const cancellation=async(client:PoolClient,userId:string)=>{
    const ids=(await client.query<{id:string}>("UPDATE app.ai_runs SET status='failed',error_code='RUN_INTERRUPTED',updated_at=clock_timestamp() WHERE user_id=$1 AND status='pending' RETURNING id",[userId])).rows.map(row=>row.id);
    await client.query("UPDATE app.run_jobs SET state='finished' WHERE user_id=$1 AND state IN ('queued','running')",[userId]);
    await client.query("UPDATE app.run_deliveries SET state='failed' WHERE user_id=$1 AND state IN ('pending','claimed')",[userId]);return ()=>runs.cancelDeleted(ids);
  };
  const dialogue=async(client:PoolClient,userId:string)=>{
    await client.query("INSERT INTO app.dialogues(user_id,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING",[userId,new Date(now()+3600000)]);
    await client.query("UPDATE app.dialogues SET revision=revision+1,stage='menu',draft='{}',session_id=NULL,roleplay_id=NULL,pending_run_id=NULL,expires_at=$2 WHERE user_id=$1 AND expires_at<=$3",[userId,new Date(now()+3600000),new Date(now())]);
    const row=(await client.query('SELECT * FROM app.dialogues WHERE user_id=$1',[userId])).rows[0];
    return Dialogue.parse({revision:row.revision,stage:row.stage,draft:row.draft,sessionId:row.session_id,roleplayId:row.roleplay_id,pendingRunId:row.pending_run_id});
  };
  const launch=async(ctx:UserContext,id:string,key:string,operation:string,invoke:(userId:string,key:string)=>Promise<{runId:string;resourceId?:string}>)=>boundary(async()=>{
    await contexts.check(ctx,pool,true);Id.parse(id);const accepted=await invoke(ctx.accountId,operationKey(ctx,operation,id,key));
    await transaction(pool,async client=>{
      await contexts.check(ctx,client,true,true);await dialogue(client,ctx.accountId);
      await client.query("UPDATE app.dialogues SET revision=revision+1,stage='waiting_run',pending_run_id=$2,expires_at=$3 WHERE user_id=$1 AND pending_run_id IS DISTINCT FROM $2::uuid",[ctx.accountId,accepted.runId,new Date(now()+3600000)]);
    });return accepted;
  });
  const deleted=new WeakMap<object,string>();
  const facade:DomainFacade={
    shutdownSignal:shutdown.signal,
    updateCursor:()=>boundary(()=>transport.cursor()),
    resolveUser:raw=>boundary(async()=>{
      const identity=PrivateTelegramIdentity.parse(raw);
      return transaction(pool,async client=>{
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1205))',[identity.telegramUserId]);
        const prior=(await client.query("SELECT principal_hmac FROM app.telegram_inbox WHERE bot_id=$1 AND update_id=$2 AND user_id IS NULL AND status='completed'",[options.botId,identity.updateId])).rows[0];
        if(prior){if(prior.principal_hmac!==digest(options.emailCodeSecret,'inbox-principal',options.botId,identity.telegramUserId))fail('UNAUTHORIZED');fail('NOT_FOUND');}
        let row=(await client.query<AccountRow>(`SELECT ${accountColumns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.telegram_user_id=$1`,[identity.telegramUserId])).rows[0];
        if(!row){const id=randomUUID();await client.query('INSERT INTO app.profiles(id) VALUES($1)',[id]);await client.query('INSERT INTO app.accounts(id,telegram_user_id) VALUES($1,$2)',[id,identity.telegramUserId]);row=(await owned(client,id)).rows[0];}
        return contexts.issue(row,identity.updateId);
      });
    }),
    claimUpdate:(ctx,id)=>boundary(()=>transport.claim(ctx,id)),
    acknowledgeUpdate:id=>boundary(()=>transport.acknowledge(id)),
    account:ctx=>read(ctx,false,async(_client,row)=>accountDto(row)),
    updateAccount:(ctx,raw,key)=>{
      const input=AccountPatch.parse(raw);
      return mutate(ctx,'account.update','',key,input,async(client,row)=>{
        await client.query('UPDATE app.profiles SET display_name=COALESCE($2,display_name),onboarding_completed_at=CASE WHEN $3 THEN COALESCE(onboarding_completed_at,$4) ELSE onboarding_completed_at END WHERE id=$1',[row.id,input.displayName,input.onboardingCompleted??false,new Date(now())]);
        return {value:accountDto((await owned(client,row.id)).rows[0])};
      });
    },
    acceptConsent:(ctx,raw,key)=>{const input=ConsentAcceptance.parse(raw);return mutate(ctx,'consent.accept','',key,input,async(client,row)=>{
      await client.query('UPDATE app.accounts SET consent_version=$2 WHERE id=$1',[row.id,input.policyVersion]);return {value:accountDto({...row,consent_version:input.policyVersion})};
    });},
    revokeConsent:(ctx,key)=>mutate(ctx,'consent.revoke','',key,{},async(client,row)=>{
      await client.query('UPDATE app.accounts SET consent_version=NULL WHERE id=$1',[row.id]);const afterCommit=await cancellation(client,row.id);
      await client.query("UPDATE app.dialogues SET revision=revision+1,stage='onboarding',draft='{}',pending_run_id=NULL WHERE user_id=$1",[row.id]);return {value:undefined,afterCommit};
    }),
    requestEmailCode:(ctx,input,key)=>boundary(()=>emails.request(ctx,input,key)),
    verifyEmailCode:(ctx,input,key)=>boundary(()=>emails.verify(ctx,input,key)),
    dialogue:ctx=>read(ctx,false,(client,row)=>dialogue(client,row.id)),
    updateDialogue:(ctx,raw,key)=>{const input=DialogueUpdate.parse(raw);return mutate(ctx,'dialogue.update','',key,input,async(client,row)=>{
      if(!['onboarding','email','email_code','menu'].includes(input.stage)){if(row.consent_version!=='telegram-1')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');}
      const current=await dialogue(client,row.id);if(current.revision!==input.expectedRevision)fail('REVISION_CONFLICT');
      if(input.sessionId)await store.owned(client,row.id,input.sessionId);
      if(input.roleplayId){const role=(await client.query('SELECT session_id,revision FROM app.roleplays WHERE id=$1 AND user_id=$2',[input.roleplayId,row.id])).rows[0];if(!role)fail('NOT_FOUND');if(role.session_id!==input.sessionId)fail('VALIDATION_ERROR');const session=await store.owned(client,row.id,role.session_id);if(role.revision!==session.revision)fail('REVISION_CONFLICT');}
      const draft=maskAll(input.draft);if(Buffer.byteLength(stamp(draft))>24000)fail('VALIDATION_ERROR');
      await client.query('UPDATE app.dialogues SET revision=revision+1,stage=$2,draft=$3,session_id=$4,roleplay_id=$5,expires_at=$6 WHERE user_id=$1',[row.id,input.stage,draft,input.sessionId,input.roleplayId,new Date(now()+3600000)]);
      return {value:await dialogue(client,row.id)};
    });},
    resetDialogue:(ctx,expected,key)=>{Revision.parse(expected);return mutate(ctx,'dialogue.reset','',key,{expectedRevision:expected},async(client,row)=>{
      if((await dialogue(client,row.id)).revision!==expected)fail('REVISION_CONFLICT');
      await client.query("UPDATE app.dialogues SET revision=revision+1,stage='menu',draft='{}',session_id=NULL,roleplay_id=NULL,pending_run_id=NULL,expires_at=$2 WHERE user_id=$1",[row.id,new Date(now()+3600000)]);return {value:await dialogue(client,row.id)};
    });},
    createSession:(ctx,raw,key)=>{const input=cleanSession(raw);return mutate(ctx,'session.create','',key,input,async(client,row)=>({value:await store.create(row.id,input,client)}),true);},
    sessions:(ctx,query)=>read(ctx,true,(client,row)=>store.list(row.id,SessionQuery.parse(query),client)),
    session:(ctx,id)=>read(ctx,true,(client,row)=>store.domainDetail(row.id,Id.parse(id),client)),
    updateSession:(ctx,id,raw,key)=>{Id.parse(id);const input=UpdateSession.parse(maskAll(UpdateSession.parse(raw)));return mutate(ctx,'session.update',id,key,input,async(client,row)=>{
      const value=await store.update(row.id,id,input,client);await client.query('DELETE FROM app.ai_confirmations WHERE session_id=$1 AND user_id=$2',[id,row.id]);return {value};
    },true);},
    deleteSession:(ctx,id,key)=>{Id.parse(id);return mutate(ctx,'session.delete',id,key,{},async(client,row)=>{
      await store.remove(row.id,id,client);
      await client.query("UPDATE app.domain_intents SET result=NULL,error_code='NOT_FOUND',state='failed' WHERE user_id=$1 AND (resource=$2 OR (operation='session.create' AND result->>'id'=$2) OR (operation LIKE 'dialogue.%' AND result->>'sessionId'=$2))",[row.id,id]);
      await client.query("UPDATE app.dialogues SET revision=revision+1,stage='menu',draft='{}',session_id=NULL,roleplay_id=NULL,pending_run_id=NULL WHERE user_id=$1 AND session_id=$2",[row.id,id]);return {value:undefined};
    });},
    deleteData:(ctx,raw,key)=>{const input=DeleteData.parse(raw);return mutate(ctx,'data.delete','',key,input,async(client,row)=>{
      const afterCommit=await cancellation(client,row.id);await store.clear(row.id,undefined,client);
      await client.query("UPDATE app.domain_intents SET result=NULL,error_code='NOT_FOUND',state='failed' WHERE user_id=$1 AND (operation LIKE 'session.%' OR operation LIKE 'dialogue.%')",[row.id]);
      await client.query('DELETE FROM app.dialogues WHERE user_id=$1',[row.id]);return {value:undefined,afterCommit};
    });},
    deleteAccount:(ctx,raw,key)=>boundary(async()=>{
      DeleteAccount.parse(raw);Id.parse(key);if(deleted.get(ctx)===key)return;
      let cancel=()=>{};
      await transaction(pool,async client=>{
        const row=await contexts.check(ctx,client,false,true);cancel=await cancellation(client,row.id);await store.clear(row.id,undefined,client);
        await client.query("UPDATE app.telegram_inbox SET status='completed',completed_at=$2 WHERE user_id=$1 AND status='processing'",[row.id,new Date(now())]);
        await client.query('DELETE FROM app.profiles WHERE id=$1',[row.id]);
      });deleted.set(ctx,key);cancel();
    }),
    analyze:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'analysis',(user,k)=>runs.analyze(user,id,input.expectedRevision,k));},
    replyFeedback:(ctx,id,raw,key)=>{const input=ReplyRequest.parse(maskAll(ReplyRequest.parse(raw)));return launch(ctx,id,key,'reply_feedback',(user,k)=>runs.replyFeedback(user,id,input,k));},
    replyExamples:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'reply_examples',(user,k)=>runs.replyExamples(user,id,input,k));},
    exercise:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'exercise',(user,k)=>runs.exercise(user,id,input,k));},
    exerciseFeedback:(ctx,id,raw,key)=>{const parsed=ExerciseAnswer.parse(raw),input={...parsed,answer:maskText(parsed.answer)};return launch(ctx,id,key,'exercise_feedback',(user,k)=>runs.exerciseFeedback(user,id,input,k));},
    roleplayStart:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'roleplay_start',(user,k)=>runs.roleplayStart(user,id,input,k));},
    roleplayTurn:(ctx,id,raw,key)=>{const input=TurnRequest.parse(maskAll(TurnRequest.parse(raw)));return launch(ctx,id,key,'roleplay_turn',(user,k)=>runs.roleplayTurn(user,id,input,k));},
    roleplayFinish:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'roleplay_feedback',(user,k)=>runs.roleplayFinish(user,id,input,k));},
    sayDirect:(ctx,id,raw,key)=>{const input=SayDirectRequest.parse(maskAll(SayDirectRequest.parse(raw)));return launch(ctx,id,key,'say_direct',(user,k)=>runs.sayDirect(user,id,input,k));},
    retry:(ctx,id,raw,key)=>{const input=ExpectedRevision.parse(raw);return launch(ctx,id,key,'retry',(user,k)=>runs.retry(user,id,input,k));},
    run:(ctx,id)=>read(ctx,true,(client,row)=>runs.get(row.id,Id.parse(id),client)),
    progress:ctx=>read(ctx,true,(client,row)=>store.progress(row.id,client)),
    claimDeliveries:limit=>boundary(()=>transport.claimDeliveries(limit)),
    completeDelivery:(ctx,id)=>boundary(()=>transport.finish(ctx,id)),
    failDelivery:(ctx,id,input)=>boundary(()=>transport.finish(ctx,id,DeliveryFailure.parse(input))),
    health:async()=>{try{await pool.query('SELECT 1');return {database:true,pollerLease:active()};}catch{return {database:false,pollerLease:false};}},
    close:()=>closing??(closing=(async()=>{shutdown.abort();if(maintenance)clearInterval(maintenance);await runs.close();if(lease){await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,1206))',[options.botId]).catch(()=>{});lease.release();lease=undefined;}await pool.end();})())
  };
  try{
    lease=await pool.connect();if(!(await lease.query('SELECT pg_try_advisory_lock(hashtextextended($1,1206)) AS acquired',[options.botId])).rows[0].acquired)fail('OPERATION_IN_PROGRESS');
    lease.on('error',()=>{shutdown.abort();void facade.close().catch(()=>{});});await runs.start();
    await cleanTemporary(pool,now());
    maintenance=setInterval(()=>{if(cleaning||shutdown.signal.aborted)return;cleaning=true;void cleanTemporary(pool,now()).catch(()=>{}).finally(()=>{cleaning=false;});},60000);
    await pool.query("INSERT INTO app.run_deliveries(id,user_id,run_id,next_attempt_at) SELECT gen_random_uuid(),r.user_id,r.id,$1 FROM app.ai_runs r JOIN app.accounts a ON a.id=r.user_id WHERE r.status IN ('failed','succeeded') ON CONFLICT DO NOTHING",[new Date(now())]);
    return new Proxy(facade,{get(target,key,receiver){
      const value=Reflect.get(target,key,receiver) as unknown;
      if(typeof value!=='function')return value;
      return (...args:unknown[])=>safe(()=>Promise.resolve().then(()=>Reflect.apply(value,target,args)));
    }});
  }catch(error){await facade.close();throw error;}
}

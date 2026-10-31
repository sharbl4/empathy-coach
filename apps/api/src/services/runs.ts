import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {SessionInput,outputs,type RequestFor,type ResponseFor} from '@between/contracts';
import {DomainRun as Run,SayDirectRequest} from '@between/contracts/domain';
import {Storage,transaction} from '../repositories/storage.js';
import {HttpError,notFound} from '../errors.js';
import {type AiProvider,type LearningContext,type RoleplayContext,ModelError} from '../ai/provider.js';
import {type DomainTask as Task,type TaskOutput,invokeTask,validateTask} from '../ai/tasks.js';

const conflict=(message:string)=>new HttpError(409,'OPERATION_IN_PROGRESS',message);
const revisionConflict=()=>new HttpError(409,'REVISION_CONFLICT','Ситуация изменена');
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
  return value;
}
type RoleRow={id:string;session_id:string;user_id:string;revision:number;status:'active'|'completed';turn_count:number;last_run_id:string|null};
type Session=ResponseFor<'createSession'>;
type Plan={task:Task;commit:()=>Promise<void>};
type Build=(client:PoolClient,session:Session,id:string)=>Promise<Task|Plan>;
export interface RunHooks {
  queueLimit?:number;
  authorize?:(client:PoolClient,userId:string,task:Task,session:Session)=>Promise<void>;
  completed?:(client:PoolClient,userId:string,runId:string)=>Promise<void>;
  stopped?:()=>void;
}

export class Runs {
  private lease?:PoolClient;
  private tasks=new Set<Promise<void>>();
  private executing=new Map<string,{userId:string;controller:AbortController}>();
  private stopping=false;
  private abort=new AbortController();
  private ticker?:ReturnType<typeof setInterval>;
  private pumping=false;
  constructor(private pool:Pool,private provider:AiProvider,private maxConcurrency=2,private maxPerUser=1,private timeoutMs=30000,private hooks:RunHooks={}) {
    if(!Number.isInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>20||!Number.isInteger(maxPerUser)||maxPerUser<1||maxPerUser>maxConcurrency||!Number.isFinite(timeoutMs)||timeoutMs<1)throw new Error('Invalid AI limits');
  }
  async start() {
    const lease=await this.pool.connect();
    try {
      const result=await lease.query('SELECT pg_try_advisory_lock(748311903) AS acquired');
      if(!result.rows[0].acquired)throw new Error('Only one backend process may run');
      if(this.hooks.queueLimit){
        await lease.query("UPDATE app.ai_runs SET status='failed',error_code='RUN_INTERRUPTED',updated_at=clock_timestamp() WHERE status='pending' AND id NOT IN (SELECT run_id FROM app.run_jobs WHERE state='queued')");
        await lease.query("UPDATE app.run_jobs SET state='finished' WHERE state='running'");
      }else await lease.query("UPDATE app.ai_runs SET status='failed',error_code='RUN_INTERRUPTED',updated_at=clock_timestamp() WHERE status='pending'");
      lease.on('error',()=>{this.stopping=true;this.abort.abort();this.hooks.stopped?.();});this.lease=lease;
      if(this.hooks.queueLimit)this.ticker=setInterval(()=>{void this.pump().catch(()=>{});},100);
    }catch(error){await lease.query('SELECT pg_advisory_unlock(748311903)').catch(()=>{});lease.release();throw error;}
  }
  async close() {
    this.stopping=true;if(this.ticker)clearInterval(this.ticker);this.abort.abort();await Promise.allSettled([...this.tasks]);
    if(this.lease){await this.lease.query('SELECT pg_advisory_unlock(748311903)').catch(()=>{});this.lease.release();this.lease=undefined;}
  }
  cancelDeleted(ids:string[]) {for(const id of ids)this.executing.get(id)?.controller.abort();}

  private async submit(userId:string,key:string,path:string,body:{expectedRevision:number},resolve:(client:PoolClient)=>Promise<string>,build:Build) {
    if(this.stopping||!this.lease)throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Обработка временно недоступна');
    const hash=createHash('sha256').update(JSON.stringify(['POST',path,canonical(body)])).digest('hex');
    const store=new Storage(this.pool);let reservation:string|undefined;
    const accepted=await transaction(this.pool,async client=>{
      await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
      const sessionId=await resolve(client),session=await store.owned(client,userId,sessionId,true);
      const prior=await client.query<{id:string;payload_hash:string;kind:Run['kind'];input:Task}>('SELECT id,payload_hash,kind,input FROM app.ai_runs WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);
      if(prior.rows[0]){
        const old=prior.rows[0];if(old.payload_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован с другим запросом');
        return {id:old.id,sessionId,revision:session.revision,task:null,resourceId:old.kind==='roleplay_start'&&'roleplayId' in old.input?old.input.roleplayId:undefined};
      }
      if(session.revision!==body.expectedRevision)throw revisionConflict();
      await store.assertIdle(client,sessionId);
      const id=randomUUID(),built=await build(client,session,id),task='task' in built?built.task:built;
      await this.hooks.authorize?.(client,userId,task,session);
      await client.query('SELECT pg_advisory_xact_lock(748311904)');
      if(this.hooks.queueLimit){
        const counts=(await client.query("SELECT count(*) FILTER(WHERE state='queued')::int AS waiting,count(*) FILTER(WHERE user_id=$1 AND state IN ('queued','running'))::int AS owned FROM app.run_jobs",[userId])).rows[0];
        if(counts.waiting>=this.hooks.queueLimit||counts.owned>0||[...this.executing.values()].some(item=>item.userId===userId))throw new HttpError(429,'RATE_LIMITED','Очередь заполнена или у вас уже есть задача');
      }else{
      const count=await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE user_id=$1)::int AS owned FROM app.ai_runs WHERE status='pending'",[userId]);
      const owned=[...this.executing.values()].filter(value=>value.userId===userId).length;
      if(count.rows[0].total>=this.maxConcurrency||count.rows[0].owned>=this.maxPerUser||this.executing.size>=this.maxConcurrency||owned>=this.maxPerUser)throw new HttpError(429,'RATE_LIMITED','Дождитесь завершения текущей операции');
      this.executing.set(id,{userId,controller:new AbortController()});reservation=id;
      }
      if('task' in built)await built.commit();
      await client.query(`INSERT INTO app.ai_runs(id,session_id,user_id,revision,kind,status,input,prompt_version,idempotency_key,payload_hash)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)`,[id,sessionId,userId,session.revision,task.kind,task,`${task.kind}-v1`,key,hash]);
      if(this.hooks.queueLimit)await client.query("INSERT INTO app.run_jobs(run_id,user_id,state) VALUES($1,$2,'queued')",[id,userId]);
      if('roleplayId' in task)await client.query('UPDATE app.roleplays SET last_run_id=$1,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$3',[id,task.roleplayId,userId]);
      await client.query('UPDATE app.sessions SET updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2',[sessionId,userId]);
      return {id,sessionId,revision:session.revision,task,resourceId:task.kind==='roleplay_start'?task.roleplayId:undefined};
    }).catch(error=>{if(reservation)this.executing.delete(reservation);throw error;});
    if(accepted.task&&!this.hooks.queueLimit){
      const task=this.execute(accepted.id,userId,accepted.sessionId,accepted.revision,accepted.task);
      this.tasks.add(task);void task.finally(()=>this.tasks.delete(task));
    }
    return {runId:accepted.id,...(accepted.resourceId?{resourceId:accepted.resourceId}:{})};
  }
  private async pump(){
    if(this.stopping||this.pumping||this.executing.size>=this.maxConcurrency)return;this.pumping=true;
    try{
      const job=await transaction(this.pool,async client=>{
        const candidate=(await client.query("SELECT r.id,r.user_id,r.session_id,r.revision,r.input FROM app.run_jobs j JOIN app.ai_runs r ON r.id=j.run_id WHERE j.state='queued' ORDER BY j.created_at,j.run_id LIMIT 1")).rows[0];
        if(!candidate)return null;
        await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[candidate.user_id]);
        const current=(await client.query("SELECT state FROM app.run_jobs WHERE run_id=$1 FOR UPDATE",[candidate.id])).rows[0];if(current?.state!=='queued')return null;
        const session=await new Storage(this.pool).owned(client,candidate.user_id,candidate.session_id,true);
        try{if(session.revision!==candidate.revision)throw revisionConflict();await this.hooks.authorize?.(client,candidate.user_id,candidate.input as Task,session);}
        catch{
          await client.query("UPDATE app.ai_runs SET status='failed',error_code='RUN_INTERRUPTED',updated_at=clock_timestamp() WHERE id=$1 AND status='pending'",[candidate.id]);
          await client.query("UPDATE app.run_jobs SET state='finished' WHERE run_id=$1",[candidate.id]);return null;
        }
        await client.query("UPDATE app.run_jobs SET state='running' WHERE run_id=$1",[candidate.id]);return candidate;
      });
      if(job&&!this.stopping){this.executing.set(job.id,{userId:job.user_id,controller:new AbortController()});const task=this.execute(job.id,job.user_id,job.session_id,job.revision,job.input as Task);this.tasks.add(task);void task.finally(()=>this.tasks.delete(task));}
    }finally{this.pumping=false;}
  }
  private input(session:Session) {return SessionInput.parse({title:session.title,situation:session.situation,guess:session.guess});}
  private async context(client:PoolClient,userId:string,session:Session):Promise<LearningContext> {
    const result=await client.query("SELECT output FROM app.ai_runs WHERE session_id=$1 AND user_id=$2 AND revision=$3 AND kind='analysis' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1",[session.id,userId,session.revision]);
    if(!result.rows[0])throw conflict('Сначала завершите разбор текущей версии ситуации');
    return {session:this.input(session),analysis:outputs.analysis.parse(result.rows[0].output)};
  }
  analyze(userId:string,sessionId:string,revision:number,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/analyze`,{expectedRevision:revision},async()=>sessionId,async(_client,session)=>({kind:'analysis',context:this.input(session)}));
  }
  sayDirect(userId:string,sessionId:string,body:ReturnType<typeof SayDirectRequest.parse>,key:string){
    return this.submit(userId,key,`/api/sessions/${sessionId}/say-direct`,body,async()=>sessionId,async(_client,session)=>({kind:'say_direct',context:{session:this.input(session),request:body}}));
  }
  replyFeedback(userId:string,sessionId:string,body:RequestFor<'replyFeedback'>,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/reply-feedback`,body,async()=>sessionId,async(client,session)=>({kind:'reply_feedback',context:{...await this.context(client,userId,session),draft:body.draft}}));
  }
  replyExamples(userId:string,sessionId:string,body:RequestFor<'replyExamples'>,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/reply-examples`,body,async()=>sessionId,async(client,session)=>({kind:'reply_examples',context:await this.context(client,userId,session)}));
  }
  exercise(userId:string,sessionId:string,body:RequestFor<'exercise'>,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/exercise`,body,async()=>sessionId,async(client,session)=>({kind:'exercise',context:await this.context(client,userId,session)}));
  }
  exerciseFeedback(userId:string,sessionId:string,body:RequestFor<'exerciseFeedback'>,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/exercise-feedback`,body,async()=>sessionId,async(client,session)=>{
      const result=await client.query('SELECT revision,kind,status,output FROM app.ai_runs WHERE id=$1 AND user_id=$2 AND session_id=$3',[body.exerciseRunId,userId,sessionId]);
      const row=result.rows[0];if(!row)throw notFound();if(row.revision!==session.revision)throw revisionConflict();
      if(row.kind!=='exercise'||row.status!=='succeeded')throw new HttpError(400,'VALIDATION_ERROR','Нужно завершённое упражнение этой ситуации');
      return {kind:'exercise_feedback',context:{...await this.context(client,userId,session),exercise:outputs.exercise.parse(row.output),exerciseRunId:body.exerciseRunId,answer:body.answer}};
    });
  }
  private async role(client:PoolClient,userId:string,id:string,session:Session):Promise<RoleRow> {
    const result=await client.query<RoleRow>('SELECT * FROM app.roleplays WHERE id=$1 AND user_id=$2 AND session_id=$3 FOR UPDATE',[id,userId,session.id]);
    const role=result.rows[0];if(!role)throw notFound();if(role.revision!==session.revision)throw revisionConflict();
    if(role.status!=='active')throw conflict('Диалог уже завершён');return role;
  }
  private async roleContext(client:PoolClient,userId:string,session:Session,role:RoleRow):Promise<RoleplayContext> {
    const messages=await client.query("SELECT id,sequence,role,content FROM app.roleplay_messages WHERE roleplay_id=$1 ORDER BY sequence",[role.id]);
    return {...await this.context(client,userId,session),messages:messages.rows,turnCount:role.turn_count};
  }
  roleplayStart(userId:string,sessionId:string,body:RequestFor<'roleplayStart'>,key:string) {
    return this.submit(userId,key,`/api/sessions/${sessionId}/roleplays`,body,async()=>sessionId,async(client,session)=>{
      const context=await this.context(client,userId,session);
      if((await client.query("SELECT 1 FROM app.roleplays WHERE session_id=$1 AND user_id=$2 AND revision=$3 AND status='active'",[sessionId,userId,session.revision])).rowCount)throw conflict('Продолжите активный диалог или повторите неудавшийся старт');
      if((await client.query('SELECT count(*)::int AS count FROM app.roleplays WHERE session_id=$1 AND revision=$2',[sessionId,session.revision])).rows[0].count>=100)throw new HttpError(429,'RATE_LIMITED','Достигнут лимит диалогов этой версии');
      const roleplayId=randomUUID();
      return {task:{kind:'roleplay_start',roleplayId,context:{...context,messages:[],turnCount:0}},commit:async()=>{await client.query("INSERT INTO app.roleplays(id,session_id,user_id,revision,status) VALUES($1,$2,$3,$4,'active')",[roleplayId,sessionId,userId,session.revision]);}};
    });
  }
  private async roleSession(client:PoolClient,userId:string,id:string) {
    const row=(await client.query('SELECT session_id FROM app.roleplays WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
    if(!row)throw notFound();return row.session_id as string;
  }
  private async assertLastSucceeded(client:PoolClient,role:RoleRow,earlyFinish=false) {
    const row=(await client.query('SELECT status,kind FROM app.ai_runs WHERE id=$1 AND user_id=$2 AND session_id=$3 AND revision=$4',[role.last_run_id,role.user_id,role.session_id,role.revision])).rows[0];
    const stoppingFailedTurn=earlyFinish&&role.turn_count>0&&role.turn_count<3&&row?.status==='failed'&&row.kind==='roleplay_turn';
    if(row?.status!=='succeeded'&&!stoppingFailedTurn)throw conflict('Сначала повторите неудавшуюся генерацию диалога');
  }
  roleplayTurn(userId:string,roleplayId:string,body:RequestFor<'roleplayTurn'>,key:string) {
    return this.submit(userId,key,`/api/roleplays/${roleplayId}/turns`,body,client=>this.roleSession(client,userId,roleplayId),async(client,session)=>{
      const role=await this.role(client,userId,roleplayId,session);await this.assertLastSucceeded(client,role);
      if(role.turn_count>=3)throw conflict('Три ответа уже сохранены; повторите получение итога');
      const context=await this.roleContext(client,userId,session,role),message={id:randomUUID(),sequence:(context.messages.at(-1)?.sequence??-1)+1,role:'user' as const,content:body.content};
      return {task:{kind:'roleplay_turn',roleplayId,context:{...context,turnCount:role.turn_count+1,messages:[...context.messages,message]}},commit:async()=>{
        await client.query("INSERT INTO app.roleplay_messages(id,roleplay_id,sequence,role,content) VALUES($1,$2,$3,'user',$4)",[message.id,roleplayId,message.sequence,message.content]);
        await client.query('UPDATE app.roleplays SET turn_count=turn_count+1 WHERE id=$1 AND user_id=$2',[roleplayId,userId]);
      }};
    });
  }
  roleplayFinish(userId:string,roleplayId:string,body:RequestFor<'roleplayFinish'>,key:string) {
    return this.submit(userId,key,`/api/roleplays/${roleplayId}/finish`,body,client=>this.roleSession(client,userId,roleplayId),async(client,session)=>{
      const role=await this.role(client,userId,roleplayId,session);await this.assertLastSucceeded(client,role,true);
      if(role.turn_count<1)throw conflict('Для итога нужен хотя бы один ответ');
      return {kind:'roleplay_feedback',roleplayId,context:await this.roleContext(client,userId,session,role)};
    });
  }
  retry(userId:string,failedRunId:string,body:RequestFor<'retry'>,key:string) {
    let original:{session_id:string;kind:Run['kind'];status:string;revision:number;input:Task}|undefined;
    return this.submit(userId,key,`/api/runs/${failedRunId}/retry`,body,async client=>{
      original=(await client.query('SELECT session_id,kind,status,revision,input FROM app.ai_runs WHERE id=$1 AND user_id=$2',[failedRunId,userId])).rows[0];
      if(!original)throw notFound();return original.session_id;
    },async(client,session)=>{
      if(!original||original.status!=='failed')throw new HttpError(400,'VALIDATION_ERROR','Повтор доступен только для неудавшейся операции');
      if(original.revision!==session.revision)throw revisionConflict();
      const task=original.input;if(!('roleplayId' in task))return task;
      const role=await this.role(client,userId,task.roleplayId,session);
      if(role.last_run_id!==failedRunId||role.turn_count!==task.context.turnCount)throw conflict('Этот шаг диалога уже заменён другой операцией');
      return task;
    });
  }
  async get(userId:string,id:string,existing?:PoolClient) {
    const result=await (existing??this.pool).query(`SELECT r.id,r.session_id AS "sessionId",r.revision,r.kind,r.status,r.output,r.error_code AS "errorCode",
      r.created_at AS "createdAt",r.updated_at AS "updatedAt",s.revision AS current_revision
      FROM app.ai_runs r JOIN app.sessions s ON s.id=r.session_id AND s.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2`,[id,userId]);
    const row=result.rows[0];if(!row)throw notFound();if(row.revision!==row.current_revision)throw revisionConflict();delete row.current_revision;
    return Run.parse({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
  }
  private async event(client:PoolClient,userId:string,sessionId:string,sourceId:string,kind:'analysis'|'exercise'|'roleplay',skill:string) {
    await client.query(`INSERT INTO app.practice_events(id,user_id,session_id,source_run_id,source_roleplay_id,kind,skill)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[randomUUID(),userId,sessionId,kind==='roleplay'?null:sourceId,kind==='roleplay'?sourceId:null,kind,skill]);
  }
  private async saveResult(client:PoolClient,userId:string,sessionId:string,id:string,task:Task,output:TaskOutput) {
    if(task.kind==='analysis')await this.event(client,userId,sessionId,id,'analysis','Проверка гипотез');
    if(task.kind==='exercise_feedback')await this.event(client,userId,sessionId,task.context.exerciseRunId,'exercise',task.context.exercise.skill);
    if('roleplayId' in task){
      const finish=task.kind==='roleplay_feedback'||(task.kind==='roleplay_turn'&&task.context.turnCount===3);
      if(finish){
        const feedback=outputs.roleplay_feedback.parse(output);
        await client.query("UPDATE app.roleplays SET status='completed',feedback=$1,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$3",[feedback,task.roleplayId,userId]);
        await this.event(client,userId,sessionId,task.roleplayId,'roleplay','Диалог');
      }else{
        const message=outputs.roleplay_start.parse(output);
        await client.query(`INSERT INTO app.roleplay_messages(id,roleplay_id,sequence,role,content)
          SELECT $1,$2,COALESCE(max(sequence),-1)+1,'assistant',$3 FROM app.roleplay_messages WHERE roleplay_id=$2`,[randomUUID(),task.roleplayId,message.content]);
      }
    }
  }
  private async execute(id:string,userId:string,sessionId:string,revision:number,task:Task) {
    let output:TaskOutput|null=null,errorCode:ModelError['code']|'RUN_INTERRUPTED'|null=null;
    const controller=this.executing.get(id)?.controller;
    const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(this.timeoutMs),...(controller?[controller.signal]:[])]);
    try {
      const value=await new Promise<TaskOutput>((resolve,reject)=>{
        const cancel=()=>reject(new ModelError('MODEL_TIMEOUT'));signal.addEventListener('abort',cancel,{once:true});
        if(signal.aborted){this.executing.delete(id);cancel();return;}
        Promise.resolve().then(()=>invokeTask(this.provider,task,signal)).then(resolve,reject).finally(()=>{signal.removeEventListener('abort',cancel);this.executing.delete(id);});
      });
      output=validateTask(task,value);
    }catch(error){errorCode=this.stopping?'RUN_INTERRUPTED':error instanceof ModelError?error.code:'MODEL_UNAVAILABLE';}
    try {
      await transaction(this.pool,async client=>{
        await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
        const current=await client.query('SELECT revision FROM app.sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[sessionId,userId]);
        if(current.rows[0]?.revision!==revision)return;
        if('roleplayId' in task){
          const role=(await client.query<RoleRow>('SELECT * FROM app.roleplays WHERE id=$1 AND user_id=$2 AND session_id=$3 FOR UPDATE',[task.roleplayId,userId,sessionId])).rows[0];
          if(!role||role.status!=='active'||role.revision!==revision||role.last_run_id!==id)return;
        }
        const saved=await client.query(`UPDATE app.ai_runs SET status=$2,output=$3,error_code=$4,updated_at=clock_timestamp()
          WHERE id=$1 AND user_id=$5 AND revision=$6 AND status='pending' RETURNING id`,[id,output?'succeeded':'failed',output?JSON.stringify(output):null,errorCode,userId,revision]);
        if(output&&saved.rowCount)await this.saveResult(client,userId,sessionId,id,task,output);
        if(saved.rowCount){
          if(this.hooks.queueLimit)await client.query("UPDATE app.run_jobs SET state='finished' WHERE run_id=$1",[id]);
          await this.hooks.completed?.(client,userId,id);
        }
        await client.query('UPDATE app.sessions SET updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2',[sessionId,userId]);
      });
    }catch{
      // Do not replay a model call after uncertain persistence. Startup interrupts pending.
    }
  }
}

import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Run, SessionInput, validateAnalysisEvidence, type OutputFor } from '@between/contracts';
import { Storage, transaction } from '../repositories/storage.js';
import { HttpError, notFound } from '../errors.js';
import { type AiProvider, ModelError, PROMPT_VERSION } from '../ai/provider.js';

export class Runs {
  private lease?:PoolClient;
  private tasks=new Set<Promise<void>>();
  private stopping=false;
  private abort=new AbortController();
  constructor(private pool:Pool,private provider:AiProvider,private maxConcurrency=2,private maxPerUser=1,private timeoutMs=30000) {
    if(!Number.isInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>20||!Number.isInteger(maxPerUser)||maxPerUser<1||maxPerUser>maxConcurrency||!Number.isFinite(timeoutMs)||timeoutMs<1)throw new Error('Invalid AI limits');
  }
  async start() {
    const lease=await this.pool.connect();
    try {
      const result=await lease.query('SELECT pg_try_advisory_lock(748311903) AS acquired');
      if(!result.rows[0].acquired)throw new Error('Only one backend process may run');
      await lease.query("UPDATE app.ai_runs SET status='failed',error_code='RUN_INTERRUPTED',updated_at=clock_timestamp() WHERE status='pending'");
      // A lost process lease invalidates this worker. Do not keep admitting tasks.
      lease.on('error',()=>{this.stopping=true;this.abort.abort();});
      this.lease=lease;
    }catch(error){await lease.query('SELECT pg_advisory_unlock(748311903)').catch(()=>{});lease.release();throw error;}
  }
  async close() {
    this.stopping=true;this.abort.abort();
    await Promise.allSettled([...this.tasks]);
    if(this.lease){await this.lease.query('SELECT pg_advisory_unlock(748311903)').catch(()=>{});this.lease.release();this.lease=undefined;}
  }
  async analyze(userId:string,sessionId:string,revision:number,key:string) {
    if(this.stopping||!this.lease)throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Обработка временно недоступна');
    const hash=createHash('sha256').update(JSON.stringify(['POST',`/api/sessions/${sessionId}/analyze`,{expectedRevision:revision}])).digest('hex');
    const store=new Storage(this.pool);
    const result=await transaction(this.pool,async client=>{
      await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
      const session=await store.owned(client,userId,sessionId,true);
      const prior=await client.query('SELECT id,payload_hash FROM app.ai_runs WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);
      if(prior.rows[0]){
        if(prior.rows[0].payload_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован с другим запросом');
        return {id:prior.rows[0].id as string,created:false,input:SessionInput.parse({title:session.title,situation:session.situation,guess:session.guess})};
      }
      if(session.revision!==revision)throw new HttpError(409,'REVISION_CONFLICT','Ситуация изменена');
      await store.assertIdle(client,sessionId);
      // Serializes admission only; no external request or queue is held in this transaction.
      await client.query('SELECT pg_advisory_xact_lock(748311904)');
      const count=await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE user_id=$1)::int AS owned FROM app.ai_runs WHERE status='pending'",[userId]);
      if(count.rows[0].total>=this.maxConcurrency||count.rows[0].owned>=this.maxPerUser)throw new HttpError(429,'RATE_LIMITED','Дождитесь завершения текущего разбора');
      const input=SessionInput.parse({title:session.title,situation:session.situation,guess:session.guess});
      const id=randomUUID();
      await client.query(`INSERT INTO app.ai_runs(id,session_id,user_id,revision,kind,status,input,prompt_version,idempotency_key,payload_hash)
        VALUES($1,$2,$3,$4,'analysis','pending',$5,$6,$7,$8)`,[id,sessionId,userId,revision,input,PROMPT_VERSION,key,hash]);
      return {id,created:true,input};
    });
    if(result.created){
      const task=this.execute(result.id,userId,sessionId,revision,result.input);
      this.tasks.add(task);void task.finally(()=>this.tasks.delete(task));
    }
    return {runId:result.id};
  }
  async get(userId:string,id:string) {
    const result=await this.pool.query(`SELECT r.id,r.session_id AS "sessionId",r.revision,r.kind,r.status,r.output,r.error_code AS "errorCode",
      r.created_at AS "createdAt",r.updated_at AS "updatedAt",s.revision AS current_revision
      FROM app.ai_runs r JOIN app.sessions s ON s.id=r.session_id AND s.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2`,[id,userId]);
    const row=result.rows[0];if(!row)throw notFound();
    if(row.revision!==row.current_revision)throw new HttpError(409,'REVISION_CONFLICT','Результат относится к прошлой версии');
    delete row.current_revision;
    return Run.parse({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
  }
  private async execute(id:string,userId:string,sessionId:string,revision:number,input:SessionInput) {
    let output:OutputFor<'analysis'>|null=null;
    let errorCode:ModelError['code']|'RUN_INTERRUPTED'|null=null;
    const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(this.timeoutMs)]);
    try {
      // Guard even injected/test providers. A late provider cannot commit after timeout.
      const value=await new Promise<OutputFor<'analysis'>>((resolve,reject)=>{
        const cancel=()=>reject(new ModelError('MODEL_TIMEOUT'));
        signal.addEventListener('abort',cancel,{once:true});
        this.provider.analyze(input,signal).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
        if(signal.aborted)cancel();
      });
      try{output=validateAnalysisEvidence(value,input.situation.message);}catch{throw new ModelError('MODEL_INVALID_OUTPUT');}
    }catch(error){errorCode=this.stopping?'RUN_INTERRUPTED':error instanceof ModelError?error.code:'MODEL_UNAVAILABLE';}
    try {
      await transaction(this.pool,async client=>{
        await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
        const current=await client.query('SELECT revision FROM app.sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[sessionId,userId]);
        if(current.rows[0]?.revision!==revision)return;
        const result=await client.query(`UPDATE app.ai_runs SET status=$2,output=$3,error_code=$4,updated_at=clock_timestamp()
          WHERE id=$1 AND user_id=$5 AND revision=$6 AND status='pending' RETURNING id`,[id,output?'succeeded':'failed',output,errorCode,userId,revision]);
        if(output&&result.rowCount){
          await client.query(`INSERT INTO app.practice_events(id,user_id,session_id,source_run_id,kind,skill)
            VALUES($1,$2,$3,$4,'analysis',$5) ON CONFLICT DO NOTHING`,[randomUUID(),userId,sessionId,id,output.skillTip]);
        }
      });
    }catch{
      // Never replay generation after persistence failure. Recovery marks pending interrupted.
    }
  }
}

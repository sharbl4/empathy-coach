import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RunV2,RoleplayV2,validateEvidenceV2,type OperationInput,type ProductOptions,type UserContext} from '@between/contracts/product';
import {Store,fail,transaction,type AccountRow} from './core.js';
import {Previews} from './previews.js';
import {ModelFailure,type Model,type Snapshot} from './model.js';
type Run=ReturnType<typeof RunV2.parse>;
export class ProductRuns {
  private lease?:PoolClient;private timer?:ReturnType<typeof setInterval>;private starting?:Promise<void>;private stopping=false;private pumping=false;
  private executing=new Map<string,{user:string;controller:AbortController;done:Promise<void>}>();
  constructor(readonly store:Store,readonly previews:Previews,private model:Model,private config:ProductOptions['ai'],private lost:()=>void,private completed:(c:PoolClient,row:AccountRow,run:Run)=>Promise<void>){}
  start(){return this.starting??(this.starting=this.open());}
  private async open(){
    const lease=await this.store.pool.connect();try{if(!(await lease.query('SELECT pg_try_advisory_lock(748311913) acquired')).rows[0].acquired)fail('OPERATION_IN_PROGRESS');this.lease=lease;lease.on('error',()=>{this.stopping=true;this.lost();});
      await lease.query("UPDATE app.product_runs SET value=value||jsonb_build_object('status','failed','phase',NULL,'queuePosition',NULL,'output',NULL,'errorCode','RUN_INTERRUPTED','updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) WHERE value->>'status'='pending' AND value->>'phase'='running'");
      await lease.query("INSERT INTO app.product_deliveries(id,user_id,run_id,next_attempt_at,created_at) SELECT gen_random_uuid(),user_id,id,$1,$1 FROM app.product_runs WHERE value->>'status' IN ('succeeded','failed') ON CONFLICT DO NOTHING",[new Date(this.store.now())]);
      this.timer=setInterval(()=>{void this.pump().catch(()=>this.lost());},100);
    }catch(error){if(this.lease===lease)this.lease=undefined;await lease.query('SELECT pg_advisory_unlock(748311913)').catch(()=>{});lease.release();throw error;}
  }
  healthy(){return !!this.lease&&!this.stopping;}
  cancel(user:string){for(const e of this.executing.values())if(e.user===user)e.controller.abort();}
  async close(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const e of this.executing.values())e.controller.abort();await Promise.allSettled([...this.executing.values()].map(e=>e.done));if(this.lease){await this.lease.query('SELECT pg_advisory_unlock(748311913)').catch(()=>{});this.lease.release();this.lease=undefined;}}
  async submit(ctx:UserContext,input:OperationInput<'startRun'>,key:string){await this.previews.sessions.dialogues.ensure(ctx);return this.store.write(ctx,'startRun',input,key,async(c,row,r)=>({value:await this.admit(c,row,r)}),true);}
  async retry(ctx:UserContext,input:OperationInput<'retry'>,key:string){await this.previews.sessions.dialogues.ensure(ctx);return this.store.write(ctx,'retry',input,key,async(c,row,r)=>{
    const old=(await c.query('SELECT * FROM app.product_runs WHERE id=$1 AND user_id=$2',[r.id,row.id])).rows[0];if(!old)fail('NOT_FOUND');const prior=RunV2.parse(old.value);if(prior.status!=='failed')fail('OPERATION_IN_PROGRESS');if(prior.revision!==r.expectedRevision)fail('REVISION_CONFLICT');
    const p=(await this.previews.owned(c,row.id,r.previewId)).value;if(p.kind!==prior.kind||p.sessionId!==prior.sessionId||p.snapshotHash!==r.snapshotHash)fail('PREVIEW_STALE');
    // Role retries reuse the durable failed operation, never append another user turn.
    return {value:await this.admit(c,row,{previewId:r.previewId,previewRevision:r.previewRevision,snapshotHash:r.snapshotHash,expectedSessionRevision:prior.sessionId?prior.revision:null},old)};
  },true);}
  private async admit(c:PoolClient,row:AccountRow,input:OperationInput<'startRun'>,retry?:{id:string;roleplay_id:string|null;snapshot:Snapshot}){
    if(!this.healthy())fail('DEPENDENCY_UNAVAILABLE');if([...this.executing.values()].some(e=>e.user===row.id))fail('OPERATION_IN_PROGRESS');
    const {p,source}=await this.previews.confirmed(c,row.id,input,retry?.id);
    if(retry&&retry.snapshot.snapshotHash!==p.snapshotHash)fail('PREVIEW_STALE');
    await c.query('SELECT pg_advisory_xact_lock(748311914)');
    if((await c.query("SELECT 1 FROM app.product_runs WHERE user_id=$1 AND value->>'status'='pending'",[row.id])).rowCount)fail('OPERATION_IN_PROGRESS');
    if((await c.query("SELECT count(*)::int n FROM app.product_runs WHERE value->>'phase'='queued'")).rows[0].n>=this.config.maxQueueLength)fail('RATE_LIMITED',2);
    const id=randomUUID();let resourceId:string|undefined;
    if(retry?.roleplay_id){const role=await this.previews.sessions.role(c,row.id,retry.roleplay_id);if(role.row.last_run_id!==retry.id||role.value.status!=='active')fail('OPERATION_IN_PROGRESS');resourceId=role.value.id;await c.query('UPDATE app.product_roles SET last_run_id=$3 WHERE id=$1 AND user_id=$2',[resourceId,row.id,id]);}
    else if(p.kind==='roleplay_start'){
      if((await c.query("SELECT 1 FROM app.product_roles WHERE user_id=$1 AND session_id=$2 AND session_revision=$3 AND value->>'status'='active'",[row.id,p.sessionId,p.sessionRevision])).rowCount)fail('OPERATION_IN_PROGRESS');
      resourceId=randomUUID();const role=RoleplayV2.parse({id:resourceId,sessionId:p.sessionId,revision:1,difficulty:source.difficulty,status:'active',turnCount:0,messages:[],feedback:null});await c.query('INSERT INTO app.product_roles(id,user_id,session_id,session_revision,value,last_run_id) VALUES($1,$2,$3,$4,$5,$6)',[resourceId,row.id,p.sessionId,p.sessionRevision,role,id]);
    }else if(p.kind==='roleplay_turn'||p.kind==='roleplay_feedback'){
      const {row:db,value:role}=await this.previews.sessions.role(c,row.id,String(source.roleplayId));
      if(db.last_run_id){const previous=(await c.query('SELECT value FROM app.product_runs WHERE id=$1 AND user_id=$2',[db.last_run_id,row.id])).rows[0];if(previous?.value.status!=='succeeded'&&p.kind!=='roleplay_feedback')fail('OPERATION_IN_PROGRESS');if(previous?.value.status==='pending')fail('OPERATION_IN_PROGRESS');}
      resourceId=role.id;let next={...role,revision:role.revision+1};if(p.kind==='roleplay_turn'){if(role.turnCount>=3)fail('OPERATION_IN_PROGRESS');const content=p.fields.find(f=>f.label==='content')?.value;if(!content?.trim())fail('VALIDATION_ERROR');next={...next,turnCount:role.turnCount+1,messages:[...role.messages,{id:randomUUID(),sequence:role.messages.length,role:'user',content}]};}
      await c.query('UPDATE app.product_roles SET value=$3,last_run_id=$4 WHERE id=$1 AND user_id=$2',[role.id,row.id,RoleplayV2.parse(next),id]);
    }
    const at=new Date(this.store.now()).toISOString(),run=RunV2.parse({id,sessionId:p.sessionId,revision:p.sessionRevision??1,previewId:p.id,previewRevision:p.revision,modelRevision:p.modelRevision,promptVersion:p.promptVersion,kind:p.kind,status:'pending',phase:'queued',queuePosition:null,output:null,errorCode:null,createdAt:at,updatedAt:at});
    await c.query('INSERT INTO app.product_runs(id,user_id,session_id,preview_id,value,snapshot,roleplay_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,row.id,p.sessionId,p.id,run,p,resourceId??null,new Date(this.store.now())]);
    const dialogues=this.previews.sessions.dialogues,state=await dialogues.read(c,row);await dialogues.save(c,row.id,dialogues.next(state,{step:'waiting_run',navigation:{kind:'none'},draft:{},sessionId:p.sessionId,previewId:p.id,roleplayId:resourceId??null,pendingRunId:id}));return {runId:id,...resourceId?{resourceId}:{}};
  }
  async get(c:PoolClient,user:string,id:string){const db=(await c.query('SELECT * FROM app.product_runs WHERE id=$1 AND user_id=$2',[id,user])).rows[0];if(!db)fail('NOT_FOUND');let run=RunV2.parse(db.value);if(run.status==='pending'&&run.phase==='queued'){const position=(await c.query("SELECT count(*)::int n FROM app.product_runs WHERE value->>'phase'='queued' AND (created_at,id)<($1,$2)",[db.created_at,id])).rows[0].n;run={...run,queuePosition:position};}return run;}
  private async pump(){
    if(this.pumping||this.stopping||this.executing.size)return;this.pumping=true;
    try{
      const candidate=(await this.store.pool.query("SELECT id,user_id FROM app.product_runs WHERE value->>'phase'='queued' ORDER BY created_at,id LIMIT 1")).rows[0];if(!candidate)return;
      const claimed=await transaction(this.store.pool,async c=>{
        await c.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[candidate.user_id]);const db=(await c.query("SELECT * FROM app.product_runs WHERE id=$1 AND user_id=$2 AND value->>'phase'='queued' FOR UPDATE",[candidate.id,candidate.user_id])).rows[0];if(!db)return;
        await c.query("UPDATE app.product_runs SET value=value||jsonb_build_object('phase','running','queuePosition',NULL) WHERE id=$1",[db.id]);return db;
      });if(!claimed)return;
      const controller=new AbortController(),entry={user:claimed.user_id,controller,done:Promise.resolve()};this.executing.set(claimed.id,entry);entry.done=this.execute(claimed,controller).finally(()=>{this.executing.delete(claimed.id);});
    }finally{this.pumping=false;}
  }
  private async execute(db:{id:string;user_id:string;snapshot:Snapshot;value:Run;roleplay_id:string|null},controller:AbortController){
    let timer:ReturnType<typeof setTimeout>|undefined,raw:Promise<unknown>|undefined;
    try{
      await this.authorize(db);
      raw=Promise.resolve().then(()=>this.model.generate(db.snapshot,controller.signal));raw.catch(()=>{});
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ModelFailure('MODEL_TIMEOUT'));},this.config.timeoutMs);});
      const output=validateEvidenceV2(db.snapshot.kind,await Promise.race([raw,timeout]),db.snapshot.fields);
      await this.finish(db,output);
    }catch(error){const code=error instanceof ModelFailure?error.code:error instanceof Error&&'code' in error&&['PREVIEW_STALE','CONSENT_REQUIRED','UNAUTHORIZED','EMAIL_NOT_VERIFIED'].includes(String(error.code))?'PREVIEW_STALE':'MODEL_INVALID_OUTPUT';await this.finish(db,null,code).catch(()=>{this.lost();});}
    finally{if(timer)clearTimeout(timer);if(raw)await raw.catch(()=>{});}
  }
  private authorize(db:{id:string;user_id:string;snapshot:Snapshot}){return transaction(this.store.pool,async c=>{
    await c.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[db.user_id]);const row=(await c.query<AccountRow>('SELECT * FROM app.accounts WHERE id=$1 FOR UPDATE',[db.user_id])).rows[0];if(!row||row.consent_version!=='web-telegram-2'||!row.email_verified_at)fail('UNAUTHORIZED');
    const p=await this.previews.owned(c,row.id,db.snapshot.id);if(p.value.snapshotHash!==db.snapshot.snapshotHash||p.value.revision!==db.snapshot.revision||!p.value.confirmedAt)fail('PREVIEW_STALE');await this.previews.dependencies(c,row.id,db.snapshot,db.id);
  });}
  private async finish(db:{id:string;user_id:string;snapshot:Snapshot;roleplay_id:string|null},output:unknown,errorCode?:string){
    await transaction(this.store.pool,async c=>{
      await c.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[db.user_id]);const row=(await c.query<AccountRow>('SELECT * FROM app.accounts WHERE id=$1 FOR UPDATE',[db.user_id])).rows[0];if(!row)return;
      const old=(await c.query("SELECT value FROM app.product_runs WHERE id=$1 AND user_id=$2 AND value->>'status'='pending' FOR UPDATE",[db.id,row.id])).rows[0];if(!old)return;
      if(!errorCode){if(row.consent_version!=='web-telegram-2'||!row.email_verified_at)errorCode='PREVIEW_STALE';else{const current=await this.previews.owned(c,row.id,db.snapshot.id);if(current.value.snapshotHash!==db.snapshot.snapshotHash||current.value.revision!==db.snapshot.revision)errorCode='PREVIEW_STALE';else{try{await this.previews.dependencies(c,row.id,db.snapshot,db.id);}catch{errorCode='PREVIEW_STALE';}}}}
      if(!errorCode&&db.roleplay_id){const r=(await c.query('SELECT * FROM app.product_roles WHERE id=$1 AND user_id=$2 FOR UPDATE',[db.roleplay_id,row.id])).rows[0];if(!r||r.last_run_id!==db.id)errorCode='PREVIEW_STALE';else{const role=RoleplayV2.parse(r.value),result=output as {kind?:string;content?:string};const final=db.snapshot.kind==='roleplay_feedback'||role.turnCount===3;if((final&&result.kind!=='feedback')||(!final&&result.kind!=='message'))errorCode='MODEL_INVALID_OUTPUT';else{const next=RoleplayV2.parse({...role,status:final?'completed':'active',messages:final?role.messages:[...role.messages,{id:randomUUID(),sequence:role.messages.length,role:'assistant',content:result.content}],feedback:final?output:null});await c.query('UPDATE app.product_roles SET value=$3 WHERE id=$1 AND user_id=$2',[role.id,row.id,next]);}}}
      const value=RunV2.parse({...old.value,status:errorCode?'failed':'succeeded',phase:null,queuePosition:null,output:errorCode?null:output,errorCode:errorCode??null,updatedAt:new Date(this.store.now()).toISOString()});
      await c.query('UPDATE app.product_runs SET value=$3 WHERE id=$1 AND user_id=$2',[db.id,row.id,value]);
      if(!errorCode)await this.completed(c,row,value);
      await c.query('INSERT INTO app.product_deliveries(id,user_id,run_id,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING',[randomUUID(),row.id,db.id,new Date(this.store.now())]);
      const dialogues=this.previews.sessions.dialogues,state=await dialogues.read(c,row);if(state.step==='waiting_run'&&state.pendingRunId===db.id)await dialogues.save(c,row.id,dialogues.next(state,{step:'menu',navigation:{kind:'none'},pendingRunId:null}));
    });
  }
}

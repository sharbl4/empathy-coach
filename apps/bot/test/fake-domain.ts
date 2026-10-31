import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {outputFixtures} from '@between/contracts/fixtures';
import {sayDirectOutput} from '@between/contracts/domain-fixtures';
import type {Account,Dialogue,DomainDelivery,DomainFacade,DomainRun,DomainSessionDetail,PrivateTelegramIdentity,UserContext} from '@between/contracts/domain';

// TEST-ONLY implementation of the contract facade. Never imported by src/; production uses @between/api.createDomain.
type Acc=z.infer<typeof Account>;type Dlg=z.infer<typeof Dialogue>;type Detail=z.infer<typeof DomainSessionDetail>;
export class FakeDomainError extends Error {requestId='test';constructor(public code:string) {super(code);}}
const fail=(code:string):never=>{throw new FakeDomainError(code);};
const now=()=>new Date().toISOString();

export class FakeDomain implements DomainFacade {
  private abort=new AbortController();
  readonly shutdownSignal=this.abort.signal;
  private issued=new WeakSet<object>();
  calls:string[]=[];
  accounts=new Map<string,Acc>();
  dialogues=new Map<string,Dlg>();
  receipts=new Map<string,{intentKey:string;status:'processing'|'completed'}>();
  keys=new Map<string,{input:string;result:unknown}>();
  challenges=new Map<string,{account:string;code:string}>();
  store=new Map<string,{owner:string;detail:Detail}>();
  runs=new Map<string,{owner:string;run:DomainRun}>();
  deliveries=new Map<string,{owner:string;runId:string;attempt:number;done:boolean;failures:string[]}>();
  lastCode='';modelCalls=0;
  /** method name → number of upcoming DEPENDENCY_UNAVAILABLE failures. */
  transient=new Map<string,number>();
  offset=0;

  /** Any method call is recorded; transientOnce makes the named method fail once with DEPENDENCY_UNAVAILABLE. */
  private enter(name:string,ctx?:UserContext) {
    this.calls.push(name);
    const left=this.transient.get(name)??0;if(left>0){this.transient.set(name,left-1);fail('DEPENDENCY_UNAVAILABLE');}
    if(ctx&&!this.issued.has(ctx))fail('UNAUTHORIZED');
    if(ctx&&!this.accounts.has(ctx.accountId))fail('UNAUTHORIZED');
    return ctx?this.accounts.get(ctx.accountId)!:undefined;
  }
  private learning(ctx:UserContext) {const a=this.enter('learning',ctx)!;if(a.consentVersion!=='telegram-1')fail('CONSENT_REQUIRED');if(!a.emailVerified)fail('EMAIL_NOT_VERIFIED');return a;}
  private once<T>(ctx:UserContext,key:string,input:unknown,work:()=>T):T {
    const scoped=`${ctx.accountId}:${key}`,serial=JSON.stringify(input),prior=this.keys.get(scoped);
    if(prior){if(prior.input!==serial)fail('IDEMPOTENCY_CONFLICT');return structuredClone(prior.result) as T;}
    const result=work();this.keys.set(scoped,{input:serial,result:structuredClone(result)});return result;
  }
  private owned(ctx:UserContext,id:string) {const s=this.store.get(id);if(!s||s.owner!==ctx.accountId)fail('NOT_FOUND');return s!.detail;}

  async updateCursor() {this.enter('updateCursor');return {nextOffset:String(this.offset)};}
  async resolveUser(identity:z.infer<typeof PrivateTelegramIdentity>) {
    this.enter('resolveUser');
    let account=[...this.accounts.values()].find(a=>a.telegramUserId===identity.telegramUserId);
    if(!account){account={id:randomUUID(),telegramUserId:identity.telegramUserId,displayName:'Участник',emailVerified:false,consentVersion:null,onboardingCompletedAt:null};this.accounts.set(account.id,account);}
    const ctx=Object.freeze({accountId:account.id,telegramUserId:account.telegramUserId}) as UserContext;
    this.issued.add(ctx);return ctx;
  }
  async claimUpdate(ctx:UserContext,updateId:string) {
    this.enter('claimUpdate',ctx);
    if(!this.receipts.has(updateId))this.receipts.set(updateId,{intentKey:randomUUID(),status:'processing'});
    return {updateId,...this.receipts.get(updateId)!};
  }
  async acknowledgeUpdate(updateId:string) {
    this.enter('acknowledgeUpdate');
    const r=this.receipts.get(updateId);if(r)r.status='completed';else this.receipts.set(updateId,{intentKey:randomUUID(),status:'completed'});
    this.offset=Math.max(this.offset,Number(updateId)+1);
  }
  async account(ctx:UserContext) {return {...this.enter('account',ctx)!};}
  async updateAccount(ctx:UserContext,input:{displayName?:string;onboardingCompleted?:true},key:string) {
    const a=this.enter('updateAccount',ctx)!;
    return this.once(ctx,key,input,()=>{if(input.onboardingCompleted)a.onboardingCompletedAt??=now();return {...a};});
  }
  async acceptConsent(ctx:UserContext,input:{policyVersion:'telegram-1';accepted:true},key:string) {const a=this.enter('acceptConsent',ctx)!;return this.once(ctx,key,input,()=>{a.consentVersion=input.policyVersion;return {...a};});}
  async revokeConsent(ctx:UserContext,key:string) {const a=this.enter('revokeConsent',ctx)!;this.once(ctx,key,{},()=>{a.consentVersion=null;});}
  async requestEmailCode(ctx:UserContext,input:{email:string},key:string) {
    this.enter('requestEmailCode',ctx);if(this.accounts.get(ctx.accountId)!.consentVersion!=='telegram-1')fail('CONSENT_REQUIRED');
    return this.once(ctx,key,input,()=>{
      const challengeId=randomUUID();this.lastCode=String(100000+Math.floor(Math.random()*899999));
      for(const [id,c] of this.challenges)if(c.account===ctx.accountId)this.challenges.delete(id);
      this.challenges.set(challengeId,{account:ctx.accountId,code:this.lastCode});
      return {challengeId,expiresAt:new Date(Date.now()+600000).toISOString(),resendAfter:new Date(Date.now()+60000).toISOString()};
    });
  }
  async verifyEmailCode(ctx:UserContext,input:{challengeId:string;code:string},key:string) {
    const a=this.enter('verifyEmailCode',ctx)!;
    const c=this.challenges.get(input.challengeId);
    if(!c||c.account!==ctx.accountId)fail('CODE_EXPIRED');
    if(c!.code!==input.code)fail('CODE_INVALID');
    return this.once(ctx,key,input,()=>{this.challenges.delete(input.challengeId);a.emailVerified=true;return {...a};});
  }
  async dialogue(ctx:UserContext) {this.enter('dialogue',ctx);return structuredClone(this.dialogues.get(ctx.accountId)??{revision:1,stage:'onboarding',draft:{},sessionId:null,roleplayId:null,pendingRunId:null} as Dlg);}
  async updateDialogue(ctx:UserContext,input:Omit<Dlg,'revision'|'pendingRunId'>&{expectedRevision:number},key:string) {
    this.enter('updateDialogue',ctx);
    return this.once(ctx,key,input,()=>{
      const cur=this.dialogues.get(ctx.accountId)??{revision:1,stage:'onboarding',draft:{},sessionId:null,roleplayId:null,pendingRunId:null} as Dlg;
      if(cur.revision!==input.expectedRevision)fail('REVISION_CONFLICT');
      for(const ref of [input.sessionId]){if(ref)this.owned(ctx,ref);}
      const next:Dlg={revision:cur.revision+1,stage:input.stage,draft:structuredClone(input.draft),sessionId:input.sessionId,roleplayId:input.roleplayId,pendingRunId:cur.pendingRunId};
      this.dialogues.set(ctx.accountId,next);return structuredClone(next);
    });
  }
  async resetDialogue(ctx:UserContext,expectedRevision:number,key:string) {return this.updateDialogue(ctx,{expectedRevision,stage:'menu',draft:{},sessionId:null,roleplayId:null},key);}

  async createSession(ctx:UserContext,input:Parameters<DomainFacade['createSession']>[1],key:string) {
    this.learning(ctx);
    return this.once(ctx,key,input,()=>{
      const detail:Detail={id:randomUUID(),...structuredClone(input),revision:1,createdAt:now(),updatedAt:now(),runs:[],roleplays:[]};
      this.store.set(detail.id,{owner:ctx.accountId,detail});
      const {runs:_r,roleplays:_p,...session}=detail;void _r;void _p;return session;
    });
  }
  async sessions(ctx:UserContext,q:{cursor?:string;limit:number}) {
    this.learning(ctx);
    const all=[...this.store.values()].filter(s=>s.owner===ctx.accountId).map(s=>s.detail).reverse();
    const start=q.cursor?Number(q.cursor):0;
    return {items:all.slice(start,start+q.limit).map(({runs:_r,roleplays:_p,...s})=>{void _r;void _p;return s;}),nextCursor:start+q.limit<all.length?String(start+q.limit):null};
  }
  async session(ctx:UserContext,id:string) {this.learning(ctx);return structuredClone(this.owned(ctx,id));}
  async updateSession():Promise<never> {return fail('VALIDATION_ERROR');}
  async deleteSession(ctx:UserContext,id:string,key:string) {this.learning(ctx);this.once(ctx,key,{id},()=>{this.owned(ctx,id);this.store.delete(id);});}
  async deleteData(ctx:UserContext,input:unknown,key:string) {this.enter('deleteData',ctx);this.once(ctx,key,input,()=>{for(const [id,s] of this.store)if(s.owner===ctx.accountId)this.store.delete(id);});}
  async deleteAccount(ctx:UserContext,input:unknown,key:string) {this.enter('deleteAccount',ctx);this.once(ctx,key,input,()=>{for(const [id,s] of this.store)if(s.owner===ctx.accountId)this.store.delete(id);this.dialogues.delete(ctx.accountId);this.accounts.delete(ctx.accountId);});}

  private submit(ctx:UserContext,sid:string,kind:DomainRun['kind'],key:string,input:unknown,before?:(d:Detail)=>string|void) {
    this.enter(kind,ctx);this.learning(ctx);
    return this.once(ctx,key,input,()=>{
      const d=this.owned(ctx,sid);
      if([...this.runs.values()].some(r=>r.owner===ctx.accountId&&r.run.status==='pending'))fail('OPERATION_IN_PROGRESS');
      const resourceId=before?.(d);
      const run={id:randomUUID(),sessionId:sid,revision:d.revision,kind,status:'pending',output:null,errorCode:null,createdAt:now(),updatedAt:now()} as DomainRun;
      this.runs.set(run.id,{owner:ctx.accountId,run});d.runs.unshift(run as Detail['runs'][number]);
      return {runId:run.id,...(resourceId?{resourceId}:{})};
    });
  }
  private role(ctx:UserContext,rid:string) {for(const s of this.store.values())if(s.owner===ctx.accountId){const r=s.detail.roleplays.find(x=>x.id===rid);if(r)return {s:s.detail,r};}return fail('NOT_FOUND');}
  async analyze(ctx:UserContext,id:string,input:{expectedRevision:number},key:string) {return this.submit(ctx,id,'analysis',key,input);}
  async replyFeedback(ctx:UserContext,id:string,input:{expectedRevision:number;draft:string},key:string) {return this.submit(ctx,id,'reply_feedback',key,input);}
  async replyExamples(ctx:UserContext,id:string,input:{expectedRevision:number},key:string) {return this.submit(ctx,id,'reply_examples',key,input);}
  async exercise(ctx:UserContext,id:string,input:{expectedRevision:number},key:string) {return this.submit(ctx,id,'exercise',key,input);}
  async exerciseFeedback(ctx:UserContext,id:string,input:{expectedRevision:number;exerciseRunId:string;answer:string},key:string) {
    const d=this.owned(ctx,id);if(!d.runs.some(r=>r.id===input.exerciseRunId&&r.kind==='exercise'))fail('NOT_FOUND');
    return this.submit(ctx,id,'exercise_feedback',key,input);
  }
  async roleplayStart(ctx:UserContext,id:string,input:{expectedRevision:number},key:string) {
    return this.submit(ctx,id,'roleplay_start',key,input,d=>{const rid=randomUUID();d.roleplays.unshift({id:rid,sessionId:id,revision:d.revision,status:'active',turnCount:0,messages:[],feedback:null});return rid;});
  }
  async roleplayTurn(ctx:UserContext,rid:string,input:{expectedRevision:number;content:string},key:string) {
    const {s}=this.role(ctx,rid);
    return this.submit(ctx,s.id,'roleplay_turn',key,input,d=>{const r=d.roleplays.find(x=>x.id===rid)!;r.messages.push({id:randomUUID(),sequence:r.messages.length,role:'user',content:input.content});r.turnCount++;});
  }
  async roleplayFinish(ctx:UserContext,rid:string,input:{expectedRevision:number},key:string) {const {s}=this.role(ctx,rid);return this.submit(ctx,s.id,'roleplay_feedback',key,input);}
  async sayDirect(ctx:UserContext,id:string,input:unknown,key:string) {return this.submit(ctx,id,'say_direct',key,input);}
  async retry(ctx:UserContext,id:string,input:{expectedRevision:number},key:string) {
    const r=this.runs.get(id);if(!r||r.owner!==ctx.accountId)fail('NOT_FOUND');
    return this.submit(ctx,r!.run.sessionId,r!.run.kind,key,{id,...input});
  }
  async run(ctx:UserContext,id:string) {this.learning(ctx);const r=this.runs.get(id);if(!r||r.owner!==ctx.accountId||!this.store.has(r.run.sessionId))fail('NOT_FOUND');return structuredClone(r!.run);}
  async progress(ctx:UserContext) {this.learning(ctx);return {analyzedSessions:[...this.runs.values()].filter(r=>r.owner===ctx.accountId&&r.run.kind==='analysis'&&r.run.status==='succeeded').length,completedExercises:0,completedRoleplays:0,skills:[],latestTip:null};}

  async claimDeliveries(limit:number):Promise<DomainDelivery[]> {
    this.enter('claimDeliveries');
    const out:DomainDelivery[]=[];
    for(const [id,d] of this.deliveries){
      if(d.done||out.length>=limit)continue;
      const r=this.runs.get(d.runId);if(!r||!this.accounts.has(d.owner))continue;
      const a=this.accounts.get(d.owner)!,ctx=Object.freeze({accountId:a.id,telegramUserId:a.telegramUserId}) as UserContext;this.issued.add(ctx);
      d.attempt++;out.push({id,context:ctx,run:structuredClone(r.run),attempt:d.attempt});
    }
    return out;
  }
  async completeDelivery(ctx:UserContext,id:string) {this.enter('completeDelivery',ctx);const d=this.deliveries.get(id);if(!d||d.owner!==ctx.accountId)fail('NOT_FOUND');d!.done=true;}
  async failDelivery(ctx:UserContext,id:string,failure:{code:string}) {
    this.enter('failDelivery',ctx);const d=this.deliveries.get(id)!;d.failures.push(failure.code);
    if(failure.code==='CHAT_UNAVAILABLE'||d.attempt>=3)d.done=true;
  }
  async health() {return {database:true,pollerLease:true};}
  async close() {this.abort.abort();}

  // ---- test hooks standing in for the GPU worker
  complete(runId:string,output?:unknown) {
    const r=this.runs.get(runId)!;this.modelCalls++;
    const s=this.store.get(r.run.sessionId)?.detail,role=s?.roleplays.find(x=>x.status==='active');
    let value=output;
    if(value===undefined){
      if(r.run.kind==='say_direct')value=sayDirectOutput;
      else if(r.run.kind==='roleplay_turn')value=role&&role.turnCount>=3?outputFixtures.roleplay_feedback:outputFixtures.roleplay_turn;
      else value=outputFixtures[r.run.kind as keyof typeof outputFixtures];
    }
    this.settle(runId,{status:'succeeded',output:value});
    if(role&&r.run.kind.startsWith('roleplay')){
      const out=value as {kind:string;content?:string};
      if(out.kind==='message')role.messages.push({id:randomUUID(),sequence:role.messages.length,role:'assistant',content:out.content!});
      else Object.assign(role,{status:'completed',feedback:value});
    }
  }
  failRun(runId:string,code='MODEL_UNAVAILABLE') {this.settle(runId,{status:'failed',errorCode:code});}
  private settle(runId:string,patch:object) {
    const r=this.runs.get(runId)!;Object.assign(r.run,patch);
    const listed=this.store.get(r.run.sessionId)?.detail.runs.find(x=>x.id===runId);if(listed)Object.assign(listed,patch);
    this.deliveries.set(randomUUID(),{owner:r.owner,runId,attempt:0,done:false,failures:[]});
  }
  pending() {return [...this.runs.values()].find(r=>r.run.status==='pending')?.run;}
}

import {createHash,randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {analysisFixture,assessmentFixture,cardFixture,directFixture,practiceFixture,reminderFixture} from '@between/contracts/product-fixtures';
import {DialoguePatch,DomainError,UPDATE_MAX_ATTEMPTS,domainRetryPolicy,type Account,type Delivery,type DialogueV2,type DomainFailure,type EmailVerificationStatus,type Example,type Preview,type PreviewSource,type PrivateTelegramIdentity,type ProductFacade,type RoleplayV2,type RunV2,type SessionInputV2,type UserContext} from '@between/contracts/product';

// TEST-ONLY implementation of the v2 ProductFacade (only what the transport calls). Never imported by src/.
type Acc=z.infer<typeof Account>;type Dlg=z.infer<typeof DialogueV2>;type Input=z.infer<typeof SessionInputV2>;
type Pv=z.infer<typeof Preview>;type Run=z.infer<typeof RunV2>;type Role=z.infer<typeof RoleplayV2>;
const fail=(code:DomainFailure['code']):never=>{throw new DomainError({code,requestId:'test'});};
const now=()=>new Date().toISOString();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const mask=(v:string)=>{let n=0;const out=v.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,()=>{n++;return '[почта скрыта]';}).replace(/\+?\d[\d\s()-]{8,}\d/g,()=>{n++;return '[телефон скрыт]';});return {out,n};};
const sessionFields=(i:Input)=>i.mode==='understand'?[['Сообщение',i.message]]:i.mode==='thread'?i.turns.map(x=>[x.speaker==='self'?'Моя реплика':'Реплика собеседника',x.text]):[['Мой текст',i.draft]];

export class FakeProduct {
  private abort=new AbortController();
  readonly shutdownSignal=this.abort.signal;
  private issued=new WeakSet<object>();
  calls:string[]=[];
  accounts=new Map<string,Acc>();
  dialogues=new Map<string,Dlg>();
  receipts=new Map<string,{intentKey:string;status:'processing'|'completed'|'retry_wait'|'failed';attempts:number;nextAttemptAt:string|null;failure:DomainFailure|null}>();
  /** Simulated clock offset for retry_wait (tests advance it instead of sleeping). */
  clockSkewMs=0;
  keys=new Map<string,{input:string;result:unknown}>();
  challenges=new Map<string,{account:string;code:string;email:string;state:'sent'|'expired'|'locked';attempts:number;active:boolean;resendAfter:number}>();
  deliveryFailsFor=new Set<string>();
  store=new Map<string,{owner:string;id:string;input:Input;revision:number;createdAt:string;updatedAt:string}>();
  previews=new Map<string,{owner:string;preview:Pv;source:z.infer<typeof PreviewSource>}>();
  runs=new Map<string,{owner:string;run:Run}>();
  roles=new Map<string,{owner:string;role:Role}>();
  deliveries=new Map<string,{owner:string;item:{kind:'run';runId:string}|{kind:'reminder'};attempt:number;done:boolean;failures:string[]}>();
  votes=new Map<string,string>();completions=new Set<string>();
  reminderState={...reminderFixture};
  lastCode='';modelCalls=0;offset=0;
  transient=new Map<string,number>();
  /** method name → upcoming unknown (non-domain) errors, to check they are terminal. */
  unknown=new Map<string,number>();

  private enter(name:string,ctx?:UserContext) {
    this.calls.push(name);
    const left=this.transient.get(name)??0;if(left>0){this.transient.set(name,left-1);fail('DEPENDENCY_UNAVAILABLE');}
    const bug=this.unknown.get(name)??0;if(bug>0){this.unknown.set(name,bug-1);throw new TypeError('unexpected bug with private detail');}
    if(ctx&&(!this.issued.has(ctx)||!this.accounts.has(ctx.accountId)))fail('UNAUTHORIZED');
    return ctx?this.accounts.get(ctx.accountId)!:undefined;
  }
  private learning(name:string,ctx:UserContext) {const a=this.enter(name,ctx)!;if(a.consentVersion!=='web-telegram-2')fail('CONSENT_REQUIRED');if(!a.emailVerified)fail('EMAIL_NOT_VERIFIED');return a;}
  private once<T>(ctx:UserContext,key:string,input:unknown,work:()=>T):T {
    const scoped=`${ctx.accountId}:${key}`,serial=JSON.stringify(input),prior=this.keys.get(scoped);
    if(prior){if(prior.input!==serial)fail('IDEMPOTENCY_CONFLICT');return structuredClone(prior.result) as T;}
    const result=work();this.keys.set(scoped,{input:serial,result:structuredClone(result)});return result;
  }
  private owned(ctx:UserContext,id:string) {const s=this.store.get(id);if(!s||s.owner!==ctx.accountId)fail('NOT_FOUND');return s!;}
  private session_(s:{id:string;input:Input;revision:number;createdAt:string;updatedAt:string}) {return {id:s.id,input:structuredClone(s.input),revision:s.revision,createdAt:s.createdAt,updatedAt:s.updatedAt};}

  // ---- lifecycle used by the transport
  async updateCursor() {this.enter('updateCursor');return {nextOffset:String(this.offset)};}
  async resolveUser(identity:z.infer<typeof PrivateTelegramIdentity>) {
    this.enter('resolveUser');
    let a=[...this.accounts.values()].find(x=>x.telegramUserId===identity.telegramUserId);
    if(!a){a={id:randomUUID(),telegramUserId:identity.telegramUserId,displayName:'Участник',emailVerified:false,consentVersion:null,onboardingCompletedAt:null};this.accounts.set(a.id,a);}
    const ctx=Object.freeze({accountId:a.id,telegramUserId:a.telegramUserId,transport:'telegram'}) as UserContext;this.issued.add(ctx);return ctx;
  }
  private receipt(updateId:string) {const r=this.receipts.get(updateId)!;return {updateId,intentKey:r.intentKey,status:r.status,attempts:r.attempts,nextAttemptAt:r.nextAttemptAt,failure:r.failure};}
  async claimUpdate(ctx:UserContext,updateId:string) {
    this.enter('claimUpdate',ctx);
    const r=this.receipts.get(updateId);
    if(!r)this.receipts.set(updateId,{intentKey:randomUUID(),status:'processing',attempts:1,nextAttemptAt:null,failure:null});
    else if(r.status==='retry_wait'&&Date.parse(r.nextAttemptAt!)<=Date.now()+this.clockSkewMs)Object.assign(r,{status:'processing',attempts:r.attempts+1,nextAttemptAt:null});
    return this.receipt(updateId);
  }
  async recordUpdateFailure(ctx:UserContext,input:{updateId:string;failure:DomainFailure}) {
    this.enter('recordUpdateFailure',ctx);
    const r=this.receipts.get(input.updateId)!;
    const retry=domainRetryPolicy(input.failure,'idempotent_mutation').retryable&&r.attempts<UPDATE_MAX_ATTEMPTS;
    Object.assign(r,retry?{status:'retry_wait',nextAttemptAt:new Date(Date.now()+this.clockSkewMs+1000).toISOString(),failure:input.failure}:{status:'failed',nextAttemptAt:null,failure:input.failure});
    return this.receipt(input.updateId);
  }
  async acknowledgeUpdate(updateId:string) {
    this.enter('acknowledgeUpdate');
    const r=this.receipts.get(updateId);
    // A failed receipt stays failed: acknowledge only advances the cursor.
    if(r&&r.status==='processing')r.status='completed';
    else if(!r)this.receipts.set(updateId,{intentKey:randomUUID(),status:'completed',attempts:1,nextAttemptAt:null,failure:null});
    this.offset=Math.max(this.offset,Number(updateId)+1);
  }
  async claimDeliveries(limit:number):Promise<Delivery[]> {
    this.enter('claimDeliveries');const out:Delivery[]=[];
    for(const [id,d] of this.deliveries){
      if(d.done||out.length>=limit||!this.accounts.has(d.owner))continue;
      const a=this.accounts.get(d.owner)!,ctx=Object.freeze({accountId:a.id,telegramUserId:a.telegramUserId,transport:'telegram'}) as UserContext;this.issued.add(ctx);d.attempt++;
      if(d.item.kind==='run'){const r=this.runs.get(d.item.runId);if(!r)continue;out.push({id,context:ctx,attempt:d.attempt,kind:'run',run:structuredClone(r.run)});}
      else out.push({id,context:ctx,attempt:d.attempt,kind:'reminder',notification:{kind:'daily_practice',practiceId:practiceFixture.id,contentVersion:practiceFixture.contentVersion,localDate:practiceFixture.localDate,title:practiceFixture.title}});
    }
    return out;
  }
  async completeDelivery(ctx:UserContext,id:string) {this.enter('completeDelivery',ctx);const d=this.deliveries.get(id);if(!d||d.owner!==ctx.accountId)fail('NOT_FOUND');d!.done=true;}
  async failDelivery(ctx:UserContext,id:string,failure:{code:string}) {this.enter('failDelivery',ctx);const d=this.deliveries.get(id)!;d.failures.push(failure.code);if(failure.code==='CHAT_UNAVAILABLE'||d.attempt>=3)d.done=true;}
  async issueWebLink(ctx:UserContext,key:string) {this.learning('issueWebLink',ctx);return this.once(ctx,key,{},()=>({id:randomUUID(),webUrl:`http://127.0.0.1:3011/auth/connect#token=${'A'.repeat(43)}`,expiresAt:new Date(Date.now()+300000).toISOString()}));}
  async webSessions(ctx:UserContext) {this.learning('webSessions',ctx);return {items:[{id:randomUUID(),createdAt:now(),expiresAt:now(),isCurrent:false}],nextCursor:null};}
  async revokeAllWebSessions(ctx:UserContext) {this.enter('revokeAllWebSessions',ctx);}
  async health() {return {database:true,workers:true,scheduler:true,pollerLease:true};}
  async close() {this.abort.abort();}

  // ---- account
  async account(ctx:UserContext) {return {...this.enter('account',ctx)!};}
  async updateAccount(ctx:UserContext,input:{onboardingCompleted?:true},key:string) {const a=this.enter('updateAccount',ctx)!;return this.once(ctx,key,input,()=>{if(input.onboardingCompleted)a.onboardingCompletedAt??=now();return {...a};});}
  async acceptConsent(ctx:UserContext,input:{policyVersion:'web-telegram-2'},key:string) {const a=this.enter('acceptConsent',ctx)!;return this.once(ctx,key,input,()=>{a.consentVersion=input.policyVersion;return {...a};});}
  async revokeConsent(ctx:UserContext,_i:unknown,key:string) {const a=this.enter('revokeConsent',ctx)!;return this.once(ctx,key,{},()=>{a.consentVersion=null;return null;});}
  private status(account:string):z.infer<typeof EmailVerificationStatus> {
    const a=this.accounts.get(account)!;
    const c=[...this.challenges.entries()].find(([,x])=>x.account===account&&x.active);
    if(!c)return a.emailVerified?{state:'verified'}:{state:'none'};
    const [challengeId,x]=c,masked=x.email.replace(/^(.{0,2})[^@]*(@.*)$/,'$1***$2');
    const state=this.deliveryFailsFor.has(x.email)?'failed':x.state;
    return {state:'challenge',challenge:{challengeId,state,maskedEmail:masked,expiresAt:new Date(Date.now()+600000).toISOString(),resendAfter:new Date(x.resendAfter).toISOString(),attemptsRemaining:x.attempts}};
  }
  private issue(account:string,email:string) {
    for(const x of this.challenges.values())if(x.account===account)x.active=false;
    const challengeId=randomUUID();this.lastCode=String(100000+Math.floor(Math.random()*899999));
    this.challenges.set(challengeId,{account,code:this.lastCode,email,state:'sent',attempts:5,active:true,resendAfter:Date.now()+60000});
  }
  async emailVerification(ctx:UserContext) {this.enter('emailVerification',ctx);return this.status(ctx.accountId);}
  async requestEmailCode(ctx:UserContext,input:{email:string},key:string) {
    const a=this.enter('requestEmailCode',ctx)!;if(a.consentVersion!=='web-telegram-2')fail('CONSENT_REQUIRED');
    return this.once(ctx,key,input,()=>{this.issue(ctx.accountId,input.email);return this.status(ctx.accountId);});
  }
  async resendEmailCode(ctx:UserContext,input:{challengeId:string},key:string) {
    this.enter('resendEmailCode',ctx);
    return this.once(ctx,key,input,()=>{
      const x=this.challenges.get(input.challengeId);if(!x||x.account!==ctx.accountId)fail('NOT_FOUND');
      if(!x!.active)fail('REVISION_CONFLICT');if(Date.now()+this.clockSkewMs<x!.resendAfter)fail('RATE_LIMITED');
      this.issue(ctx.accountId,x!.email);return this.status(ctx.accountId);
    });
  }
  async verifyEmailCode(ctx:UserContext,input:{challengeId:string;code:string},key:string) {
    const a=this.enter('verifyEmailCode',ctx)!,x=this.challenges.get(input.challengeId);
    if(!x||x.account!==ctx.accountId)fail('NOT_FOUND');if(!x!.active)fail('REVISION_CONFLICT');
    if(x!.state==='locked')fail('CODE_INVALID');
    if(x!.code!==input.code){x!.attempts--;if(x!.attempts<=0)x!.state='locked';fail('CODE_INVALID');}
    return this.once(ctx,key,input,()=>{x!.active=false;a.emailVerified=true;return {account:{...a},verification:{state:'verified' as const}};});
  }
  stages:unknown[]=[];
  async recordStage(ctx:UserContext,input:unknown) {this.enter('recordStage',ctx);this.stages.push(input);return null;}
  async deleteData(ctx:UserContext,input:unknown,key:string) {this.enter('deleteData',ctx);return this.once(ctx,key,input,()=>{for(const [id,s] of this.store)if(s.owner===ctx.accountId)this.store.delete(id);return null;});}
  async deleteAccount(ctx:UserContext,input:unknown,key:string) {this.enter('deleteAccount',ctx);return this.once(ctx,key,input,()=>{for(const [id,s] of this.store)if(s.owner===ctx.accountId)this.store.delete(id);this.accounts.delete(ctx.accountId);this.dialogues.delete(ctx.accountId);return null;});}

  // ---- dialogue
  private blank():Dlg {const created=Date.now();return {revision:1,step:'onboarding',draft:{},navigation:{kind:'none'},sessionId:null,previewId:null,roleplayId:null,pendingRunId:null,createdAt:new Date(created).toISOString(),expiresAt:new Date(created+3600000).toISOString()};}
  async dialogue(ctx:UserContext) {this.enter('dialogue',ctx);return structuredClone(this.dialogues.get(ctx.accountId)??this.blank());}
  async updateDialogue(ctx:UserContext,input:Omit<Dlg,'revision'|'pendingRunId'|'createdAt'|'expiresAt'>&{expectedRevision:number},key:string) {
    this.enter('updateDialogue',ctx);
    // The real contract schema: invalid step/navigation combinations fail here as they would in the domain.
    if(!DialoguePatch.safeParse(input).success)fail('VALIDATION_ERROR');
    return this.once(ctx,key,input,()=>{
      const cur=this.dialogues.get(ctx.accountId)??this.blank();if(cur.revision!==input.expectedRevision)fail('REVISION_CONFLICT');
      if(input.sessionId)this.owned(ctx,input.sessionId);
      if(input.previewId){const p=this.previews.get(input.previewId);if(!p||p.owner!==ctx.accountId)fail('NOT_FOUND');}
      const {expectedRevision:_e,...rest}=input;void _e;
      const next:Dlg={...structuredClone(rest),revision:cur.revision+1,pendingRunId:cur.pendingRunId,createdAt:cur.createdAt,expiresAt:new Date(Date.now()+3600000).toISOString()};this.dialogues.set(ctx.accountId,next);return structuredClone(next);
    });
  }
  async resetDialogue(ctx:UserContext,input:{expectedRevision:number},key:string) {return this.updateDialogue(ctx,{expectedRevision:input.expectedRevision,step:'menu',draft:{},navigation:{kind:'none'},sessionId:null,previewId:null,roleplayId:null},key);}

  // ---- sessions
  async createSession(ctx:UserContext,input:Input,key:string) {
    this.learning('createSession',ctx);
    return this.once(ctx,key,input,()=>{const s={owner:ctx.accountId,id:randomUUID(),input:structuredClone(input),revision:1,createdAt:now(),updatedAt:now()};this.store.set(s.id,s);return this.session_(s);});
  }
  async sessions(ctx:UserContext,q:{cursor?:string;limit:number;contextType?:string;q?:string}) {
    this.learning('sessions',ctx);
    const all=[...this.store.values()].filter(s=>s.owner===ctx.accountId&&(!q.contextType||s.input.contextType===q.contextType)&&(!q.q||s.input.title.toLowerCase().includes(q.q.toLowerCase()))).reverse();
    const start=q.cursor?Number(q.cursor):0;
    return {items:all.slice(start,start+q.limit).map(s=>this.session_(s)),nextCursor:start+q.limit<all.length?String(start+q.limit):null};
  }
  async session(ctx:UserContext,q:{id:string}) {
    this.learning('session',ctx);const s=this.owned(ctx,q.id);
    const runs=[...this.runs.values()].filter(r=>r.owner===ctx.accountId&&r.run.sessionId===s.id).map(r=>structuredClone(r.run)).reverse();
    return {...this.session_(s),runs:{items:runs,nextCursor:null},roleplays:await this.roleplays(ctx,{sessionId:s.id,limit:20})};
  }
  async updateSession(ctx:UserContext,input:{id:string;expectedRevision:number;input:Input},key:string) {
    this.learning('updateSession',ctx);
    return this.once(ctx,key,input,()=>{const s=this.owned(ctx,input.id);if(s.revision!==input.expectedRevision)fail('REVISION_CONFLICT');s.input=structuredClone(input.input);s.revision++;s.updatedAt=now();return this.session_(s);});
  }
  async deleteSession(ctx:UserContext,input:{id:string;expectedRevision:number},key:string) {this.learning('deleteSession',ctx);return this.once(ctx,key,input,()=>{const s=this.owned(ctx,input.id);if(s.revision!==input.expectedRevision)fail('REVISION_CONFLICT');this.store.delete(input.id);return null;});}
  async roleplays(ctx:UserContext,q:{sessionId:string;limit:number}) {this.learning('roleplays',ctx);this.owned(ctx,q.sessionId);return {items:[...this.roles.values()].filter(r=>r.owner===ctx.accountId&&r.role.sessionId===q.sessionId).map(r=>structuredClone(r.role)).reverse(),nextCursor:null};}

  // ---- preview → confirm → run
  async createPreview(ctx:UserContext,source:z.infer<typeof PreviewSource>,key:string) {
    this.learning('createPreview',ctx);
    return this.once(ctx,key,source,()=>{
      let sessionId:string|null=null,sessionRevision:number|null=null,raw:[string,string][]=[];
      if('sessionId' in source){const s=this.owned(ctx,source.sessionId);if(s.revision!==source.expectedRevision)fail('REVISION_CONFLICT');sessionId=s.id;sessionRevision=s.revision;raw=sessionFields(s.input) as [string,string][];}
      if('roleplayId' in source){const r=this.roles.get(source.roleplayId);if(!r||r.owner!==ctx.accountId)fail('NOT_FOUND');sessionId=r!.role.sessionId;sessionRevision=this.owned(ctx,sessionId).revision;}
      if(source.kind==='reply_feedback')raw.push(['Мой черновик',source.draft]);
      if(source.kind==='exercise_feedback')raw.push(['Моя попытка',source.answer]);
      if(source.kind==='roleplay_turn')raw.push(['Мой ответ',source.content]);
      if(source.kind==='card_feedback')raw.push(['Моя попытка',source.answer]);
      if(!raw.length)raw.push(['Задание',source.kind]);
      let count=0;
      const fields=raw.map(([label,value])=>{const m=mask(value);count+=m.n;return {id:randomUUID(),label,value:m.out,editable:true};});
      const safety=fields.some(x=>/убью тебя/i.test(x.value))?'support' as const:'none' as const;
      const preview:Pv={id:randomUUID(),revision:1,kind:source.kind,sessionId,sessionRevision,dependencies:sessionId?[{kind:'session',id:sessionId,revision:sessionRevision!}]:[],templateHash:'b'.repeat(64),fields,turns:[],redactionCount:count,budget:{contextWindow:4096,templateTokens:100,systemTokens:200,inputTokens:50,maxOutputTokens:1400,reserveTokens:128,fit:'fits'},modelRevision:'synthetic',promptVersion:'between-product-v2',snapshotHash:hash(fields),confirmedAt:null,safety};
      this.previews.set(preview.id,{owner:ctx.accountId,preview,source});return preview;
    });
  }
  async preview(ctx:UserContext,q:{id:string}) {this.learning('preview',ctx);const p=this.previews.get(q.id);if(!p||p.owner!==ctx.accountId)fail('NOT_FOUND');return structuredClone(p!.preview);}
  async editPreview(ctx:UserContext,input:{id:string;expectedRevision:number;edits:{fieldId:string;value:string}[]},key:string) {
    this.learning('editPreview',ctx);
    return this.once(ctx,key,input,()=>{
      const p=this.previews.get(input.id);if(!p||p.owner!==ctx.accountId)fail('NOT_FOUND');if(p!.preview.revision!==input.expectedRevision)fail('REVISION_CONFLICT');
      const pv=p!.preview;for(const e of input.edits){const f=pv.fields.find(x=>x.id===e.fieldId);if(!f||!f.editable)fail('VALIDATION_ERROR');const m=mask(e.value);f!.value=m.out;pv.redactionCount+=m.n;}
      pv.revision++;pv.confirmedAt=null;pv.snapshotHash=hash(pv.fields);return structuredClone(pv);
    });
  }
  async confirmPreview(ctx:UserContext,input:{id:string;expectedRevision:number;snapshotHash:string},key:string) {
    this.learning('confirmPreview',ctx);
    return this.once(ctx,key,input,()=>{const p=this.previews.get(input.id);if(!p||p.owner!==ctx.accountId)fail('NOT_FOUND');const pv=p!.preview;
      if(pv.revision!==input.expectedRevision||pv.snapshotHash!==input.snapshotHash)fail('PREVIEW_STALE');pv.confirmedAt=now();
      return {id:pv.id,revision:pv.revision,snapshotHash:pv.snapshotHash,confirmedAt:pv.confirmedAt,expiresAt:new Date(Date.now()+600000).toISOString()};});
  }
  async startRun(ctx:UserContext,input:{previewId:string;previewRevision:number;snapshotHash:string;expectedSessionRevision:number|null},key:string) {
    this.learning('startRun',ctx);
    return this.once(ctx,key,input,()=>{
      const p=this.previews.get(input.previewId);if(!p||p.owner!==ctx.accountId)fail('NOT_FOUND');const pv=p!.preview;
      if(!pv.confirmedAt)fail('PREVIEW_NOT_CONFIRMED');if(pv.revision!==input.previewRevision||pv.snapshotHash!==input.snapshotHash)fail('PREVIEW_STALE');
      if([...this.runs.values()].some(r=>r.owner===ctx.accountId&&r.run.status==='pending'))fail('OPERATION_IN_PROGRESS');
      let resourceId:string|undefined;const src=p!.source;
      if(src.kind==='roleplay_start'){resourceId=randomUUID();this.roles.set(resourceId,{owner:ctx.accountId,role:{id:resourceId,sessionId:pv.sessionId!,revision:pv.sessionRevision!,difficulty:src.difficulty,status:'active',turnCount:0,messages:[],feedback:null}});}
      if(src.kind==='roleplay_turn'){const r=this.roles.get(src.roleplayId)!.role;r.messages.push({id:randomUUID(),sequence:r.messages.length,role:'user',content:pv.fields.at(-1)!.value});r.turnCount++;}
      const run={id:randomUUID(),sessionId:pv.sessionId,revision:pv.sessionRevision??1,previewId:pv.id,previewRevision:pv.revision,modelRevision:'synthetic',promptVersion:'between-product-v2',kind:pv.kind,status:'pending',phase:'queued',queuePosition:1,output:null,errorCode:null,createdAt:now(),updatedAt:now()} as Run;
      this.runs.set(run.id,{owner:ctx.accountId,run});return {runId:run.id,...(resourceId?{resourceId}:{})};
    });
  }
  async run(ctx:UserContext,q:{id:string}) {this.learning('run',ctx);const r=this.runs.get(q.id);if(!r||r.owner!==ctx.accountId||(r.run.sessionId&&!this.store.has(r.run.sessionId)))fail('NOT_FOUND');return structuredClone(r!.run);}
  async retry(ctx:UserContext,input:{id:string;previewId:string;previewRevision:number;snapshotHash:string},key:string) {
    this.learning('retry',ctx);const r=this.runs.get(input.id);if(!r||r.owner!==ctx.accountId)fail('NOT_FOUND');
    if(this.previews.get(input.previewId)?.preview.snapshotHash!==input.snapshotHash)fail('PREVIEW_STALE');
    return this.once(ctx,key,input,()=>{const run={...structuredClone(r!.run),id:randomUUID(),status:'pending',phase:'queued',queuePosition:1,output:null,errorCode:null} as Run;this.runs.set(run.id,{owner:ctx.accountId,run});return {runId:run.id};});
  }
  async rateRun(ctx:UserContext,input:{runId:string;value:string},key:string) {this.learning('rateRun',ctx);await this.run(ctx,{id:input.runId});return this.once(ctx,key,input,()=>{this.votes.set(`${ctx.accountId}:${input.runId}`,input.value);return input;});}
  region={countryCode:null as string|null,region:null as string|null,revision:1};
  /** Verified contacts exist only for these test regions; no numbers otherwise. */
  verifiedContacts:Record<string,{label:string;phone:string;sourceUrl:string}>={KZ:{label:'Тестовая линия поддержки',phone:'150',sourceUrl:'https://example.org/source'}};
  async supportRegion(ctx:UserContext) {this.enter('supportRegion',ctx);return {...this.region};}
  async updateSupportRegion(ctx:UserContext,input:{expectedRevision:number;countryCode:string|null;region:string|null},key:string) {
    this.enter('updateSupportRegion',ctx);
    return this.once(ctx,key,input,()=>{if(input.expectedRevision!==this.region.revision)fail('REVISION_CONFLICT');this.region={countryCode:input.countryCode,region:input.region,revision:this.region.revision+1};return {...this.region};});
  }
  supportCalls:unknown[]=[];
  async support(ctx:UserContext,input:unknown) {
    this.enter('support',ctx);this.supportCalls.push(input);
    const c=this.region.countryCode,verified=c?this.verifiedContacts[c]:undefined;
    return {countryCode:c,region:c?this.region.region:null,availability:!c?'region_required' as const:verified?'available' as const:'unavailable' as const,message:'Похоже, может быть опасность. Обратись к человеку рядом или в местную экстренную службу.',recognitionGuaranteed:false as const,
      contacts:verified?[{label:verified.label,phone:verified.phone,url:null,sourceUrl:verified.sourceUrl,verifiedAt:now()}]:[]};
  }

  // ---- catalogue content
  examplesList:z.infer<typeof Example>[]=[{id:'ok-close',version:'1',input:{mode:'understand',title:'«Ок.»',relationship:'Друг',context:'Ответ на длинное сообщение',contextType:'close',goal:'clarify',message:'Ок.',guess:{emotions:[],quotes:[],unsure:true}}}];
  async examples(ctx:UserContext,q:{contextType?:string}) {this.learning('examples',ctx);return {items:structuredClone(this.examplesList.filter(e=>!q.contextType||e.input.contextType===q.contextType)),nextCursor:null};}
  async example(ctx:UserContext,q:{id:string}) {this.learning('example',ctx);const e=this.examplesList.find(x=>x.id===q.id);if(!e)fail('NOT_FOUND');return structuredClone(e!);}
  async progress(ctx:UserContext) {this.learning('progress',ctx);const done=[...this.runs.values()].filter(r=>r.owner===ctx.accountId&&r.run.status==='succeeded');
    return {analyzedSessions:done.filter(r=>r.run.kind==='analysis').length,completedExercises:0,completedRoleplays:0,completedDailyPractices:[...this.completions].filter(x=>x.startsWith(`${ctx.accountId}:practice`)).length,completedCards:0,streak:{current:this.completions.size?1:0,best:1,lastCompletedLocalDate:null},skills:[{skill:'clarification' as const,completedAttempts:2,latestScore:1}],latestTip:null,followupEligibleAt:null};}
  async skillAttempts(ctx:UserContext) {this.learning('skillAttempts',ctx);return {items:[{id:randomUUID(),skill:'clarification' as const,score:1,rationale:'Вопрос есть, но без уточнения времени.',sourceRunId:randomUUID(),createdAt:now()}],nextCursor:null};}
  async dailyPractice(ctx:UserContext) {this.learning('dailyPractice',ctx);return {...practiceFixture};}
  async completeDailyPractice(ctx:UserContext,input:{id:string;contentVersion:string},key:string) {this.learning('completeDailyPractice',ctx);return this.once(ctx,key,input,()=>{this.completions.add(`${ctx.accountId}:practice:${input.id}:${practiceFixture.localDate}`);return {id:randomUUID(),contentId:input.id,contentVersion:input.contentVersion,localDate:practiceFixture.localDate,completedAt:now()};});}
  async cards(ctx:UserContext) {this.learning('cards',ctx);return {items:[{...cardFixture}],nextCursor:null};}
  async card(ctx:UserContext,q:{id:string}) {this.learning('card',ctx);if(q.id!==cardFixture.id)fail('NOT_FOUND');return {...cardFixture};}
  async completeCard(ctx:UserContext,input:unknown,key:string) {this.learning('completeCard',ctx);return this.once(ctx,key,input,()=>({id:randomUUID(),contentId:cardFixture.id,contentVersion:cardFixture.contentVersion,localDate:'2026-10-31',completedAt:now()}));}
  assessmentSubmitted:string|null=null;
  async assessment(ctx:UserContext,q:{kind:'baseline'|'followup'}) {this.learning('assessment',ctx);if(q.kind==='followup')fail('ASSESSMENT_NOT_DUE');return {...structuredClone(assessmentFixture),submittedAt:this.assessmentSubmitted};}
  async submitAssessment(ctx:UserContext,input:{id:string;expectedDialogueRevision:number;answers:{questionId:string;choiceId:string}[]},key:string) {
    this.learning('submitAssessment',ctx);
    if(this.dialogues.get(ctx.accountId)?.revision!==input.expectedDialogueRevision)fail('REVISION_CONFLICT');
    return this.once(ctx,key,input,()=>{this.assessmentSubmitted=now();return {id:input.id,kind:'baseline' as const,scores:input.answers.map(a=>({questionId:a.questionId,score:a.choiceId==='a'?2:0,rationale:a.choiceId==='a'?'Ясный уважительный вопрос':'Обвинение без уточнения'})),completedAt:now(),followupEligibleAt:new Date(Date.now()+7*86400000).toISOString(),notice:'Учебный результат, не оценка эмпатии и не доказательство психологического эффекта' as const};});
  }
  async assessmentResults(ctx:UserContext) {this.learning('assessmentResults',ctx);return {items:[],nextCursor:null};}
  async reminders(ctx:UserContext) {this.learning('reminders',ctx);return structuredClone(this.reminderState);}
  async updateReminders(ctx:UserContext,input:typeof reminderFixture&{expectedRevision:number},key:string) {
    this.learning('updateReminders',ctx);
    return this.once(ctx,key,input,()=>{if(input.expectedRevision!==this.reminderState.revision)fail('REVISION_CONFLICT');const {expectedRevision:_e,...rest}=input;void _e;this.reminderState={...rest,revision:this.reminderState.revision+1};return structuredClone(this.reminderState);});
  }

  // ---- test hooks standing in for the GPU worker and scheduler
  complete(runId:string,output?:unknown) {
    const r=this.runs.get(runId)!;this.modelCalls++;
    const role=[...this.roles.values()].find(x=>x.owner===r.owner&&x.role.sessionId===r.run.sessionId&&x.role.status==='active')?.role;
    const fields=this.previews.get(r.run.previewId)!.preview.fields;
    const outputs:Record<string,unknown>={
      analysis:{...analysisFixture,interpretations:analysisFixture.interpretations.map((i,n)=>({...i,evidence:n===0?[{fieldId:fields[0]!.id,quote:fields[0]!.value.slice(0,3)}]:[]}))},
      say_direct:directFixture,
      reply_feedback:{strengths:['Есть вопрос.'],phrases:[{fieldId:fields.at(-1)!.id,quote:fields.at(-1)!.value.slice(0,5),tone:'risky',why:'Может прозвучать как обобщение.',softer:'Давно тебя не слышно.'}],revisedReply:'Давно не слышались. Во сколько удобно?',options:['support','clarify','reconcile','boundary'].map(goal=>({goal,text:'Давай обсудим.',explanation:'Под цель.'}))},
      reply_examples:['support','clarify','reconcile','boundary'].map(goal=>({goal,text:'Давай обсудим.',explanation:'Под цель.'})),
      exercise:{instruction:'Задай один уточняющий вопрос.',skill:'clarification',exampleHint:'Спроси о времени.'},
      exercise_feedback:{strengths:['Конкретно.'],improvement:'Оставь выбор.',suggestedAttempt:'Во сколько тебе удобно?'},
      roleplay_start:{kind:'message',content:'Ну и что ты хотел?'},
      roleplay_turn:role&&role.turnCount>=3?{kind:'feedback',strengths:['Спокойно.'],improvements:['Уточнить.'],nextPractice:'Признание переживания'}:{kind:'message',content:'Ладно, слушаю.'},
      roleplay_feedback:{kind:'feedback',strengths:['Спокойно.'],improvements:['Уточнить.'],nextPractice:'Признание переживания'},
      clarify:{questions:['Тебе удобно завтра?'],explanation:'Нейтрально.'},
      card_feedback:{strengths:['Ясно.'],improvement:'Короче.',suggestedAttempt:'Когда удобно?'},
    };
    if(r.run.kind==='before_send')outputs.before_send=outputs.reply_feedback;
    const value=output??outputs[r.run.kind];
    Object.assign(r.run,{status:'succeeded',phase:null,queuePosition:null,output:value});
    if(role&&r.run.kind.startsWith('roleplay')){const out=value as {kind:string;content?:string};if(out.kind==='message')role.messages.push({id:randomUUID(),sequence:role.messages.length,role:'assistant',content:out.content!});else Object.assign(role,{status:'completed',feedback:value});}
    this.deliveries.set(randomUUID(),{owner:r.owner,item:{kind:'run',runId},attempt:0,done:false,failures:[]});
  }
  failRun(runId:string,code='MODEL_UNAVAILABLE') {const r=this.runs.get(runId)!;Object.assign(r.run,{status:'failed',phase:null,queuePosition:null,errorCode:code});this.deliveries.set(randomUUID(),{owner:r.owner,item:{kind:'run',runId},attempt:0,done:false,failures:[]});}
  remind(owner:string) {this.deliveries.set(randomUUID(),{owner,item:{kind:'reminder'},attempt:0,done:false,failures:[]});}
  pending() {return [...this.runs.values()].find(r=>r.run.status==='pending')?.run;}
  asFacade() {return this as unknown as ProductFacade;}
}

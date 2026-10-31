import {randomUUID} from 'node:crypto';
import {outputFixtures} from '@between/contracts/fixtures';
import {type Account,type Accepted,type BotDomain,type BotRun,type CodeResult,type Delivery,type DialogState,type DraftFields,type ExampleSituation,type Preview,type StageEvent,type UserContext,DomainError} from '../src/domain.js';

// TEST-ONLY in-memory implementation of the facade port. Never imported by src/.
type Session=Awaited<ReturnType<BotDomain['session']>>;
type Role=Session['roleplays'][number];
interface StoredRun {owner:string;run:BotRun;delivered:boolean;undeliverable:boolean;claimed:boolean}

const now=()=>new Date().toISOString();
const mask=(v:string|undefined)=>{let n=0;const out=v?.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,()=>{n++;return '[почта скрыта]';}).replace(/\+?\d[\d\s()-]{8,}\d/g,()=>{n++;return '[телефон скрыт]';});return {out,n};};

export class MemoryDomain implements BotDomain {
  inbox=new Set<number>();
  accounts=new Map<string,Account>();
  codes=new Map<string,{code:string;attempts:number}>();
  states=new Map<string,DialogState>();
  previews=new Map<string,{owner:string;preview:Preview}>();
  sessionsById=new Map<string,{owner:string;session:Session}>();
  runs=new Map<string,StoredRun>();
  keys=new Map<string,Accepted>();
  ratings=new Map<string,string>();
  events:StageEvent[]=[];
  modelCalls=0;
  modelOnline=true;
  lastCode='';

  private owned(user:UserContext,id:string) {const s=this.sessionsById.get(id);if(!s||s.owner!==user.telegramId)throw new DomainError('NOT_FOUND');return s.session;}
  private verified(user:UserContext) {const a=this.accounts.get(user.telegramId);if(a?.status!=='verified')throw new DomainError('EMAIL_NOT_VERIFIED');}

  async acceptUpdate(id:number) {if(this.inbox.has(id))return false;this.inbox.add(id);return true;}
  async completeUpdate() {}

  async startAccount(user:UserContext) {
    if(!this.accounts.has(user.telegramId))this.accounts.set(user.telegramId,{telegramId:user.telegramId,status:'new',onboardingCompleted:false,email:null,pendingEmail:null});
    return {...this.accounts.get(user.telegramId)!};
  }
  async account(user:UserContext) {return this.startAccount(user);}
  async completeOnboarding(user:UserContext) {const a=await this.startAccount(user);this.accounts.set(user.telegramId,{...a,onboardingCompleted:true});return this.account(user);}
  async requestEmailCode(user:UserContext,email:string) {
    const a=await this.startAccount(user);
    this.lastCode=String(100000+Math.floor(Math.random()*899999));this.codes.set(user.telegramId,{code:this.lastCode,attempts:5});
    this.accounts.set(user.telegramId,{...a,status:a.status==='verified'?'verified':'email_pending',pendingEmail:email});
    return this.account(user);
  }
  async resendEmailCode(user:UserContext) {const a=await this.account(user);if(!a.pendingEmail)throw new DomainError('VALIDATION_ERROR');return this.requestEmailCode(user,a.pendingEmail);}
  async verifyEmailCode(user:UserContext,code:string):Promise<CodeResult> {
    const c=this.codes.get(user.telegramId);if(!c)return {status:'expired'};
    if(c.attempts<=0)return {status:'locked'};
    if(c.code!==code){c.attempts--;return c.attempts<=0?{status:'locked'}:{status:'invalid',attemptsLeft:c.attempts};}
    const a=await this.account(user);this.codes.delete(user.telegramId);
    this.accounts.set(user.telegramId,{...a,status:'verified',email:a.pendingEmail,pendingEmail:null});
    return {status:'verified'};
  }
  async deleteLearningData(user:UserContext) {for(const [id,s] of this.sessionsById)if(s.owner===user.telegramId)this.sessionsById.delete(id);}
  async deleteAccount(user:UserContext) {await this.deleteLearningData(user);this.accounts.delete(user.telegramId);this.states.delete(user.telegramId);}

  async state(user:UserContext) {return this.states.get(user.telegramId)??{name:'idle',version:0,payload:{}};}
  async setState(user:UserContext,name:string,payload:Record<string,unknown>,expected:number) {
    const cur=await this.state(user);if(cur.version!==expected)throw new DomainError('STATE_CONFLICT');
    const next={name,version:cur.version+1,payload:structuredClone(payload)};this.states.set(user.telegramId,next);return next;
  }

  async preview(user:UserContext,fields:DraftFields) {
    let count=0;const m=(v?:string)=>{const r=mask(v);count+=r.n;return r.out;};
    const masked:DraftFields={...fields,message:m(fields.message),relationship:m(fields.relationship),context:m(fields.context),intent:m(fields.intent),text:m(fields.text),attempt:fields.attempt===null?null:m(fields.attempt??undefined)};
    for(const k of Object.keys(masked) as (keyof DraftFields)[])if(masked[k]===undefined)delete masked[k];
    const danger=/убью тебя/i.test(JSON.stringify(fields));
    const p:Preview={id:randomUUID(),revision:1,fields:masked,maskedCount:count,safety:danger?'danger':'none'};
    this.previews.set(p.id,{owner:user.telegramId,preview:p});return p;
  }
  private confirmed(user:UserContext,id:string,revision:number) {const p=this.previews.get(id);if(!p||p.owner!==user.telegramId)throw new DomainError('NOT_FOUND');if(p.preview.revision!==revision)throw new DomainError('PREVIEW_STALE');return p.preview.fields;}
  async examples():Promise<ExampleSituation[]> {return [{id:'ex_ok',title:'«Ок.»',message:'Ок.',relationship:'Друг',context:'Ответ на длинное сообщение',contextType:'close'}];}

  async createSession(user:UserContext,previewId:string,revision:number,_difficulty:unknown,key:string) {
    this.verified(user);
    const prior=this.keys.get(`${user.telegramId}:${key}`);if(prior)return this.owned(user,prior.runId);
    const f=this.confirmed(user,previewId,revision);
    const id=randomUUID();
    const session:Session={id,title:(f.message??f.text??'Ситуация').slice(0,60),situation:{message:f.message??f.text??'',relationship:f.relationship??'—',context:f.context??'',goal:f.goal??'clarify'},guess:f.guess??{emotions:[],evidenceQuotes:[],unsure:true},revision:1,createdAt:now(),updatedAt:now(),runs:[],roleplays:[]};
    this.sessionsById.set(id,{owner:user.telegramId,session});this.keys.set(`${user.telegramId}:${key}`,{runId:id});
    return session;
  }
  async sessions(user:UserContext,q:{cursor?:string;limit:number}) {
    this.verified(user);
    const all=[...this.sessionsById.values()].filter(s=>s.owner===user.telegramId).map(s=>s.session).reverse();
    const start=q.cursor?Number(q.cursor):0,items=all.slice(start,start+q.limit).map(({runs:_r,roleplays:_p,...s})=>{void _r;void _p;return s;});
    return {items,nextCursor:start+q.limit<all.length?String(start+q.limit):null};
  }
  async session(user:UserContext,id:string) {this.verified(user);return structuredClone(this.owned(user,id));}
  async deleteSession(user:UserContext,id:string) {this.owned(user,id);this.sessionsById.delete(id);}

  private submit(user:UserContext,sessionId:string,kind:BotRun['kind'],key:string,before?:(s:Session)=>void):Accepted {
    this.verified(user);
    const prior=this.keys.get(`${user.telegramId}:${key}`);if(prior)return prior;
    const s=this.owned(user,sessionId);
    if([...this.runs.values()].some(r=>r.owner===user.telegramId&&r.run.status==='pending'))throw new DomainError('OPERATION_IN_PROGRESS');
    if(!this.modelOnline)throw new DomainError('MODEL_UNAVAILABLE');
    before?.(s);
    const run={id:randomUUID(),sessionId,revision:s.revision,kind,status:'pending',output:null,errorCode:null,createdAt:now(),updatedAt:now()} as BotRun;
    this.runs.set(run.id,{owner:user.telegramId,run,delivered:false,undeliverable:false,claimed:false});
    if(run.kind!=='direct')s.runs.unshift(run as Session['runs'][number]);
    const accepted={runId:run.id,queuePosition:0};this.keys.set(`${user.telegramId}:${key}`,accepted);return accepted;
  }
  private activeRole(s:Session) {return s.roleplays.find(r=>r.status==='active');}
  async analyze(u:UserContext,sid:string,_rev:number,key:string) {return this.submit(u,sid,'analysis',key);}
  async replyFeedback(u:UserContext,sid:string,_rev:number,p:string,r:number,key:string) {this.confirmed(u,p,r);return this.submit(u,sid,'reply_feedback',key);}
  async replyExamples(u:UserContext,sid:string,_rev:number,key:string) {return this.submit(u,sid,'reply_examples',key);}
  async exercise(u:UserContext,sid:string,_rev:number,key:string) {return this.submit(u,sid,'exercise',key);}
  async exerciseFeedback(u:UserContext,sid:string,_rev:number,_ex:string,p:string,r:number,key:string) {this.confirmed(u,p,r);return this.submit(u,sid,'exercise_feedback',key);}
  async roleplayStart(u:UserContext,sid:string,_rev:number,_d:unknown,key:string) {
    return this.submit(u,sid,'roleplay_start',key,s=>{s.roleplays.unshift({id:randomUUID(),sessionId:sid,revision:s.revision,status:'active',turnCount:0,messages:[],feedback:null});});
  }
  private roleSession(u:UserContext,rid:string) {for(const s of this.sessionsById.values())if(s.owner===u.telegramId&&s.session.roleplays.some(r=>r.id===rid))return s.session;throw new DomainError('NOT_FOUND');}
  async roleplayTurn(u:UserContext,rid:string,_rev:number,p:string,r:number,key:string) {
    const f=this.confirmed(u,p,r),s=this.roleSession(u,rid);
    return this.submit(u,s.id,'roleplay_turn',key,s=>{const role=s.roleplays.find(x=>x.id===rid)!;role.messages.push({id:randomUUID(),sequence:role.messages.length,role:'user',content:f.text!});role.turnCount++;});
  }
  async roleplayFinish(u:UserContext,rid:string,_rev:number,key:string) {const s=this.roleSession(u,rid);return this.submit(u,s.id,'roleplay_feedback',key);}
  async retry(u:UserContext,runId:string,_rev:number,key:string) {const r=this.runs.get(runId);if(!r||r.owner!==u.telegramId)throw new DomainError('NOT_FOUND');return this.submit(u,r.run.sessionId,r.run.kind,key);}
  async direct(u:UserContext,p:string,r:number,key:string) {
    const prior=this.keys.get(`${u.telegramId}:${key}`);if(prior)return prior;
    const f=this.confirmed(u,p,r),s=await this.createSession(u,p,r,null,`${key}:s`);void f;
    return {...this.submit(u,s.id,'direct',key),resourceId:s.id};
  }
  async run(u:UserContext,id:string) {const r=this.runs.get(id);if(!r||r.owner!==u.telegramId||!this.sessionsById.has(r.run.sessionId))throw new DomainError('NOT_FOUND');return structuredClone(r.run);}
  async progress(u:UserContext) {this.verified(u);const done=[...this.runs.values()].filter(r=>r.owner===u.telegramId&&r.run.status==='succeeded');
    return {analyzedSessions:new Set(done.filter(r=>r.run.kind==='analysis').map(r=>r.run.sessionId)).size,completedExercises:done.filter(r=>r.run.kind==='exercise_feedback').length,completedRoleplays:done.filter(r=>r.run.kind==='roleplay_feedback').length,skills:[],latestTip:null};}
  async rateRun(u:UserContext,runId:string,value:string) {await this.run(u,runId);this.ratings.set(`${u.telegramId}:${runId}`,value);}
  async track(_u:UserContext,event:StageEvent) {this.events.push(event);}

  async claimDeliveries(limit:number):Promise<Delivery[]> {
    return [...this.runs.entries()].filter(([,r])=>r.run.status!=='pending'&&!r.delivered&&!r.undeliverable).slice(0,limit).map(([id,r])=>({id,user:{telegramId:r.owner},run:structuredClone(r.run)}));
  }
  async markDelivered(id:string) {this.runs.get(id)!.delivered=true;}
  async markUndeliverable(id:string) {this.runs.get(id)!.undeliverable=true;}

  /** Test hook standing in for the GPU worker. */
  complete(runId:string,output?:unknown) {
    const r=this.runs.get(runId)!;this.modelCalls++;
    const s=this.sessionsById.get(r.run.sessionId)?.session;
    let value=output;
    if(value===undefined){
      if(r.run.kind==='direct')value={variants:[{text:'Я не смогу прийти в субботу.',explanation:'Отказ сохранён.'}],preserved:'Отказ и спокойный тон.',attemptFeedback:'Ясно и вежливо.'};
      else if(r.run.kind==='roleplay_turn'){const role=s?this.activeRole(s):undefined;value=role&&role.turnCount>=3?outputFixtures.roleplay_feedback:outputFixtures.roleplay_turn;}
      else value=outputFixtures[r.run.kind as keyof typeof outputFixtures];
    }
    Object.assign(r.run,{status:'succeeded',output:value});
    if(s){
      const listed=s.runs.find(x=>x.id===runId);if(listed)Object.assign(listed,{status:'succeeded',output:value});
      const role=this.activeRole(s) as Role|undefined;
      if(role&&r.run.kind.startsWith('roleplay')){
        const out=value as {kind:string;content?:string};
        if(out.kind==='message')role.messages.push({id:randomUUID(),sequence:role.messages.length,role:'assistant',content:out.content!});
        else Object.assign(role,{status:'completed',feedback:value});
      }
    }
  }
  fail(runId:string,code='MODEL_UNAVAILABLE') {
    const r=this.runs.get(runId)!;Object.assign(r.run,{status:'failed',errorCode:code});
    const listed=this.sessionsById.get(r.run.sessionId)?.session.runs.find(x=>x.id===runId);if(listed)Object.assign(listed,{status:'failed',errorCode:code});
  }
  pendingRun() {return [...this.runs.values()].find(r=>r.run.status==='pending')?.run;}
}

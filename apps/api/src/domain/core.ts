import {createHmac,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Account,DomainFailure,Id,type UserContext} from '@between/contracts/domain';
import {transaction} from '../repositories/storage.js';
export type FailureCode=DomainFailure['code'];
export class DomainError extends Error {
  readonly requestId=randomUUID();
  constructor(readonly code:FailureCode){super(code);}
  toJSON(){return {code:this.code,requestId:this.requestId};}
}
export function fail(code:FailureCode):never{throw new DomainError(code);}
export function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
  return value;
}
export function digest(secret:string,...values:unknown[]){return createHmac('sha256',secret).update(JSON.stringify(canonical(values))).digest('hex');}
export type AccountRow={id:string;telegram_user_id:string;display_name:string;email:string|null;email_verified_at:Date|null;consent_version:string|null;onboarding_completed_at:Date|null};
export const accountColumns='a.*,p.display_name,p.onboarding_completed_at';
export function accountDto(row:AccountRow){return Account.parse({id:row.id,telegramUserId:row.telegram_user_id,displayName:row.display_name,emailVerified:!!row.email_verified_at,consentVersion:row.consent_version,onboardingCompletedAt:row.onboarding_completed_at?.toISOString()??null});}
export class Contexts {
  private issued=new WeakSet<object>();
  private updates=new WeakMap<object,string>();
  private sessions=new WeakMap<object,string>();
  constructor(private pool:Pool,private now=Date.now){}
  issue(row:Pick<AccountRow,'id'|'telegram_user_id'>,updateId?:string):UserContext {
    const ctx=Object.freeze({accountId:row.id,telegramUserId:row.telegram_user_id}) as UserContext;this.issued.add(ctx);if(updateId)this.updates.set(ctx,updateId);return ctx;
  }
  updateFor(ctx:UserContext){return this.updates.get(ctx);}
  issueWeb(row:Pick<AccountRow,'id'|'telegram_user_id'>,sessionId:string):UserContext{const ctx=this.issue(row);this.sessions.set(ctx,sessionId);return ctx;}
  async check(ctx:UserContext,client:Pool|PoolClient=this.pool,learning=false,lock=false):Promise<AccountRow>{
    if(!ctx||typeof ctx!=='object'||!this.issued.has(ctx))fail('UNAUTHORIZED');
    if(lock)await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[ctx.accountId]);
    const row=(await client.query<AccountRow>(`SELECT ${accountColumns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1 AND a.telegram_user_id=$2${lock?' FOR UPDATE OF a':''}`,[ctx.accountId,ctx.telegramUserId])).rows[0];
    if(!row)fail('UNAUTHORIZED');
    const sessionId=this.sessions.get(ctx);
    if(sessionId&&!(await client.query('SELECT 1 FROM app.web_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>$3',[sessionId,row.id,new Date(this.now())])).rowCount)fail('UNAUTHORIZED');
    if(learning){if(row.consent_version!=='telegram-1')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');}
    return row;
  }
}
export interface MutationResult<T>{value:T;error?:FailureCode;afterCommit?:()=>void;}
export class Mutations {
  constructor(private pool:Pool,private contexts:Contexts,private secret:string){}
  async run<T>(ctx:UserContext,operation:string,resource:string,key:string,payload:unknown,work:(client:PoolClient,row:AccountRow)=>Promise<MutationResult<T>>,learning=false):Promise<T>{
    Id.parse(key);
    let after:(()=>void)|undefined;
    const answer=await transaction(this.pool,async client=>{
      const row=await this.contexts.check(ctx,client,learning,true),hash=digest(this.secret,operation,resource,payload);
      const old=(await client.query('SELECT * FROM app.domain_intents WHERE user_id=$1 AND operation=$2 AND resource=$3 AND intent_key=$4',[row.id,operation,resource,key])).rows[0];
      if(old){if(old.payload_hmac!==hash)fail('IDEMPOTENCY_CONFLICT');if(old.state==='processing')fail('OPERATION_IN_PROGRESS');return {value:old.result as T,error:old.error_code as FailureCode|undefined};}
      const result=await work(client,row);after=result.afterCommit;
      await client.query(`INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result,error_code,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[row.id,operation,resource,key,hash,JSON.stringify(result.value??null),result.error??null,result.error?'failed':'completed']);
      return result;
    });
    after?.();if(answer.error)fail(answer.error);return answer.value;
  }
}
export async function safe<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){
    if(error instanceof DomainError)throw error;
    if(error instanceof Error&&error.name==='ZodError')fail('VALIDATION_ERROR');
    if(error instanceof Error&&'code' in error&&typeof error.code==='string'){
      if(['VALIDATION_ERROR','NOT_FOUND','REVISION_CONFLICT','OPERATION_IN_PROGRESS','IDEMPOTENCY_CONFLICT','RATE_LIMITED','DEPENDENCY_UNAVAILABLE'].includes(error.code))fail(error.code as FailureCode);
    }
    fail('DEPENDENCY_UNAVAILABLE');
  }
}

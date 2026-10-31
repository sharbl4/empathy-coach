import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Account,DomainError,Id,operations,type DomainFailure,type Operation,type OperationInput,type OperationOutput,type UserContext} from '@between/contracts/product';
import {transaction} from '../../db/transaction.js';
export {DomainError,transaction};
export type Code=DomainFailure['code'];
export function fail(code:Code,retryAfterSeconds?:number):never {throw new DomainError({code,requestId:randomUUID(),...(retryAfterSeconds===undefined?{}:{retryAfterSeconds})});}
export const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
export const hmac=(secret:string,...parts:unknown[])=>createHmac('sha256',secret).update(JSON.stringify(canonical(parts))).digest('hex');
export const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof DomainError)throw error;if(error instanceof Error&&error.name==='ZodError')fail('VALIDATION_ERROR');fail('INTERNAL_ERROR');}}
export type AccountRow={id:string;telegram_user_id:string;display_name:string;email:string|null;email_verified_at:Date|null;consent_version:string|null;onboarding_completed_at:Date|null};
export const columns='a.*,p.display_name,p.onboarding_completed_at';
export const account=(r:AccountRow)=>Account.parse({id:r.id,telegramUserId:r.telegram_user_id,displayName:r.display_name,emailVerified:!!r.email_verified_at,consentVersion:r.consent_version,onboardingCompletedAt:r.onboarding_completed_at?.toISOString()??null});
export class Contexts {
  private issued=new WeakSet<object>();private updates=new WeakMap<object,string>();private sessions=new WeakMap<object,string>();
  constructor(readonly pool:Pool,readonly now:()=>number){}
  issue(row:Pick<AccountRow,'id'|'telegram_user_id'>,transport:'telegram'|'web',ref?:string):UserContext{const ctx=Object.freeze({accountId:row.id,telegramUserId:row.telegram_user_id,transport}) as UserContext;this.issued.add(ctx);if(ref)(transport==='web'?this.sessions:this.updates).set(ctx,ref);return ctx;}
  update(ctx:UserContext){return this.updates.get(ctx);}
  session(ctx:UserContext){return this.sessions.get(ctx);}
  async check(ctx:UserContext,c:Pool|PoolClient=this.pool,learning=false,lock=false){
    if(!ctx||typeof ctx!=='object'||!this.issued.has(ctx))fail('UNAUTHORIZED');
    if(lock)await c.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[ctx.accountId]);
    const row=(await c.query<AccountRow>(`SELECT ${columns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1 AND a.telegram_user_id=$2${lock?' FOR UPDATE OF a':''}`,[ctx.accountId,ctx.telegramUserId])).rows[0];if(!row)fail('UNAUTHORIZED');
    if(ctx.transport==='web'){
      const session=this.sessions.get(ctx);if(!session)fail('UNAUTHORIZED');
      if(!(await c.query('UPDATE app.web_sessions SET last_seen_at=$3 WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>$3 AND last_seen_at>$4 RETURNING id',[session,row.id,new Date(this.now()),new Date(this.now()-7200000)])).rowCount)fail('UNAUTHORIZED');
    }
    if(learning){if(row.consent_version!=='web-telegram-2')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');}return row;
  }
}
export class Store {
  constructor(readonly pool:Pool,readonly contexts:Contexts,readonly secret:string,readonly now:()=>number,readonly accepting:()=>boolean){}
  read<T>(ctx:UserContext,learning:boolean,work:(c:PoolClient,row:AccountRow)=>Promise<T>){return transaction(this.pool,async c=>work(c,await this.contexts.check(ctx,c,learning,true)));}
  async write<K extends Operation>(ctx:UserContext,op:K,raw:OperationInput<K>,key:string,work:(c:PoolClient,row:AccountRow,input:OperationInput<K>)=>Promise<{value:OperationOutput<K>;error?:Code;after?:()=>void}>,learning=false):Promise<OperationOutput<K>>{
    const input=operations[op].input.parse(raw) as OperationInput<K>;Id.parse(key);if(!this.accepting())fail('DEPENDENCY_UNAVAILABLE');let after:(()=>void)|undefined;
    const answer=await transaction(this.pool,async c=>{
      const row=await this.contexts.check(ctx,c,learning,true),hash=hmac(this.secret,op,input);
      const prior=(await c.query("SELECT * FROM app.domain_intents WHERE user_id=$1 AND operation=$2 AND resource='' AND intent_key=$3",[row.id,'v2.'+op,key])).rows[0];
      if(prior){if(prior.payload_hmac!==hash)fail('IDEMPOTENCY_CONFLICT');if(prior.state==='processing')fail('OPERATION_IN_PROGRESS');return {value:prior.result as OperationOutput<K>,error:prior.error_code as Code|undefined};}
      const result=await work(c,row,input);after=result.after;
      await c.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result,error_code,state) VALUES($1,$2,'',$3,$4,$5,$6,$7)",[row.id,'v2.'+op,key,hash,JSON.stringify(result.value),result.error??null,result.error?'failed':'completed']);return result;
    });after?.();if(answer.error)fail(answer.error);return operations[op].response.parse(answer.value) as OperationOutput<K>;
  }
}
export function paginate<T>(rows:T[],limit:number,cursor:(row:T)=>string){return {items:rows.slice(0,limit),nextCursor:rows.length>limit?cursor(rows[limit-1]):null};}
export function cursorCodec(secret:string,scope:unknown){return {
  encode:(data:unknown)=>{const raw=Buffer.from(JSON.stringify(data)).toString('base64url');return raw+'.'+hmac(secret,scope,raw);},
  decode:(raw?:string)=>{if(!raw)return null;const [data,signature,...tail]=raw.split('.');if(tail.length||!data||!signature||!equal(hmac(secret,scope,data),signature))fail('VALIDATION_ERROR');try{return JSON.parse(Buffer.from(data,'base64url').toString()) as unknown;}catch{fail('VALIDATION_ERROR');}}
};}

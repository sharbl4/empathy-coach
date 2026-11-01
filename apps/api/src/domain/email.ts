import {randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Pool} from 'pg';
import {EmailChallenge,EmailRequest,EmailVerification,Id,type UserContext} from '@between/contracts/domain';
import {transaction} from '../repositories/storage.js';
import {Contexts,Mutations,accountDto,digest,fail} from './core.js';
import type {MailTransport} from './mail.js';
export interface EmailLimits {ttlMs:number;resendMs:number;maxAttempts:number;accountPerHour:number;addressPerHour:number;}
export const emailLimits:EmailLimits={ttlMs:600000,resendMs:60000,maxAttempts:5,accountPerHour:5,addressPerHour:10};
export class Emails {
  constructor(private pool:Pool,private contexts:Contexts,private mutations:Mutations,private secret:string,private mail:MailTransport,private now:()=>number,private limits:EmailLimits=emailLimits){}
  async request(ctx:UserContext,raw:unknown,key:string){
    const input=EmailRequest.parse(raw);Id.parse(key);
    const email=input.email.trim().toLowerCase(),code=randomInt(0,1000000).toString().padStart(6,'0'),id=randomUUID();
    const now=this.now(),hash=digest(this.secret,'requestEmail',email),emailHash=digest(this.secret,'email-rate',email);
    const prepared=await transaction(this.pool,async client=>{
      const row=await this.contexts.check(ctx,client,false,true);
      if(row.consent_version!=='telegram-1')fail('CONSENT_REQUIRED');
      const old=(await client.query("SELECT * FROM app.domain_intents WHERE user_id=$1 AND operation='email.request' AND resource='' AND intent_key=$2",[row.id,key])).rows[0];
      if(old){
        if(old.payload_hmac!==hash)fail('IDEMPOTENCY_CONFLICT');
        if(old.state==='processing')fail('OPERATION_IN_PROGRESS');
        if(old.error_code)fail(old.error_code);return {fresh:false,result:EmailChallenge.parse(old.result)};
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,719))',[emailHash]);
      const rate=(await client.query(`SELECT count(*) FILTER(WHERE user_id=$1)::int AS owned,count(*) FILTER(WHERE email_hmac=$2)::int AS address,
        max(created_at) FILTER(WHERE user_id=$1) AS latest FROM app.email_rate_events WHERE created_at>$3`,[row.id,emailHash,new Date(now-3600000)])).rows[0];
      if(rate.owned>=this.limits.accountPerHour||rate.address>=this.limits.addressPerHour||(rate.latest&&now-new Date(rate.latest).getTime()<this.limits.resendMs))fail('RATE_LIMITED');
      const result=EmailChallenge.parse({challengeId:id,expiresAt:new Date(now+this.limits.ttlMs).toISOString(),resendAfter:new Date(now+this.limits.resendMs).toISOString()});
      await client.query("UPDATE app.email_challenges SET state='invalidated',code_hmac='' WHERE user_id=$1 AND state IN ('sending','sent')",[row.id]);
      await client.query(`INSERT INTO app.email_challenges(id,user_id,email,code_hmac,state,expires_at,created_at) VALUES($1,$2,$3,$4,'sending',$5,$6)`,[id,row.id,email,digest(this.secret,'email-code',id,row.id,email,code),new Date(now+this.limits.ttlMs),new Date(now)]);
      await client.query('INSERT INTO app.email_rate_events(user_id,email_hmac,created_at) VALUES($1,$2,$3)',[row.id,emailHash,new Date(now)]);
      await client.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result,state) VALUES($1,'email.request','',$2,$3,$4,'processing')",[row.id,key,hash,result]);
      return {fresh:true,result};
    });
    if(!prepared.fresh)return prepared.result;
    let sent=false;try{await this.mail.sendCode(email,code);sent=true;}catch{/* No raw SMTP errors, recipients or codes. */}
    const committed=await transaction(this.pool,async client=>{
      const row=await this.contexts.check(ctx,client,false,true);
      const result=await client.query("UPDATE app.email_challenges SET state=$2,code_hmac=CASE WHEN $2='sent' THEN code_hmac ELSE '' END WHERE id=$1 AND user_id=$3 AND state='sending'",[id,sent?'sent':'failed',row.id]);
      const success=sent&&result.rowCount===1;
      await client.query("UPDATE app.domain_intents SET state=$3,error_code=$4 WHERE user_id=$1 AND operation='email.request' AND resource='' AND intent_key=$2",[row.id,key,success?'completed':'failed',success?null:'DEPENDENCY_UNAVAILABLE']);
      return success;
    });
    if(!committed)fail('DEPENDENCY_UNAVAILABLE');return prepared.result;
  }
  async verify(ctx:UserContext,raw:unknown,key:string){
    const input=EmailVerification.parse(raw);Id.parse(key);
    return this.mutations.run(ctx,'email.verify',input.challengeId,key,input,async(client,row)=>{
      const challenge=(await client.query('SELECT * FROM app.email_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.challengeId,row.id])).rows[0];
      if(!challenge)fail('NOT_FOUND');
      if(challenge.expires_at.getTime()<=this.now())return {value:accountDto(row),error:'CODE_EXPIRED'};
      if(challenge.state!=='sent'||challenge.attempts>=this.limits.maxAttempts)return {value:accountDto(row),error:'CODE_INVALID'};
      const expected=Buffer.from(challenge.code_hmac,'hex'),actual=Buffer.from(digest(this.secret,'email-code',challenge.id,row.id,challenge.email,input.code),'hex');
      const valid=expected.length===actual.length&&timingSafeEqual(expected,actual);
      await client.query("UPDATE app.email_challenges SET attempts=attempts+1,state=CASE WHEN $2 THEN 'consumed' WHEN attempts+1>=$3 THEN 'invalidated' ELSE state END,code_hmac=CASE WHEN $2 OR attempts+1>=$3 THEN '' ELSE code_hmac END WHERE id=$1",[challenge.id,valid,this.limits.maxAttempts]);
      if(!valid)return {value:accountDto(row),error:'CODE_INVALID'};
      await client.query('UPDATE app.accounts SET email=$2,email_verified_at=$3,updated_at=$3 WHERE id=$1',[row.id,challenge.email,new Date(this.now())]);
      return {value:accountDto({...row,email:challenge.email,email_verified_at:new Date(this.now())})};
    });
  }
}

import {randomUUID,randomInt} from 'node:crypto';
import {EmailVerificationStatus,EmailRequest,ResendEmailCode,EmailVerification,type OperationInput,type UserContext} from '@between/contracts/product';
import type {PoolClient} from 'pg';
import {MailDeliveryUnknown,type MailTransport} from '../mail.js';
import {Store,account,equal,fail,hmac,transaction,type AccountRow,type Code} from './core.js';
type Challenge={id:string;email:string;masked_email?:string;code_hmac:string;attempts:number;state:string;expires_at:Date;created_at:Date};
export class Emails {
  constructor(private store:Store,private mail:MailTransport){}
  private async reconcile(c:PoolClient,id:string){
    await c.query("UPDATE app.email_challenges SET state='delivery_unknown' WHERE user_id=$1 AND state='sending' AND created_at<=$2",[id,new Date(this.store.now()-30000)]);
    await c.query("UPDATE app.domain_intents SET state='completed' WHERE user_id=$1 AND operation IN ('v2.requestEmailCode','v2.resendEmailCode') AND state='processing' AND created_at<=$2",[id,new Date(this.store.now()-30000)]);
  }
  private dto(row:AccountRow,ch?:Challenge){
    if(ch){const local=ch.email.split('@')[0],domain=ch.email.split('@')[1];
      const state=ch.expires_at.getTime()<=this.store.now()?'expired':ch.attempts>=5?'locked':ch.state;
      return EmailVerificationStatus.parse({state:'challenge',challenge:{challengeId:ch.id,state,maskedEmail:ch.masked_email??local.slice(0,2)+'***@'+domain,expiresAt:ch.expires_at.toISOString(),resendAfter:new Date(ch.created_at.getTime()+60000).toISOString(),attemptsRemaining:Math.max(0,5-ch.attempts)}});
    }return EmailVerificationStatus.parse({state:row.email_verified_at?'verified':'none'});
  }
  private async current(c:PoolClient,row:AccountRow){await this.reconcile(c,row.id);return (await c.query<Challenge>("SELECT * FROM app.email_challenges WHERE user_id=$1 AND state NOT IN ('consumed','invalidated') ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",[row.id])).rows[0];}
  status(ctx:UserContext){return this.store.read(ctx,false,async(c,row)=>this.dto(row,await this.current(c,row)));}
  request(ctx:UserContext,input:OperationInput<'requestEmailCode'>,key:string){return this.send(ctx,'requestEmailCode',EmailRequest.parse(input),key);}
  resend(ctx:UserContext,input:OperationInput<'resendEmailCode'>,key:string){return this.send(ctx,'resendEmailCode',ResendEmailCode.parse(input),key);}
  private async send(ctx:UserContext,op:'requestEmailCode'|'resendEmailCode',input:OperationInput<'requestEmailCode'>|OperationInput<'resendEmailCode'>,key:string){
    const {Id}=await import('@between/contracts/product');Id.parse(key);if(!this.store.accepting())fail('DEPENDENCY_UNAVAILABLE');
    const secret=this.store.secret,hash=hmac(secret,op,input),code=randomInt(0,1000000).toString().padStart(6,'0');
    const prepared=await transaction(this.store.pool,async c=>{
      const row=await this.store.contexts.check(ctx,c,false,true);if(row.consent_version!=='web-telegram-2')fail('CONSENT_REQUIRED');
      const current=await this.current(c,row);
      const previous=(await c.query("SELECT * FROM app.domain_intents WHERE user_id=$1 AND operation=$2 AND resource='' AND intent_key=$3",[row.id,'v2.'+op,key])).rows[0];
      if(previous){if(previous.payload_hmac!==hash)fail('IDEMPOTENCY_CONFLICT');if(previous.state==='processing')fail('OPERATION_IN_PROGRESS',2);return {status:this.dto(row,current)};}
      let email:string;
      if('challengeId' in input){
        const owned=(await c.query<Challenge>('SELECT * FROM app.email_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.challengeId,row.id])).rows[0];if(!owned)fail('NOT_FOUND');
        if(!current&&row.email_verified_at){await c.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result,state,created_at) VALUES($1,$2,'',$3,$4,$5,'completed',$6)",[row.id,'v2.'+op,key,hash,{state:'verified'},new Date(this.store.now())]);return {status:this.dto(row)};}
        if(!current||current.id!==owned.id)fail('REVISION_CONFLICT');if(!owned.email)fail('CODE_EXPIRED');email=owned.email;
      }else email=input.email.trim().toLowerCase();
      if(current&&this.store.now()<current.created_at.getTime()+60000)fail('RATE_LIMITED',Math.ceil((current.created_at.getTime()+60000-this.store.now())/1000));
      const address=hmac(secret,'email-rate',email);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1210))',[address]);
      const since=new Date(this.store.now()-3600000),counts=(await c.query('SELECT count(*) FILTER(WHERE user_id=$1)::int AS own,count(*) FILTER(WHERE email_hmac=$2)::int AS address FROM app.email_rate_events WHERE created_at>$3',[row.id,address,since])).rows[0];
      if(counts.own>=5||counts.address>=10)fail('RATE_LIMITED',300);
      await c.query("UPDATE app.email_challenges SET state='invalidated',code_hmac='',email='' WHERE user_id=$1 AND state NOT IN ('consumed','invalidated')",[row.id]);
      const id=randomUUID(),now=new Date(this.store.now()),expires=new Date(this.store.now()+600000);
      await c.query("INSERT INTO app.email_challenges(id,user_id,email,code_hmac,state,created_at,expires_at,masked_email) VALUES($1,$2,$3,$4,'sending',$5,$6,$7)",[id,row.id,email,hmac(secret,'email-code',row.id,id,email,code),now,expires,email.split('@')[0].slice(0,2)+'***@'+email.split('@')[1]]);
      await c.query('INSERT INTO app.email_rate_events(user_id,email_hmac,created_at) VALUES($1,$2,$3)',[row.id,address,now]);
      await c.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result,state,created_at) VALUES($1,$2,'',$3,$4,$5,'processing',$6)",[row.id,'v2.'+op,key,hash,JSON.stringify({challengeId:id}),now]);return {id,email};
    });
    if('status' in prepared)return prepared.status!;
    let outcome:'sent'|'failed'|'delivery_unknown'='failed';try{await this.mail.sendCode(prepared.email!,code);outcome='sent';}catch(error){if(error instanceof MailDeliveryUnknown)outcome='delivery_unknown';}
    return transaction(this.store.pool,async c=>{
      const row=await this.store.contexts.check(ctx,c,false,true);
      const target=(await c.query<Challenge>('SELECT * FROM app.email_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE',[prepared.id,row.id])).rows[0];
      if(!target||row.consent_version!=='web-telegram-2'||target.state==='invalidated')fail('CONSENT_REQUIRED');
      await c.query("UPDATE app.email_challenges SET state=$2 WHERE id=$1 AND state IN ('sending','delivery_unknown')",[target.id,outcome]);
      await c.query("UPDATE app.domain_intents SET state='completed' WHERE user_id=$1 AND operation=$2 AND intent_key=$3",[row.id,'v2.'+op,key]);
      return this.dto(row,await this.current(c,row));
    });
  }
  verify(ctx:UserContext,raw:OperationInput<'verifyEmailCode'>,key:string){
    const input=EmailVerification.parse(raw);
    return this.store.write(ctx,'verifyEmailCode',input,key,async(c,row)=>{
      const ch=(await c.query<Challenge>('SELECT * FROM app.email_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.challengeId,row.id])).rows[0];if(!ch)fail('NOT_FOUND');
      const current=await this.current(c,row);
      if(!current||current.id!==ch.id)fail('REVISION_CONFLICT');
      let error:Code|undefined;
      if(current.expires_at.getTime()<=this.store.now())error='CODE_EXPIRED';else if(current.state==='sending')fail('OPERATION_IN_PROGRESS',2);else if(current.state==='failed'||current.attempts>=5)error='CODE_INVALID';
      else if(!equal(current.code_hmac,hmac(this.store.secret,'email-code',row.id,current.id,current.email,input.code))){await c.query('UPDATE app.email_challenges SET attempts=attempts+1 WHERE id=$1',[current.id]);error='CODE_INVALID';}
      if(error)return {value:null as never,error};
      await c.query('UPDATE app.accounts SET email=$2,email_verified_at=$3 WHERE id=$1',[row.id,current.email,new Date(this.store.now())]);
      await c.query("UPDATE app.email_challenges SET state='consumed',email='',code_hmac='' WHERE id=$1",[current.id]);
      return {value:{account:account({...row,email:current.email,email_verified_at:new Date(this.store.now())}),verification:{state:'verified' as const}}};
    });
  }
}

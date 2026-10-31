import {randomUUID} from 'node:crypto';
import {TelegramUpdateId,Id,UpdateReceiptV2,UpdateFailure,domainRetryPolicy,RunV2,type Delivery,type UserContext} from '@between/contracts/product';
import {DeliveryFailure} from '@between/contracts/domain';
import {Store,fail,hmac,transaction,type AccountRow} from './core.js';
import type {PoolClient} from 'pg';
export class Transport {
  private processId=randomUUID();private claims=new WeakMap<object,{id:string;token:string}>();
  constructor(private store:Store,private bot:()=>string|undefined,private reminderValid:(c:PoolClient,row:AccountRow,payload:unknown)=>Promise<boolean>){}
  private botId(){const id=this.bot();if(!id)fail('DEPENDENCY_UNAVAILABLE');return id;}
  private receipt(row:Record<string,unknown>){return UpdateReceiptV2.parse({updateId:row.update_id,intentKey:row.intent_key,status:row.status,attempts:row.attempts,nextAttemptAt:row.next_attempt_at instanceof Date?row.next_attempt_at.toISOString():null,failure:row.failure??null});}
  async cursor(){const bot=this.botId();const r=(await this.store.pool.query("SELECT LEAST(COALESCE((SELECT next_offset FROM app.telegram_cursors WHERE bot_id=$1),0),COALESCE((SELECT min(update_id) FROM app.telegram_inbox WHERE bot_id=$1 AND status IN ('processing','retry_wait')),9223372036854775807))::text value",[bot])).rows[0];return {nextOffset:TelegramUpdateId.parse(r.value)};}
  async claim(ctx:UserContext,raw:string){const id=TelegramUpdateId.parse(raw),bot=this.botId();if(this.store.contexts.update(ctx)!==id||ctx.transport!=='telegram')fail('UNAUTHORIZED');
    const result=await this.store.read(ctx,false,async(c,row)=>{
      const owner=hmac(this.store.secret,'inbox-principal',bot,row.telegram_user_id),inserted=(await c.query("INSERT INTO app.telegram_inbox(bot_id,update_id,user_id,intent_key,principal_hmac,status) VALUES($1,$2,$3,$4,$5,'processing') ON CONFLICT DO NOTHING RETURNING update_id",[bot,id,row.id,randomUUID(),owner])).rowCount;
      let receipt=(await c.query('SELECT * FROM app.telegram_inbox WHERE bot_id=$1 AND update_id=$2 FOR UPDATE',[bot,id])).rows[0];if(receipt.principal_hmac!==owner||receipt.user_id!==row.id)fail('NOT_FOUND');
      if(['completed','failed'].includes(receipt.status))return {receipt:this.receipt(receipt)};
      const oldest=(await c.query("SELECT update_id FROM app.telegram_inbox WHERE bot_id=$1 AND user_id=$2 AND status IN ('processing','retry_wait') ORDER BY update_id LIMIT 1",[bot,row.id])).rows[0];if(oldest?.update_id!==id)return {busy:true};
      const slot=(await c.query('SELECT * FROM app.user_update_slots WHERE bot_id=$1 AND user_id=$2 FOR UPDATE',[bot,row.id])).rows[0];if(slot?.process_id===this.processId&&slot.update_id!==id)return {busy:true};
      if(receipt.status==='retry_wait'&&receipt.next_attempt_at.getTime()>this.store.now())return {receipt:this.receipt(receipt)};
      const newAttempt=!inserted&&(receipt.status==='retry_wait'||slot?.process_id!==this.processId);
      if(newAttempt){if(receipt.attempts>=3){receipt=(await c.query("UPDATE app.telegram_inbox SET status='failed',next_attempt_at=NULL,failure=$3 WHERE bot_id=$1 AND update_id=$2 RETURNING *",[bot,id,{code:'INTERNAL_ERROR',requestId:randomUUID()}])).rows[0];return {receipt:this.receipt(receipt)};}
        receipt=(await c.query("UPDATE app.telegram_inbox SET attempts=attempts+1,status='processing',next_attempt_at=NULL,failure=NULL WHERE bot_id=$1 AND update_id=$2 RETURNING *",[bot,id])).rows[0];}
      await c.query('INSERT INTO app.user_update_slots(bot_id,user_id,update_id,process_id) VALUES($1,$2,$3,$4) ON CONFLICT(bot_id,user_id) DO UPDATE SET update_id=$3,process_id=$4',[bot,row.id,id,this.processId]);return {receipt:this.receipt(receipt)};
    });if(result.busy)fail('OPERATION_IN_PROGRESS',2);return result.receipt!;
  }
  async failure(ctx:UserContext,raw:ReturnType<typeof UpdateFailure.parse>,key:string){const input=UpdateFailure.parse(raw);Id.parse(key);const bot=this.botId();if(this.store.contexts.update(ctx)!==input.updateId)fail('UNAUTHORIZED');
    return this.store.read(ctx,false,async(c,row)=>{
      const hash=hmac(this.store.secret,'recordUpdateFailure',input),op='v2.inbox.failure';const prior=(await c.query("SELECT payload_hmac FROM app.domain_intents WHERE user_id=$1 AND operation=$2 AND resource='' AND intent_key=$3",[row.id,op,key])).rows[0];if(prior&&prior.payload_hmac!==hash)fail('IDEMPOTENCY_CONFLICT');
      let r=(await c.query('SELECT * FROM app.telegram_inbox WHERE bot_id=$1 AND update_id=$2 AND user_id=$3 FOR UPDATE',[bot,input.updateId,row.id])).rows[0];if(!r)fail('NOT_FOUND');if(prior||['failed','completed','retry_wait'].includes(r.status))return this.receipt(r);
      const policy=domainRetryPolicy(input.failure,'idempotent_mutation'),retry=policy.retryable&&r.attempts<3;
      r=(await c.query('UPDATE app.telegram_inbox SET status=$4,failure=$5,next_attempt_at=$6 WHERE bot_id=$1 AND update_id=$2 AND user_id=$3 RETURNING *',[bot,input.updateId,row.id,retry?'retry_wait':'failed',input.failure,retry?new Date(this.store.now()+(policy.retryAfterSeconds??2)*1000):null])).rows[0];
      await c.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result) VALUES($1,$2,'',$3,$4,$5)",[row.id,op,key,hash,this.receipt(r)]);if(!retry)await c.query('DELETE FROM app.user_update_slots WHERE bot_id=$1 AND user_id=$2',[bot,row.id]);return this.receipt(r);
    });
  }
  async ack(raw:string){const id=TelegramUpdateId.parse(raw),bot=this.botId(),next=BigInt(id)+1n;if(next>9223372036854775807n)fail('VALIDATION_ERROR');await transaction(this.store.pool,async c=>{
    const r=(await c.query('SELECT status FROM app.telegram_inbox WHERE bot_id=$1 AND update_id=$2 FOR UPDATE',[bot,id])).rows[0];if(r?.status==='retry_wait')fail('OPERATION_IN_PROGRESS');
    if(r?.status==='processing')await c.query("UPDATE app.telegram_inbox SET status='completed',completed_at=$3 WHERE bot_id=$1 AND update_id=$2",[bot,id,new Date(this.store.now())]);
    await c.query('DELETE FROM app.user_update_slots WHERE bot_id=$1 AND update_id=$2',[bot,id]);await c.query('INSERT INTO app.telegram_cursors(bot_id,next_offset) VALUES($1,$2) ON CONFLICT(bot_id) DO UPDATE SET next_offset=GREATEST(app.telegram_cursors.next_offset,$2)',[bot,next.toString()]);
  });}
  async deliveries(limit:number):Promise<Delivery[]>{
    this.botId();if(!Number.isInteger(limit)||limit<1||limit>10)fail('VALIDATION_ERROR');const candidates=(await this.store.pool.query("SELECT d.id,d.user_id,a.telegram_user_id FROM app.product_deliveries d JOIN app.accounts a ON a.id=d.user_id WHERE (d.state='pending' AND next_attempt_at<=$1) OR (d.state='claimed' AND lease_until<=$1) ORDER BY d.created_at LIMIT $2",[new Date(this.store.now()),limit])).rows;const result:Delivery[]=[];
    for(const candidate of candidates){const ctx=this.store.contexts.issue({id:candidate.user_id,telegram_user_id:candidate.telegram_user_id},'telegram');const delivery=await this.store.read(ctx,false,async(c,row)=>{
      const d=(await c.query("SELECT * FROM app.product_deliveries WHERE id=$1 AND user_id=$2 AND state IN ('pending','claimed') FOR UPDATE SKIP LOCKED",[candidate.id,row.id])).rows[0];if(!d)return;
      let valid=row.consent_version==='web-telegram-2'&&!!row.email_verified_at,run:ReturnType<typeof RunV2.parse>|undefined;
      if(d.run_id){const stored=(await c.query('SELECT r.value,s.revision FROM app.product_runs r LEFT JOIN app.product_sessions s ON s.id=r.session_id AND s.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2',[d.run_id,row.id])).rows[0];valid=valid&&!!stored&&stored.value.status!=='pending'&&(!stored.value.sessionId||stored.value.revision===stored.revision);if(valid)run=RunV2.parse(stored.value);}
      else valid=valid&&await this.reminderValid(c,row,d.payload);
      if(!valid||d.attempts>=10){await c.query("UPDATE app.product_deliveries SET state='failed' WHERE id=$1",[d.id]);return;}
      const token=randomUUID();await c.query("UPDATE app.product_deliveries SET state='claimed',attempts=attempts+1,claim_token=$2,lease_until=$3 WHERE id=$1",[d.id,token,new Date(this.store.now()+60000)]);this.claims.set(ctx,{id:d.id,token});return run?{id:d.id,context:ctx,attempt:d.attempts+1,kind:'run' as const,run}:{id:d.id,context:ctx,attempt:d.attempts+1,kind:'reminder' as const,notification:d.payload};
    });if(delivery)result.push(delivery);}return result;
  }
  async finish(ctx:UserContext,id:string,input?:ReturnType<typeof DeliveryFailure.parse>){Id.parse(id);const failure=input?DeliveryFailure.parse(input):undefined,claim=this.claims.get(ctx);if(!claim||claim.id!==id)fail('NOT_FOUND');await this.store.read(ctx,false,async(c,row)=>{
    const d=(await c.query('SELECT * FROM app.product_deliveries WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,row.id])).rows[0];if(!d||d.claim_token!==claim.token)fail('NOT_FOUND');if(d.state!=='claimed')return;
    if(!failure){await c.query("UPDATE app.product_deliveries SET state='completed',lease_until=NULL WHERE id=$1",[id]);return;}
    const ordinary=d.ordinary_failures+(failure.code==='DELIVERY_FAILED'?1:0),terminal=failure.code==='CHAT_UNAVAILABLE'||ordinary>=3||d.attempts>=10;
    await c.query('UPDATE app.product_deliveries SET state=$2,ordinary_failures=$3,lease_until=NULL,next_attempt_at=$4 WHERE id=$1',[id,terminal?'failed':'pending',ordinary,new Date(this.store.now()+1000*(failure.code==='RATE_LIMITED'?Math.max(1,failure.retryAfterSeconds??30):Math.min(300,2**d.attempts)))]);
  });}
}

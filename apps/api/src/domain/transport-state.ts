import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {TelegramUpdateId,UpdateReceipt,DeliveryFailure,Id,type UserContext,type DomainDelivery} from '@between/contracts/domain';
import {transaction} from '../repositories/storage.js';
import {Contexts,digest,fail} from './core.js';
import type {Runs} from '../services/runs.js';
export class TransportState {
  private processId=randomUUID();
  private claims=new WeakMap<object,{id:string;token:string}>();
  constructor(private pool:Pool,private contexts:Contexts,private runs:Runs,private botId:string,private secret:string,private now:()=>number,private active:()=>boolean){}
  private requireLease(){if(!this.active())fail('DEPENDENCY_UNAVAILABLE');}
  async cursor(){
    this.requireLease();
    const result=(await this.pool.query(`SELECT LEAST(COALESCE((SELECT next_offset FROM app.telegram_cursors WHERE bot_id=$1),0),
      COALESCE((SELECT min(update_id) FROM app.telegram_inbox WHERE bot_id=$1 AND status='processing'),9223372036854775807))::text AS value`,[this.botId])).rows[0];
    return {nextOffset:TelegramUpdateId.parse(result.value)};
  }
  async claim(ctx:UserContext,raw:string){
    this.requireLease();const id=TelegramUpdateId.parse(raw);
    if(this.contexts.updateFor(ctx)!==id)fail('UNAUTHORIZED');
    const answer=await transaction(this.pool,async client=>{
      const account=await this.contexts.check(ctx,client,false,true),owner=digest(this.secret,'inbox-principal',this.botId,account.telegram_user_id);
      await client.query("INSERT INTO app.telegram_inbox(bot_id,update_id,user_id,intent_key,principal_hmac,status) VALUES($1,$2,$3,$4,$5,'processing') ON CONFLICT DO NOTHING",[this.botId,id,account.id,randomUUID(),owner]);
      const row=(await client.query('SELECT * FROM app.telegram_inbox WHERE bot_id=$1 AND update_id=$2 FOR UPDATE',[this.botId,id])).rows[0];
      if(row.principal_hmac!==owner||(row.user_id&&row.user_id!==account.id))fail('NOT_FOUND');
      if(row.status==='processing'){
        const slot=(await client.query('SELECT * FROM app.user_update_slots WHERE bot_id=$1 AND user_id=$2 FOR UPDATE',[this.botId,account.id])).rows[0];
        if(slot?.process_id===this.processId&&slot.update_id!==id)return {busy:true,receipt:null};
        const oldest=(await client.query("SELECT update_id FROM app.telegram_inbox WHERE bot_id=$1 AND user_id=$2 AND status='processing' ORDER BY update_id LIMIT 1",[this.botId,account.id])).rows[0];
        if(oldest?.update_id!==id)return {busy:true,receipt:null};
        await client.query('INSERT INTO app.user_update_slots(bot_id,user_id,update_id,process_id) VALUES($1,$2,$3,$4) ON CONFLICT(bot_id,user_id) DO UPDATE SET update_id=EXCLUDED.update_id,process_id=EXCLUDED.process_id',[this.botId,account.id,id,this.processId]);
      }
      return {busy:false,receipt:UpdateReceipt.parse({updateId:id,intentKey:row.intent_key,status:row.status})};
    });
    if(answer.busy||!answer.receipt)fail('OPERATION_IN_PROGRESS');return answer.receipt;
  }
  async acknowledge(raw:string){
    this.requireLease();const id=TelegramUpdateId.parse(raw),next=BigInt(id)+1n;if(next>9223372036854775807n)fail('VALIDATION_ERROR');
    await transaction(this.pool,async client=>{
      await client.query("UPDATE app.telegram_inbox SET status='completed',completed_at=$3 WHERE bot_id=$1 AND update_id=$2",[this.botId,id,new Date(this.now())]);
      await client.query('DELETE FROM app.user_update_slots WHERE bot_id=$1 AND update_id=$2',[this.botId,id]);
      await client.query('INSERT INTO app.telegram_cursors(bot_id,next_offset) VALUES($1,$2) ON CONFLICT(bot_id) DO UPDATE SET next_offset=GREATEST(app.telegram_cursors.next_offset,EXCLUDED.next_offset)',[this.botId,next.toString()]);
    });
  }
  async claimDeliveries(limit:number):Promise<DomainDelivery[]>{
    this.requireLease();if(!Number.isInteger(limit)||limit<1||limit>10)fail('VALIDATION_ERROR');
    const result=await transaction(this.pool,async client=>{
      await client.query("UPDATE app.run_deliveries SET state='failed' WHERE state='claimed' AND attempts>=10 AND lease_until<=$1",[new Date(this.now())]);
      await client.query(`UPDATE app.run_deliveries d SET state='failed',lease_until=NULL WHERE state IN ('pending','claimed') AND NOT EXISTS(
        SELECT 1 FROM app.accounts a JOIN app.ai_runs r ON r.id=d.run_id JOIN app.sessions s ON s.id=r.session_id AND s.user_id=r.user_id
        WHERE a.id=d.user_id AND a.consent_version='telegram-1' AND a.email_verified_at IS NOT NULL AND r.revision=s.revision AND r.status IN ('succeeded','failed'))`);
      const rows=(await client.query(`SELECT d.*,a.telegram_user_id FROM app.run_deliveries d JOIN app.accounts a ON a.id=d.user_id
        WHERE ((d.state='pending' AND d.next_attempt_at<=$1) OR (d.state='claimed' AND d.lease_until<=$1)) AND attempts<10
        ORDER BY d.created_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT $2`,[new Date(this.now()),limit])).rows;
      const claims=[];
      for(const row of rows){
        const token=randomUUID();await client.query("UPDATE app.run_deliveries SET state='claimed',attempts=attempts+1,claim_token=$2,lease_until=$3 WHERE id=$1",[row.id,token,new Date(this.now()+60000)]);
        claims.push({...row,claim_token:token,attempts:row.attempts+1});
      }return claims;
    });
    const deliveries:DomainDelivery[]=[];
    for(const row of result){
      const ctx=this.contexts.issue({id:row.user_id,telegram_user_id:row.telegram_user_id});
      try{await this.contexts.check(ctx,this.pool,true);const run=await this.runs.get(row.user_id,row.run_id);this.claims.set(ctx,{id:row.id,token:row.claim_token});deliveries.push({id:row.id,context:ctx,run,attempt:row.attempts});}
      catch{await this.pool.query("UPDATE app.run_deliveries SET state='failed' WHERE id=$1 AND claim_token=$2",[row.id,row.claim_token]);}
    }return deliveries;
  }
  async finish(ctx:UserContext,id:string,failure?:ReturnType<typeof DeliveryFailure.parse>){
    this.requireLease();Id.parse(id);await this.contexts.check(ctx);
    const claim=this.claims.get(ctx);if(!claim||claim.id!==id)fail('NOT_FOUND');
    await transaction(this.pool,async client=>{
      const row=(await client.query('SELECT * FROM app.run_deliveries WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,ctx.accountId])).rows[0];
      if(!row||row.claim_token!==claim.token)fail('NOT_FOUND');
      if(row.state!=='claimed')return;
      if(!failure){await client.query("UPDATE app.run_deliveries SET state='completed',lease_until=NULL WHERE id=$1",[id]);return;}
      const ordinary=row.ordinary_failures+(failure.code==='DELIVERY_FAILED'?1:0);
      const terminal=failure.code==='CHAT_UNAVAILABLE'||ordinary>=3||row.attempts>=10;
      const backoff=failure.code==='RATE_LIMITED'?Math.max(1,failure.retryAfterSeconds??30):Math.min(300,2**row.attempts);
      await client.query('UPDATE app.run_deliveries SET state=$2,ordinary_failures=$3,next_attempt_at=$4,lease_until=NULL WHERE id=$1',[id,terminal?'failed':'pending',ordinary,new Date(this.now()+backoff*1000)]);
    });
  }
}

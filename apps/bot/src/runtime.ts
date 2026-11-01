import type {PrivateTelegramIdentity,ProductFacade} from '@between/contracts/product';
import {decode} from './callbacks.js';
import {Flows,type Turn,failureCode,isTransient} from './flows.js';
import {classify} from './identity.js';
import {type TelegramApi,type TgUpdate,TelegramError,isRateLimited,isUnreachable} from './telegram.js';
import {texts} from './text.js';
import {send} from './ui.js';

const COMMANDS=new Set(['start','menu','cancel','history','account','help']);
// Only error classes/codes are logged: never update content, user text, model output, URLs, cookies or tokens.
export const logError=(where:string,error:unknown)=>console.error(`[bot] ${where}: ${failureCode(error)??(error instanceof TelegramError?`telegram ${error.status}`:error instanceof Error?error.name:'unknown')}`);
const sleep=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
const MAX_BACKOFF=60000;

export interface PollerOptions {timeoutSeconds:number;backoffMs:number;fatal?:(error:unknown)=>boolean}

/**
 * Single getUpdates poller. Offset comes from the domain; an update is acknowledged only after a definite outcome.
 * An uncertain (transient) outcome is never acknowledged: the same update is retried with backoff under the same intent.
 */
export class Poller {
  polling=false;
  private notified=new Set<string>();
  constructor(private tg:TelegramApi,private domain:ProductFacade,private flows:Flows,private options:PollerOptions={timeoutSeconds:25,backoffMs:2000}) {}

  async run(signal:AbortSignal) {
    let backoff=this.options.backoffMs;
    try{
      while(!signal.aborted){
        try{
          const {nextOffset}=await this.domain.updateCursor();
          const updates=await this.tg.getUpdates(nextOffset,this.options.timeoutSeconds,signal);
          this.polling=true;
          let blocked=false;
          for(const update of updates){
            if(signal.aborted)break;
            if(!await this.handle(update)){blocked=true;break;}
          }
          if(blocked){await sleep(backoff,signal);backoff=Math.min(backoff*2,MAX_BACKOFF);}else backoff=this.options.backoffMs;
        }catch(error){
          if(signal.aborted)break;
          this.polling=false;logError('poll',error);
          if(this.options.fatal?.(error))throw error;
          await sleep(backoff,signal);backoff=Math.min(backoff*2,MAX_BACKOFF);
        }
      }
    }finally{this.polling=false;}
  }

  /** true = acknowledged (definite outcome); false = uncertain, not acknowledged, retried later. */
  async handle(update:TgUpdate):Promise<boolean> {
    const updateId=String(update.update_id),c=classify(update);
    try{
      if(c.kind==='callback_rejected')await this.tg.answerCallbackQuery(c.callbackId,texts.groupOnly).catch(()=>{});
      if(c.kind==='group_command')await this.tg.sendMessage(c.chatId,texts.groupOnly).catch(()=>{});
      if(c.kind==='private')await this.process(update,c.identity,updateId);
    }catch(error){
      logError('update',error);
      // Definite: the user blocked the bot or Telegram rejected the request. Otherwise the outcome is unknown.
      const definite=isUnreachable(error)||(error instanceof TelegramError&&error.status===400)||(!isTransient(error)&&!(error instanceof TelegramError));
      if(!definite){
        if(c.kind==='private'&&!this.notified.has(updateId)){this.notified.add(updateId);await this.tg.sendMessage(c.identity.privateChatId,'Временная ошибка сервера. Я повторю действие сам — нажимать ещё раз не нужно.').catch(()=>{});}
        return false;
      }
    }
    try{await this.domain.acknowledgeUpdate(updateId);this.notified.delete(updateId);return true;}
    catch(error){logError('ack',error);return false;}
  }

  private async process(update:TgUpdate,identity:PrivateTelegramIdentity,updateId:string) {
    if(update.callback_query)await this.tg.answerCallbackQuery(update.callback_query.id).catch(()=>{});
    const ctx=await this.domain.resolveUser(identity);
    const receipt=await this.domain.claimUpdate(ctx,updateId);
    if(receipt.status==='completed')return;
    const [account,dlg]=await Promise.all([this.domain.account(ctx,{}),this.domain.dialogue(ctx,{})]);
    const t:Turn={tg:this.tg,ctx,chat:identity.privateChatId,account,dlg,intent:receipt.intentKey,seq:0};
    const text=update.message?.text;
    const command=text?.match(/^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i)?.[1]?.toLowerCase();
    if(command)return this.flows.command(t,COMMANDS.has(command)?command:'unknown');
    if(update.callback_query)return this.flows.callback(t,decode(update.callback_query.data));
    if(typeof text==='string')return this.flows.text(t,text);
    return send(this.tg,t.chat,texts.textOnly);
  }
}

/** Sends finished runs and reminders from the durable domain outbox; attempts live in the DB. Never re-generates. */
export class DeliveryWorker {
  private timer:NodeJS.Timeout|undefined;
  private running:Promise<void>|undefined;
  private stopped=false;
  constructor(private tg:TelegramApi,private domain:ProductFacade,private flows:Flows,private intervalMs=1500) {}
  start(signal?:AbortSignal) {
    signal?.addEventListener('abort',()=>{void this.stop();},{once:true});
    const loop=()=>{if(this.stopped)return;this.running=this.tick().finally(()=>{if(!this.stopped)this.timer=setTimeout(loop,this.intervalMs);});};
    this.timer=setTimeout(loop,0);
  }
  async stop() {this.stopped=true;clearTimeout(this.timer);await this.running;}
  async tick() {
    let batch;
    try{batch=await this.domain.claimDeliveries(10);}catch(error){logError('delivery-claim',error);return;}
    for(const delivery of batch){
      try{
        const [account,dlg]=await Promise.all([this.domain.account(delivery.context,{}),this.domain.dialogue(delivery.context,{})]);
        await this.flows.deliver({tg:this.tg,ctx:delivery.context,chat:account.telegramUserId,account,dlg,intent:delivery.id,seq:0},delivery);
        await this.domain.completeDelivery(delivery.context,delivery.id);
      }catch(error){
        logError('delivery',error);
        const failure=isUnreachable(error)?{code:'CHAT_UNAVAILABLE' as const}:isRateLimited(error)?{code:'RATE_LIMITED' as const,retryAfterSeconds:Math.min((error as TelegramError).retryAfter??30,300)}:{code:'DELIVERY_FAILED' as const};
        await this.domain.failDelivery(delivery.context,delivery.id,failure).catch(e=>logError('delivery-fail',e));
      }
    }
  }
}

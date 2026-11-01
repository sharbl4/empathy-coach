import {normalizeDomainError,type DomainFailure,type PrivateTelegramIdentity,type ProductFacade,type UserContext} from '@between/contracts/product';
import {decode,intentKey} from './callbacks.js';
import {Flows,type Turn,failureCode} from './flows.js';
import {classify} from './identity.js';
import {type TelegramApi,type TgUpdate,TelegramError,TelegramUnavailable,isRateLimited,isUnreachable} from './telegram.js';
import {texts} from './text.js';
import {send} from './ui.js';

const COMMANDS=new Set(['start','menu','cancel','history','account','help']);
// Only error classes/codes are logged: never update content, user text, model output, URLs, cookies or tokens.
export const logError=(where:string,error:unknown)=>console.error(`[bot] ${where}: ${failureCode(error)??(error instanceof TelegramError?`telegram ${error.status}`:error instanceof Error?error.name:'unknown')}`);
const sleep=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
const MAX_BACKOFF=60000;
/** Consecutive failures to obtain or record a durable outcome before the poller stops (fatal, safe error, root shuts down). */
export const MAX_UNRECORDED=5;
export class PollerStalled extends Error {constructor() {super('Poller cannot record durable update outcomes');this.name='PollerStalled';}}

export interface PollerOptions {timeoutSeconds:number;backoffMs:number;fatal?:(error:unknown)=>boolean}
/** Outcome of one update: acknowledged, or wait (retry_wait / unrecordable failure) before polling again. */
export type Handled={done:true}|{done:false;waitMs:number};

/**
 * Vetted transport classification: only known temporary Telegram conditions become retryable codes.
 * Everything else goes through the shared normalizer (unknown → INTERNAL_ERROR, terminal).
 */
function updateFailure(error:unknown,requestId:string):DomainFailure {
  if(error instanceof TelegramUnavailable)return {code:'DEPENDENCY_UNAVAILABLE',requestId};
  if(isRateLimited(error))return {code:'RATE_LIMITED',requestId,retryAfterSeconds:Math.min(300,(error as TelegramError).retryAfter??5)};
  if(error instanceof TelegramError)return {code:'INTERNAL_ERROR',requestId};
  return normalizeDomainError(error,requestId);
}

/**
 * Single getUpdates poller. Offset comes from the domain. Ack only after a known completed operation or a
 * persisted terminal failure (recordUpdateFailure); the attempt budget lives in the DB (UpdateReceiptV2).
 */
export class Poller {
  polling=false;
  /** Set when a failure could not be recorded durably: surfaced as unhealthy through health().polling. */
  degraded=false;
  private unrecorded=0;
  constructor(private tg:TelegramApi,private domain:ProductFacade,private flows:Flows,private options:PollerOptions={timeoutSeconds:25,backoffMs:2000}) {}

  async run(signal:AbortSignal) {
    let backoff=this.options.backoffMs;
    try{
      while(!signal.aborted){
        try{
          const {nextOffset}=await this.domain.updateCursor();
          const updates=await this.tg.getUpdates(nextOffset,this.options.timeoutSeconds,signal);
          this.polling=true;backoff=this.options.backoffMs;
          for(const update of updates){
            if(signal.aborted)break;
            // Keep the received batch in memory until this update has a durable outcome.
            // A retry must not depend on Telegram returning the same payload on a later poll.
            // Domain attempts/intent keys still bound replay; unknown admission never becomes an ack.
            while(!signal.aborted){
              const handled=await this.handle(update);
              if(this.unrecorded>=MAX_UNRECORDED)throw new PollerStalled();
              if(handled.done)break;
              await sleep(Math.min(handled.waitMs,MAX_BACKOFF),signal);
            }
          }
        }catch(error){
          if(signal.aborted)break;
          this.polling=false;logError('poll',error);
          if(error instanceof PollerStalled||this.options.fatal?.(error))throw error;
          await sleep(backoff,signal);backoff=Math.min(backoff*2,MAX_BACKOFF);
        }
      }
    }finally{this.polling=false;}
  }

  async handle(update:TgUpdate):Promise<Handled> {
    const updateId=String(update.update_id),c=classify(update);
    if(c.kind!=='private'){
      // Rejected group/channel/inline updates: no account, no content stored; just advance the offset.
      if(c.kind==='callback_rejected')await this.tg.answerCallbackQuery(c.callbackId,texts.groupOnly).catch(()=>{});
      if(c.kind==='group_command')await this.tg.sendMessage(c.chatId,texts.groupOnly).catch(()=>{});
      return this.ack(updateId);
    }
    if(update.callback_query)await this.tg.answerCallbackQuery(update.callback_query.id).catch(()=>{});
    let ctx:UserContext,receipt;
    try{ctx=await this.domain.resolveUser(c.identity);receipt=await this.domain.claimUpdate(ctx,updateId);}
    catch(error){logError('claim',error);return this.unrecordable(c.identity.privateChatId);}
    if(receipt.status==='completed'||receipt.status==='failed')return this.ack(updateId);
    if(receipt.status==='retry_wait')return {done:false,waitMs:Math.max(1000,Date.parse(receipt.nextAttemptAt??'')-Date.now()||this.options.backoffMs)};
    try{
      await this.process(update,ctx,c.identity,receipt.intentKey);
    }catch(error){
      logError('update',error);
      if(isUnreachable(error))return this.ack(updateId); // the user blocked the bot: nothing more to deliver
      const failure=updateFailure(error,`bot-${receipt.intentKey}`);
      let recorded;
      try{recorded=await this.domain.recordUpdateFailure(ctx,{updateId,failure},intentKey(receipt.intentKey,'failure',receipt.attempts));}
      catch(recordError){logError('record-failure',recordError);return this.unrecordable(c.identity.privateChatId);}
      this.unrecorded=0;
      if(recorded.status==='retry_wait'){
        if(recorded.attempts===1)await this.tg.sendMessage(c.identity.privateChatId,'Временная ошибка сервера. Я повторю действие сам — нажимать ещё раз не нужно.').catch(()=>{});
        return {done:false,waitMs:Math.max(1000,Date.parse(recorded.nextAttemptAt??'')-Date.now()||this.options.backoffMs)};
      }
      // Terminal failure is persisted: tell the user honestly once, then ack (the receipt stays failed).
      await this.tg.sendMessage(c.identity.privateChatId,recorded.failure?.code==='OPERATION_IN_PROGRESS'?texts.busy:texts.failed).catch(()=>{});
      return this.ack(updateId);
    }
    return this.ack(updateId);
  }

  private async ack(updateId:string):Promise<Handled> {
    try{await this.domain.acknowledgeUpdate(updateId);this.degraded=false;this.unrecorded=0;return {done:true};}
    catch(error){logError('ack',error);return this.unrecordable(null);}
  }
  /** No durable outcome could be stored: do not ack, do not promise a replay; count towards the fatal bound. */
  private async unrecordable(chatId:string|null):Promise<Handled> {
    this.degraded=true;this.unrecorded++;
    if(chatId&&this.unrecorded===1)await this.tg.sendMessage(chatId,texts.internal).catch(()=>{});
    return {done:false,waitMs:this.options.backoffMs};
  }

  private async process(update:TgUpdate,ctx:UserContext,identity:PrivateTelegramIdentity,intent:string) {
    const [account,dlg]=await Promise.all([this.domain.account(ctx,{}),this.domain.dialogue(ctx,{})]);
    const t:Turn={tg:this.tg,ctx,chat:identity.privateChatId,account,dlg,intent,seq:0};
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

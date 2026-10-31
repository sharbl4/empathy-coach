import {renameSync,writeFileSync} from 'node:fs';
import {BotHealth,type DomainFacade} from '@between/contracts/domain';
import {decode} from './callbacks.js';
import {Flows,type Turn,failureCode,isTransient} from './flows.js';
import {classify} from './identity.js';
import {type TelegramApi,type TgUpdate,TelegramError,isRateLimited,isUnreachable} from './telegram.js';
import {texts} from './text.js';
import {send} from './ui.js';

const COMMANDS=new Set(['start','menu','cancel','history','account','help']);
// Only error classes/codes are logged: never update content, user text, model output, URLs or tokens.
export const logError=(where:string,error:unknown)=>console.error(`[bot] ${where}: ${failureCode(error)??(error instanceof TelegramError?`telegram ${error.status}`:error instanceof Error?error.name:'unknown')}`);
const sleep=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
const MAX_ATTEMPTS=3;

/** Single getUpdates poller. Offset comes from the domain; an update is acknowledged only after a definite outcome. */
export class Poller {
  polling=false;
  private attempts=new Map<string,number>();
  constructor(private tg:TelegramApi,private domain:DomainFacade,private flows:Flows,private options:{timeoutSeconds:number;backoffMs:number}={timeoutSeconds:25,backoffMs:2000}) {}

  async run(signal:AbortSignal) {
    let backoff=this.options.backoffMs;
    while(!signal.aborted){
      try{
        const {nextOffset}=await this.domain.updateCursor();
        const updates=await this.tg.getUpdates(nextOffset,this.options.timeoutSeconds,signal);
        this.polling=true;backoff=this.options.backoffMs;
        for(const update of updates){
          if(signal.aborted)break;
          if(!await this.handle(update)){await sleep(backoff,signal);break;}
        }
      }catch(error){
        if(signal.aborted)break;
        this.polling=false;logError('poll',error);
        await sleep(backoff,signal);backoff=Math.min(backoff*2,60000);
      }
    }
    this.polling=false;
  }

  /** true = acknowledged (definite outcome); false = transient failure, the same update is retried later. */
  async handle(update:TgUpdate):Promise<boolean> {
    const updateId=String(update.update_id),c=classify(update);
    try{
      if(c.kind==='callback_rejected')await this.tg.answerCallbackQuery(c.callbackId,texts.groupOnly).catch(()=>{});
      if(c.kind==='group_command')await this.tg.sendMessage(c.chatId,texts.groupOnly).catch(()=>{});
      if(c.kind==='private')await this.process(update,c.identity,updateId);
      await this.domain.acknowledgeUpdate(updateId);
      this.attempts.delete(updateId);
      return true;
    }catch(error){
      logError('update',error);
      const count=(this.attempts.get(updateId)??0)+1;this.attempts.set(updateId,count);
      const definite=isUnreachable(error)||(error instanceof TelegramError&&error.status===400)||(!isTransient(error)&&!(error instanceof TelegramError));
      if(!definite&&count<MAX_ATTEMPTS)return false;
      // Give up after bounded attempts: tell the user once, then acknowledge so other updates are not blocked.
      if(c.kind==='private'&&!isUnreachable(error))await this.tg.sendMessage(c.identity.privateChatId,texts.internal).catch(()=>{});
      try{await this.domain.acknowledgeUpdate(updateId);this.attempts.delete(updateId);return true;}catch(ackError){logError('ack',ackError);return false;}
    }
  }

  private async process(update:TgUpdate,identity:Parameters<DomainFacade['resolveUser']>[0],updateId:string) {
    if(update.callback_query)await this.tg.answerCallbackQuery(update.callback_query.id).catch(()=>{});
    const ctx=await this.domain.resolveUser(identity);
    const receipt=await this.domain.claimUpdate(ctx,updateId);
    if(receipt.status==='completed')return;
    const [account,dlg]=await Promise.all([this.domain.account(ctx),this.domain.dialogue(ctx)]);
    const t:Turn={tg:this.tg,ctx,chat:identity.privateChatId,account,dlg,intent:receipt.intentKey,seq:0};
    const text=update.message?.text;
    const command=text?.match(/^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i)?.[1]?.toLowerCase();
    if(command)return this.flows.command(t,COMMANDS.has(command)?command:'unknown');
    if(update.callback_query)return this.flows.callback(t,decode(update.callback_query.data));
    if(typeof text==='string')return this.flows.text(t,text);
    return send(this.tg,t.chat,texts.textOnly);
  }
}

/** Sends finished runs from the durable domain outbox; attempts live in the DB, not here. Never re-generates. */
export class DeliveryWorker {
  private timer:NodeJS.Timeout|undefined;
  private running:Promise<void>|undefined;
  constructor(private tg:TelegramApi,private domain:DomainFacade,private flows:Flows,private intervalMs=1500) {}
  start() {const loop=()=>{this.running=this.tick().finally(()=>{if(this.timer!==undefined)this.timer=setTimeout(loop,this.intervalMs);});};this.timer=setTimeout(loop,0);}
  async stop() {clearTimeout(this.timer);this.timer=undefined;await this.running;}
  async tick() {
    let batch;
    try{batch=await this.domain.claimDeliveries(10);}catch(error){logError('delivery-claim',error);return;}
    for(const delivery of batch){
      try{
        const [account,dlg]=await Promise.all([this.domain.account(delivery.context),this.domain.dialogue(delivery.context)]);
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

/** Private heartbeat file; written atomically, holds no IDs, text or tokens. */
export class Heartbeat {
  private timer:NodeJS.Timeout|undefined;
  constructor(private file:string,private domain:DomainFacade,private poller:Poller,private intervalMs=15000) {}
  async beat() {
    let state={database:false,pollerLease:false};
    try{state=await this.domain.health();}catch(error){logError('health',error);}
    const health=BotHealth.parse({pid:process.pid,heartbeatAt:new Date().toISOString(),database:state.database,pollerLease:state.pollerLease,polling:this.poller.polling});
    const tmp=`${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp,JSON.stringify(health),{mode:0o600});renameSync(tmp,this.file);
  }
  start() {const tick=()=>{void this.beat().catch(e=>logError('heartbeat',e));};tick();this.timer=setInterval(tick,this.intervalMs);}
  stop() {clearInterval(this.timer);this.timer=undefined;}
}

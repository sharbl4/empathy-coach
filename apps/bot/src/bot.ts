import {Bot,type Context} from 'grammy';
import type {UserFromGetMe} from 'grammy/types';
import {decode} from './callbacks.js';
import {type BotDomain,type Delivery,type UserContext,isDomainError} from './domain.js';
import {Flows,type Turn} from './flows.js';
import {isRateLimited,isUnreachable,retryAfter} from './telegram.js';
import {texts} from './text.js';
import {send} from './ui.js';

const COMMANDS=new Set(['start','menu','cancel','history','account','help']);
// Log only error classes/codes: never update content, user text, model output or tokens.
const logError=(where:string,error:unknown)=>console.error(`[bot] ${where}: ${isDomainError(error)?error.code:error instanceof Error?error.name:'unknown'}`);

export interface BotOptions {botInfo?:UserFromGetMe}

export function createBot(token:string,domain:BotDomain,options:BotOptions={}) {
  const bot=new Bot(token,options.botInfo?{botInfo:options.botInfo}:{});
  bot.api.config.use(retryAfter());
  const flows=new Flows(domain);

  // Groups/channels: short hint on explicit commands only; nothing is stored or analysed.
  bot.use(async(ctx,next)=>{
    if(!ctx.from||ctx.from.is_bot)return;
    if(ctx.chat&&ctx.chat.type!=='private'){
      if(ctx.message?.text?.startsWith('/'))await ctx.reply(texts.groupOnly).catch(()=>{});
      if(ctx.callbackQuery)await ctx.answerCallbackQuery({text:texts.groupOnly}).catch(()=>{});
      return;
    }
    if(!ctx.chat&&!ctx.callbackQuery)return;
    await next();
  });

  bot.use(async ctx=>{
    // Answer callbacks first so the spinner stops before any domain work.
    if(ctx.callbackQuery)await ctx.answerCallbackQuery().catch(()=>{});
    const user:UserContext={telegramId:String(ctx.from!.id)};
    const updateId=ctx.update.update_id;
    if(!await domainAccept(domain,updateId,user))return;
    try{await route(ctx,flows,domain,user);}
    catch(error){
      logError('update',error);
      try{const t=await turn(ctx.api,domain,user);await flows.explain(t,error);}catch{/* reply is best-effort */}
    }finally{await domain.completeUpdate(updateId).catch(error=>logError('inbox',error));}
  });
  bot.catch(error=>logError('middleware',error.error));
  return {bot,flows};
}

async function domainAccept(domain:BotDomain,updateId:number,user:UserContext) {
  try{return await domain.acceptUpdate(updateId,user);}catch(error){logError('inbox',error);return false;}
}

export async function turn(api:Context['api'],domain:BotDomain,user:UserContext):Promise<Turn> {
  const [account,st]=await Promise.all([domain.account(user),domain.state(user)]);
  return {api,user,chat:user.telegramId,account,st};
}

async function route(ctx:Context,flows:Flows,domain:BotDomain,user:UserContext) {
  const text=ctx.message?.text;
  const command=text?.match(/^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i)?.[1]?.toLowerCase();
  if(command==='start'){
    const account=await domain.startAccount(user),st=await domain.state(user);
    return flows.command({api:ctx.api,user,chat:user.telegramId,account,st},'start');
  }
  const t=await turn(ctx.api,domain,user);
  if(command)return COMMANDS.has(command)?flows.command(t,command):flows.command(t,'unknown');
  if(ctx.callbackQuery)return flows.callback(t,decode(ctx.callbackQuery.data));
  if(typeof text==='string')return flows.text(t,text);
  if(ctx.message)return send(ctx.api,t.chat,'Я понимаю только текст. Скопируй текст сообщения и пришли его. Черновик сохранён.');
}

/** Sends finished runs from the domain outbox. One tick at a time; never re-generates. */
export class DeliveryWorker {
  private timer?:NodeJS.Timeout;
  private running?:Promise<void>;
  private failures=new Map<string,number>();
  constructor(private api:Context['api'],private domain:BotDomain,private flows:Flows,private intervalMs:number) {}
  start() {const loop=()=>{this.running=this.tick().finally(()=>{if(this.timer!==undefined)this.timer=setTimeout(loop,this.intervalMs);});};this.timer=setTimeout(loop,0);}
  async stop() {clearTimeout(this.timer);this.timer=undefined;await this.running;}
  async tick() {
    let batch:Delivery[];
    try{batch=await this.domain.claimDeliveries(10);}catch(error){logError('delivery-claim',error);return;}
    for(const delivery of batch){
      try{
        await this.flows.deliver(await turn(this.api,this.domain,delivery.user),delivery);
        await this.domain.markDelivered(delivery.id);this.failures.delete(delivery.id);
      }catch(error){
        logError('delivery',error);
        const count=(this.failures.get(delivery.id)??0)+1;this.failures.set(delivery.id,count);
        // Rare duplicate send is acceptable; endless resend is not.
        if(isUnreachable(error)||(!isRateLimited(error)&&count>=3)){await this.domain.markUndeliverable(delivery.id).catch(e=>logError('delivery-mark',e));this.failures.delete(delivery.id);}
      }
    }
  }
}

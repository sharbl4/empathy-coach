import type {CreateTelegramTransport,PollerLease,ProductFacade,TelegramTransport} from '@between/contracts/product';
import {Flows} from './flows.js';
import {DeliveryWorker,Poller,logError} from './runtime.js';
import {TelegramApi,TelegramError} from './telegram.js';

const COMMANDS=[
  {command:'menu',description:'Главное меню'},{command:'history',description:'Сохранённые разборы'},
  {command:'account',description:'Почта, веб-вход, напоминания, данные'},{command:'cancel',description:'Отменить текущий шаг'},{command:'help',description:'Справка'}
];

/** Library transport: importing or constructing it never polls. The application owns the domain and the lease. */
class Transport implements TelegramTransport {
  private stopper=new AbortController();
  private poller:Poller|undefined;
  private worker:DeliveryWorker|undefined;
  private running:Promise<void>|undefined;
  private started=false;
  private resolveFinished!:()=>void;
  readonly finished=new Promise<void>(resolve=>{this.resolveFinished=resolve;});
  constructor(private tg:TelegramApi) {}

  async identify() {
    const me=await this.tg.getMe();
    if(!me.username)throw new Error('Bot username missing');
    return {botId:String(me.id),username:me.username};
  }

  async start(domain:ProductFacade,lease:PollerLease) {
    if(this.started)throw new Error('Transport already started');
    if(this.stopper.signal.aborted)throw new Error('Transport stopped');
    if(lease.signal.aborted||domain.shutdownSignal.aborted)throw new Error('Lease not held');
    this.started=true;
    const flows=new Flows(domain);
    this.poller=new Poller(this.tg,domain,flows,{timeoutSeconds:25,backoffMs:2000,fatal:isFatal});
    this.worker=new DeliveryWorker(this.tg,domain,flows);
    await this.tg.setMyCommands(COMMANDS).catch(error=>logError('commands',error));
    const signal=AbortSignal.any([this.stopper.signal,lease.signal,domain.shutdownSignal]);
    this.worker.start(signal);
    // Polling and delivery end together: on stop, lost lease, domain shutdown or a fatal Bot API error.
    this.running=this.poller.run(signal).catch(error=>logError('poll-fatal',error)).finally(async()=>{
      this.stopper.abort();
      await this.worker?.stop().catch(error=>logError('delivery-stop',error));
      this.resolveFinished();
    });
  }

  async stop() {
    this.stopper.abort();
    if(this.running)await this.running;else this.resolveFinished();
  }

  health() {return {polling:(this.poller?.polling??false)&&!this.poller?.degraded};}
}

/** Invalid token (401), deleted bot (404) or a second poller (409) cannot recover by retrying. */
const isFatal=(error:unknown)=>error instanceof TelegramError&&[401,404,409].includes(error.status);

export const createTelegramTransport:CreateTelegramTransport=({token})=>{
  if(!/^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(token))throw new Error('Telegram token format invalid');
  return new Transport(new TelegramApi(token));
};

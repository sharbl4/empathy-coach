import {Flows} from '../src/flows.js';
import {DeliveryWorker,Poller} from '../src/runtime.js';
import {TelegramApi,type TgUpdate} from '../src/telegram.js';
import {FakeDomain} from './fake-domain.js';

// Mock Telegram transport: real client code, fetch replaced; nothing leaves the process.
export const TOKEN='123456:TEST_ONLY_TOKEN_aaaaaaaaaaaaaaaaaaaaa';
export interface Sent {method:string;chat_id?:string;text?:string;buttons:{text:string;data:string}[]}
type Reply={ok:boolean;result?:unknown;error_code?:number;description?:string;parameters?:{retry_after:number}};
let seq=1000;

export class Harness {
  sent:Sent[]=[];
  urls:string[]=[];
  failNext:((method:string)=>Reply|null)|null=null;
  tg;flows;poller;worker;
  constructor(public domain=new FakeDomain()) {
    this.tg=new TelegramApi(TOKEN,async(url,init)=>{
      this.urls.push(url);
      const method=url.split('/').at(-1)!,p=JSON.parse(init.body) as Record<string,unknown>&{reply_markup?:{inline_keyboard:{text:string;callback_data:string}[][]}};
      const fail=this.failNext?.(method);
      if(fail){this.failNext=null;return {json:async()=>fail};}
      this.sent.push({method,chat_id:p.chat_id as string,text:p.text as string|undefined,buttons:(p.reply_markup?.inline_keyboard??[]).flat().map(x=>({text:x.text,data:x.callback_data}))});
      return {json:async()=>({ok:true,result:method==='sendMessage'?{message_id:this.sent.length,date:0,chat:{id:Number(p.chat_id),type:'private'}}:true})};
    },async()=>{});
    this.flows=new Flows(this.domain);
    this.poller=new Poller(this.tg,this.domain,this.flows,{timeoutSeconds:0,backoffMs:1});
    this.worker=new DeliveryWorker(this.tg,this.domain,this.flows);
  }
  private from(id:number) {return {id,is_bot:false,first_name:'Тест'};}
  update(u:Omit<TgUpdate,'update_id'>&{update_id?:number}):TgUpdate {return {update_id:seq++,...u};}
  async push(update:TgUpdate) {return this.poller.handle(update);}
  async message(text:string,{user=42,chat,updateId}:{user?:number;chat?:{id:number;type:'private'|'group'|'supergroup'|'channel'};updateId?:number}={}) {
    return this.push(this.update({...(updateId!==undefined?{update_id:updateId}:{}),message:{message_id:1,date:0,chat:chat??{id:user,type:'private'},from:this.from(user),text}}));
  }
  async callback(data:string,{user=42,updateId,chat}:{user?:number;updateId?:number;chat?:{id:number;type:'private'|'group'}|null}={}) {
    const message=chat===null?undefined:{message_id:1,date:0,chat:chat??{id:user,type:'private' as const}};
    return this.push(this.update({...(updateId!==undefined?{update_id:updateId}:{}),callback_query:{id:String(seq),from:this.from(user),...(message?{message}:{inline_message_id:'inl'}),data}}));
  }
  messages() {return this.sent.filter(s=>s.method==='sendMessage');}
  last() {return this.messages().at(-1)!;}
  lastText() {return this.last().text??'';}
  button(label:string|RegExp) {
    for(const m of [...this.messages()].reverse()){const btn=m.buttons.find(x=>typeof label==='string'?x.text===label:label.test(x.text));if(btn)return btn.data;}
    throw new Error(`No button ${label}`);
  }
  async click(label:string|RegExp,user=42) {return this.callback(this.button(label),{user});}
  async deliver() {await this.worker.tick();}

  /** New account → consent → email → code → onboarding complete. */
  async register(user=42) {
    await this.message('/start',{user});await this.click('Принимаю, продолжить',user);
    await this.message(`user${user}@example.com`,{user});await this.message(this.domain.lastCode,{user});
  }
}
